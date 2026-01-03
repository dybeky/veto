export interface ProxyProvider {
  name: string;
  host: string;
  port: number;
  protocol: 'socks5' | 'http' | 'https';
  country: string;
  username?: string;
  password?: string;
}

export const BUILTIN_PROXIES: ProxyProvider[] = [
  {
    name: 'Decodo-1',
    host: 'isp.decodo.com',
    port: 10001,
    protocol: 'socks5',
    country: 'EU',
    username: 'DBmainlist',
    password: 'vA1hO13Pvn_jl1mwTf'
  },
  {
    name: 'Decodo-2',
    host: 'isp.decodo.com',
    port: 10002,
    protocol: 'socks5',
    country: 'EU',
    username: 'DBmainlist',
    password: 'vA1hO13Pvn_jl1mwTf'
  },
  {
    name: 'Decodo-3',
    host: 'isp.decodo.com',
    port: 10003,
    protocol: 'socks5',
    country: 'EU',
    username: 'DBmainlist',
    password: 'vA1hO13Pvn_jl1mwTf'
  },
];

export function getProxyUrl(proxy: ProxyProvider): string {
  return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
}

export function getRandomProxy(): ProxyProvider {
  return BUILTIN_PROXIES[Math.floor(Math.random() * BUILTIN_PROXIES.length)];
}
