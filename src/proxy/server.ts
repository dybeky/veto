import * as http from 'http';
import * as net from 'net';
import { DISCORD_DOMAINS } from '../config/domains';
import { ProxyProvider } from './providers';

export class ProxyServer {
  private server: http.Server | null = null;
  private port: number;
  private upstreamProxy: ProxyProvider;

  constructor(port: number, upstreamProxy: ProxyProvider) {
    this.port = port;
    this.upstreamProxy = upstreamProxy;
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

  private async connectThroughSocks5(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.upstreamProxy.port, this.upstreamProxy.host, () => {
        // SOCKS5 handshake
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      });

      let step = 0;

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
            socket.destroy();
            reject(new Error('SOCKS5 auth failed'));
          }
        } else if (step === 1) {
          // Connection response
          if (data[0] === 0x05 && data[1] === 0x00) {
            resolve(socket);
          } else {
            socket.destroy();
            reject(new Error('SOCKS5 connect failed'));
          }
        }
      });

      socket.on('error', reject);
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

        if (this.isDiscordDomain(hostname)) {
          try {
            const proxySocket = await this.connectThroughSocks5(hostname, port);
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            proxySocket.pipe(clientSocket);
            clientSocket.pipe(proxySocket);

            proxySocket.on('error', () => clientSocket.end());
            clientSocket.on('error', () => proxySocket.end());
          } catch (err) {
            clientSocket.end();
          }
        } else {
          // Direct HTTPS connection for non-Discord
          const serverSocket = net.connect(port, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
          });

          serverSocket.on('error', () => clientSocket.end());
          clientSocket.on('error', () => serverSocket.end());
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
  }
}
