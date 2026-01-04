export const TIMEOUTS = {
  PROXY_CHECK: 5000,        // 5 seconds - more time for slow proxies
  PROXY_CONNECT: 8000,      // 8 seconds - allow for high latency
  SOCKET_IDLE: 120000,      // 2 minutes - reduced for resource efficiency
  PROXY_RECHECK_INTERVAL: 180000, // 3 minutes - more frequent health checks
  DNS_RESOLVE: 5000,        // 5 seconds for DNS resolution
  RETRY_DELAY: 1000,        // 1 second between retries
};

export const LIMITS = {
  MAX_CACHED_PROXIES: 20,       // More cached proxies
  MAX_CONNECTIONS: 500,         // Reduced to prevent resource exhaustion
  PARALLEL_PROXY_CHECKS: 10,    // Reduced to prevent detection
  MAX_PROXY_FAILURES: 5,        // More tolerance before switching
  MAX_RETRIES: 2,               // Number of retry attempts
  PROXY_HEALTH_CHECK_BATCH: 5,  // Proxies to check at once during health check
};

export const PATHS = {
  CACHE_FILE: 'veto-proxy-cache.json',
  LOG_FILE: 'veto.log',
  CONFIG_FILE: 'veto-config.json',
};

// DNS over HTTPS providers
export const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/dns-query',
  'https://dns.quad9.net/dns-query',
];
