import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ProxyProvider } from './providers';
import { PATHS, LIMITS, TIMEOUTS } from '../config/constants';

export interface CachedProxy {
  proxy: ProxyProvider;
  lastChecked: number;
  successRate: number;
  totalChecks: number;
  successfulChecks: number;
  averageLatency?: number;
}

export class ProxyCache {
  private cache: Map<string, CachedProxy> = new Map();
  private cacheFilePath: string;

  constructor() {
    this.cacheFilePath = path.join(os.tmpdir(), PATHS.CACHE_FILE);
  }

  /**
   * Get unique key for proxy
   */
  private getProxyKey(proxy: ProxyProvider): string {
    return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  }

  /**
   * Load cache from disk
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.cacheFilePath, 'utf-8');
      const cacheData: Array<[string, CachedProxy]> = JSON.parse(data);

      this.cache.clear();
      for (const [key, value] of cacheData) {
        this.cache.set(key, value);
      }
    } catch (err) {
      // Cache file doesn't exist or is invalid, start fresh
      this.cache.clear();
    }
  }

  /**
   * Save cache to disk
   */
  async save(): Promise<void> {
    try {
      const cacheData = Array.from(this.cache.entries());
      await fs.writeFile(this.cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf-8');
    } catch (err) {
      // Ignore save errors
    }
  }

  /**
   * Add or update proxy in cache
   */
  async add(proxy: ProxyProvider, success: boolean, latency?: number): Promise<void> {
    const key = this.getProxyKey(proxy);
    const existing = this.cache.get(key);

    if (existing) {
      existing.totalChecks++;
      if (success) {
        existing.successfulChecks++;
      }
      existing.successRate = existing.successfulChecks / existing.totalChecks;
      existing.lastChecked = Date.now();

      if (latency !== undefined && success) {
        // Update average latency
        if (existing.averageLatency === undefined) {
          existing.averageLatency = latency;
        } else {
          existing.averageLatency = (existing.averageLatency + latency) / 2;
        }
      }
    } else {
      this.cache.set(key, {
        proxy,
        lastChecked: Date.now(),
        successRate: success ? 1 : 0,
        totalChecks: 1,
        successfulChecks: success ? 1 : 0,
        averageLatency: success ? latency : undefined,
      });
    }

    // Limit cache size
    if (this.cache.size > LIMITS.MAX_CACHED_PROXIES * 2) {
      await this.prune();
    }

    await this.save();
  }

  /**
   * Get cached proxies sorted by reliability
   */
  getCached(maxCount: number = LIMITS.MAX_CACHED_PROXIES): ProxyProvider[] {
    const now = Date.now();
    const validCached = Array.from(this.cache.values())
      .filter(cached => {
        // Only return proxies checked recently and with good success rate
        const age = now - cached.lastChecked;
        return age < TIMEOUTS.PROXY_RECHECK_INTERVAL && cached.successRate > 0.5;
      })
      .sort((a, b) => {
        // Sort by success rate first, then by latency
        if (a.successRate !== b.successRate) {
          return b.successRate - a.successRate;
        }
        return (a.averageLatency || Infinity) - (b.averageLatency || Infinity);
      })
      .slice(0, maxCount);

    return validCached.map(cached => cached.proxy);
  }

  /**
   * Remove unreliable proxies from cache
   */
  private async prune(): Promise<void> {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, cached] of this.cache.entries()) {
      const age = now - cached.lastChecked;
      const isOld = age > TIMEOUTS.PROXY_RECHECK_INTERVAL * 2;
      const isUnreliable = cached.successRate < 0.3 && cached.totalChecks >= 3;

      if (isOld || isUnreliable) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear all cached proxies
   */
  async clear(): Promise<void> {
    this.cache.clear();
    try {
      await fs.unlink(this.cacheFilePath);
    } catch (err) {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { total: number; reliable: number; avgSuccessRate: number } {
    const total = this.cache.size;
    const now = Date.now();
    const reliable = Array.from(this.cache.values()).filter(
      cached => cached.successRate > 0.7 && now - cached.lastChecked < TIMEOUTS.PROXY_RECHECK_INTERVAL
    ).length;

    const avgSuccessRate = total > 0
      ? Array.from(this.cache.values()).reduce((sum, cached) => sum + cached.successRate, 0) / total
      : 0;

    return { total, reliable, avgSuccessRate };
  }
}
