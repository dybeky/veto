export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  successfulConnections: number;
  failedConnections: number;
  totalBytesTransferred: number;
  startTime: number;
}

export class StatsMonitor {
  private stats: ConnectionStats = {
    totalConnections: 0,
    activeConnections: 0,
    successfulConnections: 0,
    failedConnections: 0,
    totalBytesTransferred: 0,
    startTime: Date.now(),
  };

  private proxyFailures: Map<string, number> = new Map();

  /**
   * Record new connection attempt
   */
  connectionStarted(): void {
    this.stats.totalConnections++;
    this.stats.activeConnections++;
  }

  /**
   * Record successful connection
   */
  connectionSucceeded(): void {
    this.stats.successfulConnections++;
    this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
  }

  /**
   * Record failed connection
   */
  connectionFailed(proxyKey?: string): void {
    this.stats.failedConnections++;
    this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);

    if (proxyKey) {
      const failures = this.proxyFailures.get(proxyKey) || 0;
      this.proxyFailures.set(proxyKey, failures + 1);
    }
  }

  /**
   * Record data transfer
   */
  dataTransferred(bytes: number): void {
    this.stats.totalBytesTransferred += bytes;
  }

  /**
   * Get proxy failure count
   */
  getProxyFailures(proxyKey: string): number {
    return this.proxyFailures.get(proxyKey) || 0;
  }

  /**
   * Reset proxy failure count
   */
  resetProxyFailures(proxyKey: string): void {
    this.proxyFailures.delete(proxyKey);
  }

  /**
   * Get current statistics
   */
  getStats(): ConnectionStats {
    return { ...this.stats };
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.stats.startTime) / 1000);
  }

  /**
   * Get success rate
   */
  getSuccessRate(): number {
    const total = this.stats.successfulConnections + this.stats.failedConnections;
    return total > 0 ? this.stats.successfulConnections / total : 0;
  }

  /**
   * Get formatted statistics
   */
  getFormattedStats(): string {
    const uptime = this.getUptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    const successRate = (this.getSuccessRate() * 100).toFixed(1);
    const bytesInMB = (this.stats.totalBytesTransferred / (1024 * 1024)).toFixed(2);

    return `
Uptime: ${hours}h ${minutes}m ${seconds}s
Total Connections: ${this.stats.totalConnections}
Active Connections: ${this.stats.activeConnections}
Successful: ${this.stats.successfulConnections}
Failed: ${this.stats.failedConnections}
Success Rate: ${successRate}%
Data Transferred: ${bytesInMB} MB
    `.trim();
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalBytesTransferred: 0,
      startTime: Date.now(),
    };
    this.proxyFailures.clear();
  }
}
