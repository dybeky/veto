import { ProxyProvider, getProxyUrl } from './providers';
import * as net from 'net';

export class ProxyChecker {
  async check(proxy: ProxyProvider, timeout: number = 3000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const timer = setTimeout(() => {
        resolved = true;
        socket.destroy();
        resolve(false);
      }, timeout);

      socket.setTimeout(timeout);

      socket.connect(proxy.port, proxy.host, () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(true);
        }
      });

      socket.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(false);
        }
      });

      socket.on('timeout', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(false);
        }
      });
    });
  }

  async findWorkingProxy(proxies: ProxyProvider[]): Promise<ProxyProvider | null> {
    for (const proxy of proxies) {
      const isWorking = await this.check(proxy);
      if (isWorking) {
        return proxy;
      }
    }
    return null;
  }

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
}
