export const TIMEOUTS = {
  PROXY_CHECK: 3000,
  PROXY_CONNECT: 5000,
  SOCKET_IDLE: 300000, // 5 minutes
  PROXY_RECHECK_INTERVAL: 300000, // 5 minutes
};

export const LIMITS = {
  MAX_CACHED_PROXIES: 10,
  MAX_CONNECTIONS: 1000,
  PARALLEL_PROXY_CHECKS: 20,
  MAX_PROXY_FAILURES: 3,
};

export const PATHS = {
  CACHE_FILE: 'veto-proxy-cache.json',
};
