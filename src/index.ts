#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ProxyServer } from './proxy/server';
import { PACGenerator } from './pac/generator';
import { SystemProxy } from './system/proxy';
import { Banner } from './ui/banner';
import { LOCAL_PROXY_PORT } from './config/domains';
import { BUILTIN_PROXIES, ProxyProvider, getProxiesSortedByPriority, parseProxyUrl } from './proxy/providers';
import { ProxyChecker } from './proxy/checker';
import { ProxyCache } from './proxy/cache';
import { StatsMonitor } from './monitoring/stats';
import { DiscordLauncher } from './discord/launcher';
import { AutoStart } from './system/autostart';
import { logger } from './utils/logger';

// Initialize logger
logger.init({ level: 'info', console: false, file: true });

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  console.error('Uncaught Exception:', error);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  setTimeout(() => process.exit(1), 1000);
});

const program = new Command();

let proxyServer: ProxyServer | null = null;
let systemProxy: SystemProxy | null = null;
let currentProxy: ProxyProvider | null = null;
let proxyCache: ProxyCache = new ProxyCache();
let statsMonitor: StatsMonitor = new StatsMonitor();
let statsInterval: NodeJS.Timeout | null = null;

async function findWorkingProxy(customProxyUrl?: string): Promise<ProxyProvider> {
  const spinner = ora('Finding working proxy server...').start();
  const checker = new ProxyChecker();

  // If custom proxy is provided, try it first
  if (customProxyUrl) {
    spinner.text = 'Testing custom proxy...';
    const customProxy = parseProxyUrl(customProxyUrl);
    if (customProxy) {
      const isWorking = await checker.check(customProxy);
      if (isWorking) {
        spinner.succeed(`Connected to custom proxy (${customProxy.host}:${customProxy.port})`);
        logger.info(`Using custom proxy: ${customProxyUrl}`);
        return customProxy;
      } else {
        spinner.warn('Custom proxy not working, trying built-in proxies...');
        logger.warn(`Custom proxy failed: ${customProxyUrl}`);
      }
    } else {
      spinner.warn('Invalid proxy URL format, trying built-in proxies...');
    }
  }

  // Load cache
  await proxyCache.load();

  // Try cached proxies first
  const cachedProxies = proxyCache.getCached(5);
  if (cachedProxies.length > 0) {
    spinner.text = 'Checking cached proxies...';
    for (const proxy of cachedProxies) {
      spinner.text = `Testing cached ${proxy.name} (${proxy.country})...`;
      const isWorking = await checker.check(proxy);

      if (isWorking) {
        spinner.succeed(`Connected to ${proxy.name} (${proxy.country}) [cached]`);
        await proxyCache.add(proxy, true);
        logger.info(`Using cached proxy: ${proxy.name}`);
        return proxy;
      } else {
        await proxyCache.add(proxy, false);
      }
    }
  }

  // Use built-in proxies sorted by priority
  const allProxies = getProxiesSortedByPriority();

  // Find working proxy using parallel search
  spinner.text = `Testing ${allProxies.length} proxies in parallel...`;
  const workingProxy = await checker.findWorkingProxyParallel(allProxies);

  if (workingProxy) {
    spinner.succeed(`Connected to ${workingProxy.name} (${workingProxy.host}:${workingProxy.port})`);
    await proxyCache.add(workingProxy, true);
    logger.info(`Found working proxy: ${workingProxy.name}`);

    // Cache more working proxies in background
    checker.findWorkingProxiesParallel(allProxies, 10).then(async (proxies) => {
      for (const proxy of proxies) {
        await proxyCache.add(proxy, true);
      }
      logger.debug(`Cached ${proxies.length} additional proxies`);
    });

    return workingProxy;
  }

  spinner.fail('No working proxy found');
  logger.error('No working proxy found');
  throw new Error('Could not find a working proxy server. Please try again later.');
}

async function getNextWorkingProxy(): Promise<ProxyProvider | null> {
  const checker = new ProxyChecker();
  logger.info('Searching for alternative proxy...');

  // Try cached proxies first (excluding current)
  const cachedProxies = proxyCache.getCached(5);
  for (const proxy of cachedProxies) {
    // Skip the current proxy
    if (currentProxy && proxy.host === currentProxy.host && proxy.port === currentProxy.port) {
      continue;
    }

    const isWorking = await checker.check(proxy);
    if (isWorking) {
      await proxyCache.add(proxy, true);
      logger.info(`Found alternative cached proxy: ${proxy.name}`);
      return proxy;
    }
    await proxyCache.add(proxy, false);
  }

  // Use built-in proxies sorted by priority
  const allProxies = getProxiesSortedByPriority();

  // Find new working proxy
  const workingProxy = await checker.findWorkingProxyParallel(allProxies);
  if (workingProxy) {
    await proxyCache.add(workingProxy, true);
    logger.info(`Found alternative proxy: ${workingProxy.name}`);
  } else {
    logger.error('No alternative proxy found');
  }

  return workingProxy;
}

