import { ProxyChecker } from './checker';
import { ProxyProvider, getProxiesSortedByPriority } from './providers';
import { ProxyCache } from './cache';
import { TIMEOUTS, LIMITS } from '../config/constants';
import { logger } from '../utils/logger';

export interface HealthCheckResult {
  workingProxies: ProxyProvider[];
  failedProxies: ProxyProvider[];
  totalChecked: number;
  successRate: number;
}

export class ProxyHealthMonitor {
  private checker: ProxyChecker;
  private cache: ProxyCache;
  private checkInterval: NodeJS.Timeout | null = null;
  private onProxyDown?: (proxy: ProxyProvider) => void;

  constructor(cache: ProxyCache, onProxyDown?: (proxy: ProxyProvider) => void) {
    this.checker = new ProxyChecker();
    this.cache = cache;
    this.onProxyDown = onProxyDown;
  }

  /**
   * Start periodic health checks
   */
  start(intervalMs: number = TIMEOUTS.PROXY_RECHECK_INTERVAL): void {
    if (this.checkInterval) {
      this.stop();
    }

    logger.info(`Starting proxy health monitor (interval: ${intervalMs / 1000}s)`);

    this.checkInterval = setInterval(async () => {
      await this.checkAll();
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Proxy health monitor stopped');
    }
  }

  /**
   * Check all cached proxies
   */
  async checkAll(): Promise<HealthCheckResult> {
    const cachedProxies = this.cache.getCached(LIMITS.MAX_CACHED_PROXIES);
    const working: ProxyProvider[] = [];
    const failed: ProxyProvider[] = [];

    logger.debug(`Health check: checking ${cachedProxies.length} cached proxies`);

    // Check in batches
    for (let i = 0; i < cachedProxies.length; i += LIMITS.PROXY_HEALTH_CHECK_BATCH) {
      const batch = cachedProxies.slice(i, i + LIMITS.PROXY_HEALTH_CHECK_BATCH);
      const results = await Promise.all(
        batch.map(async (proxy) => ({
          proxy,
          working: await this.checker.check(proxy)
        }))
      );

      for (const result of results) {
        if (result.working) {
          working.push(result.proxy);
          await this.cache.add(result.proxy, true);
        } else {
          failed.push(result.proxy);
          await this.cache.add(result.proxy, false);

          if (this.onProxyDown) {
            this.onProxyDown(result.proxy);
          }
        }
      }
    }

    const totalChecked = working.length + failed.length;
    const successRate = totalChecked > 0 ? working.length / totalChecked : 0;

    logger.info(`Health check complete: ${working.length}/${totalChecked} working (${(successRate * 100).toFixed(1)}%)`);

    return {
      workingProxies: working,
      failedProxies: failed,
      totalChecked,
      successRate
    };
  }

  /**
   * Find new proxies to add to cache
   */
  async discoverNewProxies(count: number = 5): Promise<ProxyProvider[]> {
    const allProxies = getProxiesSortedByPriority();
    const cachedKeys = new Set(this.cache.getCached().map(p => `${p.host}:${p.port}`));

    // Filter out already cached proxies
    const uncached = allProxies.filter(p => !cachedKeys.has(`${p.host}:${p.port}`));

    if (uncached.length === 0) {
      logger.debug('No new proxies to discover');
      return [];
    }

    logger.debug(`Discovering new proxies from ${uncached.length} candidates`);

    const working = await this.checker.findWorkingProxiesParallel(uncached, count);

    for (const proxy of working) {
      await this.cache.add(proxy, true);
    }

    logger.info(`Discovered ${working.length} new working proxies`);
    return working;
  }
}
