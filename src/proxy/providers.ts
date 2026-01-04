export interface ProxyProvider {
  name: string;
  host: string;
  port: number;
  protocol: 'socks5' | 'http' | 'https';
  country: string;
  username?: string;
  password?: string;
  priority?: number; // Higher priority = checked first
}

// Decodo credentials (obfuscated)
const _d = (s: string) => Buffer.from(s, 'base64').toString('utf8');
const DECODO_USER = _d('REJtYWlubGlzdA==');
const DECODO_PASS = _d('dkExaE8xM1B2bl9qbDFtd1Rm');

export const BUILTIN_PROXIES: ProxyProvider[] = [
  // Primary Decodo proxies (high reliability)
  {
    name: 'Decodo-EU-1',
    host: 'isp.decodo.com',
    port: 10001,
    protocol: 'socks5',
    country: 'EU',
    username: DECODO_USER,
    password: DECODO_PASS,
    priority: 100
  },
  {
    name: 'Decodo-EU-2',
    host: 'isp.decodo.com',
    port: 10002,
    protocol: 'socks5',
    country: 'EU',
    username: DECODO_USER,
    password: DECODO_PASS,
    priority: 100
  },
  {
    name: 'Decodo-EU-3',
    host: 'isp.decodo.com',
    port: 10003,
    protocol: 'socks5',
    country: 'EU',
    username: DECODO_USER,
    password: DECODO_PASS,
    priority: 100
  },
  // Additional backup proxies (public SOCKS5)
  // Netherlands
  {
    name: 'NL-Amsterdam-1',
    host: '45.140.143.77',
    port: 8080,
    protocol: 'socks5',
    country: 'NL',
    priority: 80
  },
  {
    name: 'NL-Amsterdam-2',
    host: '51.158.123.35',
    port: 8080,
    protocol: 'socks5',
    country: 'NL',
    priority: 80
  },
  // Germany
  {
    name: 'DE-Frankfurt-1',
    host: '138.201.125.229',
    port: 8118,
    protocol: 'socks5',
    country: 'DE',
    priority: 75
  },
  {
    name: 'DE-Berlin-1',
    host: '195.201.23.163',
    port: 1080,
    protocol: 'socks5',
    country: 'DE',
    priority: 75
  },
  // Finland (close to Russia, good latency)
  {
    name: 'FI-Helsinki-1',
    host: '95.216.164.27',
    port: 1080,
    protocol: 'socks5',
    country: 'FI',
    priority: 85
  },
  // Poland
  {
    name: 'PL-Warsaw-1',
    host: '188.165.226.246',
    port: 1080,
    protocol: 'socks5',
    country: 'PL',
    priority: 80
  },
  // France
  {
    name: 'FR-Paris-1',
    host: '163.172.168.221',
    port: 1080,
    protocol: 'socks5',
    country: 'FR',
    priority: 70
  },
  // UK
  {
    name: 'UK-London-1',
    host: '51.89.21.68',
    port: 1080,
    protocol: 'socks5',
    country: 'UK',
    priority: 70
  },
  // USA (higher latency but reliable)
  {
    name: 'US-NewYork-1',
    host: '198.55.125.130',
    port: 1080,
    protocol: 'socks5',
    country: 'US',
    priority: 50
  },
  {
    name: 'US-LosAngeles-1',
    host: '184.178.172.14',
    port: 4145,
    protocol: 'socks5',
    country: 'US',
    priority: 50
  },
];

export function getProxyUrl(proxy: ProxyProvider): string {
  return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
}

export function getRandomProxy(): ProxyProvider {
  return BUILTIN_PROXIES[Math.floor(Math.random() * BUILTIN_PROXIES.length)];
}

export function getProxiesSortedByPriority(): ProxyProvider[] {
  return [...BUILTIN_PROXIES].sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

// Parse proxy URL string to ProxyProvider
export function parseProxyUrl(url: string): ProxyProvider | null {
  try {
    // Formats: socks5://host:port, socks5://user:pass@host:port
    const match = url.match(/^(socks5|http|https):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/i);
    if (!match) return null;

    const [, protocol, username, password, host, port] = match;
    return {
      name: `Custom-${host}`,
      host,
      port: parseInt(port, 10),
      protocol: protocol.toLowerCase() as 'socks5' | 'http' | 'https',
      country: 'Custom',
      username: username || undefined,
      password: password || undefined,
      priority: 200 // User-provided proxies have highest priority
    };
  } catch {
    return null;
  }
}
