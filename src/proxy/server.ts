import * as http from 'http';
import * as net from 'net';
import { Duplex } from 'stream';
import { DISCORD_DOMAINS } from '../config/domains';
import { ProxyProvider } from './providers';
import { StatsMonitor } from '../monitoring/stats';
import { TIMEOUTS, LIMITS } from '../config/constants';

export interface ProxyServerOptions {
  onProxyFailed?: (proxy: ProxyProvider) => Promise<ProxyProvider | null>;
  statsMonitor?: StatsMonitor;
}

export class ProxyServer {
  private server: http.Server | null = null;
  private port: number;
  private upstreamProxy: ProxyProvider;
  private activeConnections: Set<Duplex> = new Set();
  private options: ProxyServerOptions;
  private stats: StatsMonitor;

  constructor(port: number, upstreamProxy: ProxyProvider, options: ProxyServerOptions = {}) {
    this.port = port;
    this.upstreamProxy = upstreamProxy;
    this.options = options;
    this.stats = options.statsMonitor || new StatsMonitor();
  }

  private isDiscordDomain(host: string): boolean {
    if (!host) return false;

    const hostname = host.split(':')[0].toLowerCase();
    return DISCORD_DOMAINS.some(domain => {
      if (domain.startsWith('*.')) {
        const baseDomain = domain.substring(2);
        return hostname.endsWith(baseDomain) || hostname === baseDomain;
      }
      return hostname === domain;
    });
  }

  private getProxyKey(): string {
    return `${this.upstreamProxy.protocol}://${this.upstreamProxy.host}:${this.upstreamProxy.port}`;
  }

  private async connectThroughSocks5(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.upstreamProxy.port, this.upstreamProxy.host, () => {
        // SOCKS5 handshake
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      });

      let step = 0;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('SOCKS5 connection timeout'));
      }, TIMEOUTS.PROXY_CONNECT);

      socket.on('data', (data) => {
        if (step === 0) {
          // Authentication method response
          if (data[0] === 0x05 && data[1] === 0x00) {
            step = 1;
            // CONNECT request
            const hostBuffer = Buffer.from(host);
            const request = Buffer.concat([
              Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
              hostBuffer,
              Buffer.from([port >> 8, port & 0xff])
            ]);
            socket.write(request);
          } else {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error('SOCKS5 auth failed'));
          }
        } else if (step === 1) {
          // Connection response
          clearTimeout(timeout);
          if (data[0] === 0x05 && data[1] === 0x00) {
            resolve(socket);
          } else {
            socket.destroy();
            reject(new Error('SOCKS5 connect failed'));
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private trackConnection(socket: Duplex): void {
    if (this.activeConnections.size >= LIMITS.MAX_CONNECTIONS) {
      socket.end();
      return;
    }

    this.activeConnections.add(socket);
    if ('setTimeout' in socket) {
      (socket as net.Socket).setTimeout(TIMEOUTS.SOCKET_IDLE);
    }

    socket.on('close', () => {
      this.activeConnections.delete(socket);
    });

    socket.on('timeout', () => {
      socket.destroy();
      this.activeConnections.delete(socket);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer();

      // Handle CONNECT method for HTTPS
      this.server.on('connect', async (req, clientSocket, head) => {
        const host = req.url || '';
        const [hostname, portStr] = host.split(':');
        const port = parseInt(portStr) || 443;

        this.trackConnection(clientSocket);
        this.stats.connectionStarted();

        if (this.isDiscordDomain(hostname)) {
          try {
            const proxySocket = await this.connectThroughSocks5(hostname, port);
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

            // Write any buffered data
            if (head && head.length > 0) {
              proxySocket.write(head);
            }

            // Setup bidirectional pipe with data tracking
            let bytesTransferred = 0;

            proxySocket.on('data', (data) => {
              bytesTransferred += data.length;
            });

            clientSocket.on('data', (data) => {
              bytesTransferred += data.length;
            });

            proxySocket.pipe(clientSocket);
            clientSocket.pipe(proxySocket);

            const cleanup = () => {
              this.stats.dataTransferred(bytesTransferred);
              this.stats.connectionSucceeded();
              this.stats.resetProxyFailures(this.getProxyKey());
            };

            proxySocket.on('error', (err) => {
              console.error(`Proxy socket error for ${hostname}:`, err.message);
              clientSocket.end();
              cleanup();
            });

            clientSocket.on('error', (err) => {
              console.error(`Client socket error for ${hostname}:`, err.message);
              proxySocket.end();
              cleanup();
            });

            proxySocket.on('close', cleanup);
            clientSocket.on('close', cleanup);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`Failed to connect through proxy to ${hostname}:`, errorMsg);

            this.stats.connectionFailed(this.getProxyKey());
            clientSocket.end();

            // Check if we should switch proxies
            const failures = this.stats.getProxyFailures(this.getProxyKey());
            if (failures >= LIMITS.MAX_PROXY_FAILURES && this.options.onProxyFailed) {
              const newProxy = await this.options.onProxyFailed(this.upstreamProxy);
              if (newProxy) {
                console.log(`Switching to new proxy: ${newProxy.name}`);
                this.upstreamProxy = newProxy;
                this.stats.resetProxyFailures(this.getProxyKey());
              }
            }
          }
        } else {
          // Direct HTTPS connection for non-Discord
          const serverSocket = net.connect(port, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

            if (head && head.length > 0) {
              serverSocket.write(head);
            }

            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
          });

          const cleanup = () => {
            this.stats.connectionSucceeded();
          };

          serverSocket.on('error', (err) => {
            console.error(`Direct connection error for ${hostname}:`, err.message);
            this.stats.connectionFailed();
            clientSocket.end();
          });

          clientSocket.on('error', (err) => {
            console.error(`Client socket error for ${hostname}:`, err.message);
            serverSocket.end();
          });

          serverSocket.on('close', cleanup);
        }
      });

      this.server.listen(this.port, () => {
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all active connections
      for (const socket of this.activeConnections) {
        socket.destroy();
      }
      this.activeConnections.clear();

      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }

  setUpstreamProxy(proxy: ProxyProvider): void {
    this.upstreamProxy = proxy;
    this.stats.resetProxyFailures(this.getProxyKey());
  }

  getStats(): StatsMonitor {
    return this.stats;
  }

  getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }

  getCurrentProxy(): ProxyProvider {
    return this.upstreamProxy;
  }
}
