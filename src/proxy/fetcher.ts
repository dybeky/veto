import * as https from 'https';
import * as http from 'http';
import { ProxyProvider } from './providers';

export class ProxyFetcher {
  private static readonly PROXY_SOURCES = [
    // Free proxy lists APIs
    {
      url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=all&ssl=all&anonymity=all',
      parser: 'plain' as const,
      protocol: 'socks5' as const
    },
    {
      url: 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
      parser: 'plain' as const,
      protocol: 'socks5' as const
    },
    {
      url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt',
      parser: 'plain' as const,
      protocol: 'socks5' as const
    },
    {
      url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
      parser: 'plain' as const,
      protocol: 'socks5' as const
    },
    {
      url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
      parser: 'plain' as const,
      protocol: 'socks5' as const
    },
    {
      url: 'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt',
      parser: 'plain' as const,
      protocol: 'socks5' as const
    },
    {
      url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt',
      parser: 'plain' as const,
      protocol: 'socks5' as const
    },
    // HTTP proxies as fallback
    {
      url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
      parser: 'plain' as const,
      protocol: 'http' as const
    },
    {
      url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
      parser: 'plain' as const,
      protocol: 'http' as const
    }
  ];

  /**
   * Fetch proxy list from URL
   */
  private static fetchUrl(url: string, timeout: number = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const req = protocol.get(url, {
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this.fetchUrl(redirectUrl, timeout).then(resolve).catch(reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Parse plain text proxy list (ip:port format)
   */
  private static parsePlainList(data: string, protocol: 'socks5' | 'http'): ProxyProvider[] {
    const proxies: ProxyProvider[] = [];
    const lines = data.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Match ip:port pattern
      const match = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
      if (match) {
        const host = match[1];
        const port = parseInt(match[2]);

        if (port > 0 && port < 65536) {
          proxies.push({
            name: `${protocol.toUpperCase()}-${host}`,
            host,
            port,
            protocol,
            country: 'XX' // Unknown country
          });
        }
      }
    }

    return proxies;
  }

  /**
   * Fetch proxies from all sources
   */
  static async fetchAll(onProgress?: (msg: string) => void): Promise<ProxyProvider[]> {
    const allProxies: ProxyProvider[] = [];
    const seenProxies = new Set<string>();

    for (const source of this.PROXY_SOURCES) {
      try {
        onProgress?.(`Fetching from ${new URL(source.url).hostname}...`);

        const data = await this.fetchUrl(source.url);
        let proxies: ProxyProvider[] = [];

        if (source.parser === 'plain') {
          proxies = this.parsePlainList(data, source.protocol);
        }

        // Deduplicate
        for (const proxy of proxies) {
          const key = `${proxy.host}:${proxy.port}`;
          if (!seenProxies.has(key)) {
            seenProxies.add(key);
            allProxies.push(proxy);
          }
        }

        onProgress?.(`Found ${proxies.length} proxies`);
      } catch (err) {
        // Silently skip failed sources
        onProgress?.(`Failed to fetch from source`);
      }
    }

    // Shuffle proxies for better distribution
    for (let i = allProxies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allProxies[i], allProxies[j]] = [allProxies[j], allProxies[i]];
    }

    return allProxies;
  }

  /**
   * Fetch only SOCKS5 proxies (preferred for Discord)
   */
  static async fetchSocks5(onProgress?: (msg: string) => void): Promise<ProxyProvider[]> {
    const all = await this.fetchAll(onProgress);
    return all.filter(p => p.protocol === 'socks5');
  }
}