async function startProxy(options: any) {
  try {
    await Banner.show();
    logger.info('Starting Veto proxy...');

    try {
      currentProxy = await findWorkingProxy(options.proxy);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to find proxy: ${errorMsg}`);
      Banner.showBox(
        'No proxy available',
        'Could not connect to any proxy server.\nThis might be due to network restrictions.\n\n' +
        'Error: ' + errorMsg,
        'error'
      );
      process.exit(1);
    }

    const spinner = ora('Starting Veto proxy...').start();

    proxyServer = new ProxyServer(options.port || LOCAL_PROXY_PORT, currentProxy, {
      onProxyFailed: getNextWorkingProxy,
      statsMonitor: statsMonitor,
      useDoH: !options.noDoH, // Enable DoH unless explicitly disabled
    });
    await proxyServer.start();
    spinner.succeed('Proxy server started on port ' + proxyServer.getPort());

    const pacSpinner = ora('Generating PAC file...').start();
    const pacPath = await PACGenerator.write();
    pacSpinner.succeed('PAC file created');

    const sysSpinner = ora('Configuring system proxy...').start();
    systemProxy = new SystemProxy(pacPath);
    await systemProxy.enable();
    sysSpinner.succeed('System proxy configured');

    // Check autostart status
    const autoStartEnabled = await AutoStart.isEnabled();

    Banner.showBox(
      'Veto is running!',
      'Discord traffic is now being routed through the proxy.\n' +
      'Other applications will connect directly.\n\n' +
      chalk.bold('Press Ctrl+C to stop'),
      'success'
    );

    console.log('');
    Banner.showStatus('Proxy Server', `localhost:${proxyServer.getPort()}`, 'active');
    Banner.showStatus('Upstream Proxy', `${currentProxy.name} (${currentProxy.country})`, 'active');
    Banner.showStatus('System Proxy', 'Enabled', 'active');
    Banner.showStatus('Discord Routing', 'Through proxy', 'active');
    Banner.showStatus('Other Traffic', 'Direct connection', 'active');
    Banner.showStatus('DNS over HTTPS', options.noDoH ? 'Disabled' : 'Enabled', options.noDoH ? 'inactive' : 'active');
    Banner.showStatus('Auto-start', autoStartEnabled ? 'Enabled' : 'Disabled', autoStartEnabled ? 'active' : 'inactive');

    const cacheStats = proxyCache.getStats();
    Banner.showStatus('Cached Proxies', `${cacheStats.reliable}/${cacheStats.total} reliable`, 'active');
    console.log('');

    logger.info(`Veto started - Proxy: ${currentProxy.name}, Port: ${proxyServer.getPort()}`);

    // Auto-launch Discord with proxy settings
    if (!options.noDiscord) {
      const discordSpinner = ora('Launching Discord with proxy...').start();

      const discordInfo = await DiscordLauncher.getInfo();

      if (!discordInfo.installed) {
        discordSpinner.warn('Discord not found - please launch manually with proxy flag');
      } else {
        const launched = await DiscordLauncher.launch({
          proxyHost: '127.0.0.1',
          proxyPort: proxyServer.getPort(),
          killExisting: true // Kill existing Discord to restart with proxy
        });

        if (launched) {
          discordSpinner.succeed('Discord launched with proxy settings');
          Banner.showStatus('Discord', 'Running with proxy', 'active');
        } else {
          discordSpinner.fail('Failed to launch Discord');
        }
      }
      console.log('');
    }

    // Start periodic stats logging
    statsInterval = setInterval(() => {
      const stats = statsMonitor.getStats();
      if (stats.totalConnections > 0) {
        console.log(chalk.gray(`[Stats] Connections: ${stats.totalConnections} total, ${stats.activeConnections} active, ${stats.successfulConnections} successful`));
      }
    }, 30000); // Every 30 seconds

    process.on('SIGINT', async () => {
      await stopProxy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await stopProxy();
      process.exit(0);
    });

  } catch (err) {
    Banner.showBox(
      'Failed to start',
      err instanceof Error ? err.message : String(err),
      'error'
    );
    process.exit(1);
  }
}

async function stopProxy() {
  console.log('');
  const spinner = ora('Stopping Veto...').start();
  logger.info('Stopping Veto...');

  try {
    // Stop stats interval
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }

    if (systemProxy) {
      await systemProxy.disable();
    }

    if (proxyServer) {
      await proxyServer.stop();
    }

    await PACGenerator.remove();

    // Show final stats
    const finalStats = statsMonitor.getFormattedStats();

    spinner.succeed('Veto stopped');
    Banner.showBox('Stopped', 'Proxy has been disabled and cleaned up.\n\nSession Statistics:\n' + finalStats, 'info');
    logger.info('Veto stopped successfully');
    logger.close();
  } catch (err) {
    spinner.fail('Error during shutdown');
    logger.error('Error during shutdown:', err);
    console.error(err);
  }
}

async function toggleAutoStart() {
  await Banner.show();

  const spinner = ora('Toggling autostart...').start();

  try {
    const enabled = await AutoStart.toggle();
    if (enabled) {
      spinner.succeed('Autostart enabled - Veto will start when Windows boots');
      logger.info('Autostart enabled');
    } else {
      spinner.succeed('Autostart disabled');
      logger.info('Autostart disabled');
    }
  } catch (err) {
    spinner.fail('Failed to toggle autostart');
    console.error(err);
  }
}

async function showLogs() {
  const logs = await logger.readRecentLogs(100);
  if (logs.length === 0) {
    console.log(chalk.yellow('No logs found'));
  } else {
    console.log(chalk.bold('Recent logs:'));
    console.log('');
    logs.forEach(log => console.log(log));
  }
  console.log('');
  console.log(chalk.gray(`Log file: ${logger.getLogFilePath()}`));
}

async function showStatus() {
  await Banner.show();

  try {
    const pacPath = PACGenerator.getFilePath();
    const sysProxy = new SystemProxy(pacPath);
    const isEnabled = await sysProxy.getStatus();

    if (isEnabled) {
      Banner.showBox(
        'Status: Running',
        'Veto proxy is currently active',
        'success'
      );

      console.log('');
      Banner.showStatus('System Proxy', 'Enabled', 'active');
      Banner.showStatus('Discord Traffic', 'Routed through proxy', 'active');

      if (proxyServer) {
        const currentProxyInfo = proxyServer.getCurrentProxy();
        Banner.showStatus('Current Proxy', `${currentProxyInfo.name} (${currentProxyInfo.country})`, 'active');
        Banner.showStatus('Active Connections', String(proxyServer.getActiveConnectionCount()), 'active');

        const stats = proxyServer.getStats().getFormattedStats();
        console.log('');
        console.log(chalk.bold('Statistics:'));
        console.log(stats);
      }

      const cacheStats = proxyCache.getStats();
      console.log('');
      console.log(chalk.bold('Proxy Cache:'));
      console.log(`  Total Cached: ${cacheStats.total}`);
      console.log(`  Reliable: ${cacheStats.reliable}`);
      console.log(`  Avg Success Rate: ${(cacheStats.avgSuccessRate * 100).toFixed(1)}%`);
      console.log('');
    } else {
      Banner.showBox(
        'Status: Stopped',
        'Veto proxy is not running',
        'info'
      );
    }
  } catch (err) {
    Banner.showBox(
      'Error',
      err instanceof Error ? err.message : String(err),
      'error'
    );
  }
}

program
  .name('veto')
  .description('Discord proxy bypass for Russian users')
  .version('2.1.0');

program
  .command('start')
  .description('Start the proxy server')
  .option('-p, --port <number>', 'Local proxy port', String(LOCAL_PROXY_PORT))
  .option('--proxy <url>', 'Custom proxy URL (e.g., socks5://host:port or socks5://user:pass@host:port)')
  .option('--no-discord', 'Do not auto-launch Discord')
  .option('--no-doh', 'Disable DNS over HTTPS')
  .action(startProxy);

program
  .command('stop')
  .description('Stop the proxy server')
  .action(stopProxy);

program
  .command('status')
  .description('Show proxy status')
  .action(showStatus);

program
  .command('autostart')
  .description('Toggle Windows autostart')
  .action(toggleAutoStart);

program
  .command('logs')
  .description('Show recent logs')
  .action(showLogs);

if (process.argv.length === 2) {
  // When double-clicked (no arguments), start the proxy automatically
  startProxy({ port: LOCAL_PROXY_PORT });
} else {
  program.parse(process.argv);
}
