import * as https from 'https';
import * as dns from 'dns';
import { DOH_PROVIDERS, TIMEOUTS } from '../config/constants';

interface DNSAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DNSResponse {
  Status: number;
  Answer?: DNSAnswer[];
}

// Cache for DNS responses
const dnsCache = new Map<string, { ip: string; expires: number }>();

export class DoHResolver {
  private providers: string[];
  private currentProviderIndex: number = 0;

  constructor(providers: string[] = DOH_PROVIDERS) {
    this.providers = providers;
  }

  /**
   * Resolve hostname using DNS over HTTPS
   */
  async resolve(hostname: string): Promise<string | null> {
    // Check cache first
    const cached = dnsCache.get(hostname);
    if (cached && cached.expires > Date.now()) {
      return cached.ip;
    }

    // Try DoH providers
    for (let i = 0; i < this.providers.length; i++) {
      const providerIndex = (this.currentProviderIndex + i) % this.providers.length;
      const provider = this.providers[providerIndex];

      try {
        const ip = await this.resolveWithProvider(hostname, provider);
        if (ip) {
          // Cache the result (5 minutes TTL)
          dnsCache.set(hostname, { ip, expires: Date.now() + 300000 });
          this.currentProviderIndex = providerIndex; // Remember working provider
          return ip;
        }
      } catch {
        // Try next provider
        continue;
      }
    }

    // Fallback to system DNS
    return this.resolveWithSystemDNS(hostname);
  }

  /**
   * Resolve using specific DoH provider
   */
  private resolveWithProvider(hostname: string, provider: string): Promise<string | null> {
    return new Promise((resolve) => {
      const url = new URL(provider);
      url.searchParams.set('name', hostname);
      url.searchParams.set('type', 'A');

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Accept': 'application/dns-json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: TIMEOUTS.DNS_RESOLVE
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response: DNSResponse = JSON.parse(data);
            if (response.Status === 0 && response.Answer && response.Answer.length > 0) {
              // Find A record (type 1)
              const aRecord = response.Answer.find(a => a.type === 1);
              if (aRecord) {
                resolve(aRecord.data);
                return;
              }
            }
            resolve(null);
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Fallback to system DNS resolver
   */
  private resolveWithSystemDNS(hostname: string): Promise<string | null> {
    return new Promise((resolve) => {
      dns.resolve4(hostname, (err, addresses) => {
        if (err || !addresses || addresses.length === 0) {
          resolve(null);
        } else {
          // Cache the result
          dnsCache.set(hostname, { ip: addresses[0], expires: Date.now() + 300000 });
          resolve(addresses[0]);
        }
      });
    });
  }

  /**
   * Clear DNS cache
   */
  clearCache(): void {
    dnsCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: dnsCache.size,
      entries: Array.from(dnsCache.keys())
    };
  }
}

// Global resolver instance
export const dohResolver = new DoHResolver();
