import { ProxyProvider, getProxyUrl } from './providers';
import * as net from 'net';
import { TIMEOUTS, LIMITS } from '../config/constants';

export interface ProxyCheckResult {
  proxy: ProxyProvider;
  working: boolean;
  latency?: number;
}

export class ProxyChecker {
  /**
   * Check if SOCKS5 proxy is working by performing actual handshake
   */
  async check(proxy: ProxyProvider, timeout: number = TIMEOUTS.PROXY_CHECK): Promise<boolean> {
    if (proxy.protocol !== 'socks5') {
      // For HTTP/HTTPS proxies, just check TCP connection
      return this.checkTcp(proxy, timeout);
    }

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;
      let step = 0;
      const hasAuth = !!(proxy.username && proxy.password);

      const cleanup = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(result);
        }
      };

      const timer = setTimeout(() => cleanup(false), timeout);

      socket.setTimeout(timeout);

      socket.connect(proxy.port, proxy.host, () => {
        // Send SOCKS5 initial handshake
        // 0x00 = no auth, 0x02 = username/password
        if (hasAuth) {
          socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
        } else {
          socket.write(Buffer.from([0x05, 0x01, 0x00]));
        }
      });

      socket.on('data', (data) => {
        if (step === 0) {
          // Check authentication method response
          if (data.length >= 2 && data[0] === 0x05) {
            if (data[1] === 0x02 && hasAuth) {
              // Server wants username/password auth
              step = 1;
              const username = Buffer.from(proxy.username!);
              const password = Buffer.from(proxy.password!);
              const authRequest = Buffer.concat([
                Buffer.from([0x01, username.length]),
                username,
                Buffer.from([password.length]),
                password
              ]);
              socket.write(authRequest);
            } else if (data[1] === 0x00) {
              // No auth required - success
              cleanup(true);
            } else {
              cleanup(false);
            }
          } else {
            cleanup(false);
          }
        } else if (step === 1) {
          // Auth response
          if (data.length >= 2 && data[0] === 0x01 && data[1] === 0x00) {
            // Auth successful
            cleanup(true);
          } else {
            cleanup(false);
          }
        }
      });

      socket.on('error', () => cleanup(false));
      socket.on('timeout', () => cleanup(false));
    });
  }

  /**
   * Simple TCP connection check for HTTP/HTTPS proxies
   */
  private async checkTcp(proxy: ProxyProvider, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const cleanup = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(result);
        }
      };

      const timer = setTimeout(() => cleanup(false), timeout);

      socket.setTimeout(timeout);

      socket.connect(proxy.port, proxy.host, () => cleanup(true));

      socket.on('error', () => cleanup(false));
      socket.on('timeout', () => cleanup(false));
    });
  }

  /**
   * Check proxy and measure latency
   */
  async checkWithLatency(proxy: ProxyProvider, timeout: number = TIMEOUTS.PROXY_CHECK): Promise<ProxyCheckResult> {
    const startTime = Date.now();
    const working = await this.check(proxy, timeout);
    const latency = working ? Date.now() - startTime : undefined;

    return { proxy, working, latency };
  }

  /**
   * Find first working proxy from list
   */
  async findWorkingProxy(proxies: ProxyProvider[]): Promise<ProxyProvider | null> {
    for (const proxy of proxies) {
      const isWorking = await this.check(proxy);
      if (isWorking) {
        return proxy;
      }
    }
    return null;
  }

  /**
   * Find multiple working proxies sequentially
   */
  async findWorkingProxies(proxies: ProxyProvider[], maxCount: number = 3): Promise<ProxyProvider[]> {
    const working: ProxyProvider[] = [];

    for (const proxy of proxies) {
      if (working.length >= maxCount) break;

      const isWorking = await this.check(proxy);
      if (isWorking) {
        working.push(proxy);
      }
    }

    return working;
  }

  /**
   * Check multiple proxies in parallel
   */
  async checkParallel(proxies: ProxyProvider[], concurrency: number = LIMITS.PARALLEL_PROXY_CHECKS): Promise<ProxyCheckResult[]> {
    const results: ProxyCheckResult[] = [];

    // Process proxies in batches
    for (let i = 0; i < proxies.length; i += concurrency) {
      const batch = proxies.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(proxy => this.checkWithLatency(proxy))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Find first working proxy using parallel checks
   */
  async findWorkingProxyParallel(proxies: ProxyProvider[], concurrency: number = LIMITS.PARALLEL_PROXY_CHECKS): Promise<ProxyProvider | null> {
    // Process proxies in batches until we find a working one
    for (let i = 0; i < proxies.length; i += concurrency) {
      const batch = proxies.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(proxy => this.checkWithLatency(proxy))
      );

      // Find first working proxy in this batch, sorted by latency
      const working = results
        .filter(r => r.working)
        .sort((a, b) => (a.latency || Infinity) - (b.latency || Infinity));

      if (working.length > 0) {
        return working[0].proxy;
      }
    }

    return null;
  }

  /**
   * Find multiple working proxies using parallel checks
   */
  async findWorkingProxiesParallel(
    proxies: ProxyProvider[],
    maxCount: number = LIMITS.MAX_CACHED_PROXIES,
    concurrency: number = LIMITS.PARALLEL_PROXY_CHECKS
  ): Promise<ProxyProvider[]> {
    const allResults = await this.checkParallel(proxies, concurrency);

    // Return working proxies sorted by latency
    return allResults
      .filter(r => r.working)
      .sort((a, b) => (a.latency || Infinity) - (b.latency || Infinity))
      .slice(0, maxCount)
      .map(r => r.proxy);
  }
}
