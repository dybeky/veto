#!/usr/bin/env node

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  setTimeout(() => process.exit(1), 1000);
});

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ProxyServer } from './proxy/server';
import { PACGenerator } from './pac/generator';
import { SystemProxy } from './system/proxy';
import { Banner } from './ui/banner';
import { LOCAL_PROXY_PORT } from './config/domains';
import { BUILTIN_PROXIES, ProxyProvider } from './proxy/providers';
import { ProxyChecker } from './proxy/checker';
import { ProxyCache } from './proxy/cache';
import { StatsMonitor } from './monitoring/stats';

const program = new Command();

let proxyServer: ProxyServer | null = null;
let systemProxy: SystemProxy | null = null;
let currentProxy: ProxyProvider | null = null;
let proxyCache: ProxyCache = new ProxyCache();
let statsMonitor: StatsMonitor = new StatsMonitor();
let statsInterval: NodeJS.Timeout | null = null;

async function findWorkingProxy(): Promise<ProxyProvider> {
  const spinner = ora('Finding working proxy server...').start();
  const checker = new ProxyChecker();

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
        return proxy;
      } else {
        await proxyCache.add(proxy, false);
      }
    }
  }

  // If no cached proxy works, find new ones using parallel search
  spinner.text = 'Searching for working proxies in parallel...';
  const workingProxy = await checker.findWorkingProxyParallel(BUILTIN_PROXIES);

  if (workingProxy) {
    spinner.succeed(`Connected to ${workingProxy.name} (${workingProxy.country})`);
    await proxyCache.add(workingProxy, true);

    // Cache more working proxies in background
    checker.findWorkingProxiesParallel(BUILTIN_PROXIES, 10).then(async (proxies) => {
      for (const proxy of proxies) {
        await proxyCache.add(proxy, true);
      }
    });

    return workingProxy;
  }

  spinner.fail('No working proxy found');
  throw new Error('Could not find a working proxy server. Please try again later.');
}

async function getNextWorkingProxy(): Promise<ProxyProvider | null> {
  const checker = new ProxyChecker();

  // Try cached proxies first
  const cachedProxies = proxyCache.getCached(5);
  for (const proxy of cachedProxies) {
    const isWorking = await checker.check(proxy);
    if (isWorking) {
      await proxyCache.add(proxy, true);
      return proxy;
    }
    await proxyCache.add(proxy, false);
  }

  // Find new working proxy
  const workingProxy = await checker.findWorkingProxyParallel(BUILTIN_PROXIES);
  if (workingProxy) {
    await proxyCache.add(workingProxy, true);
  }

  return workingProxy;
}

async function startProxy(options: any) {
  try {
    await Banner.show();

    try {
      currentProxy = await findWorkingProxy();
    } catch (err) {
      Banner.showBox(
        'No proxy available',
        'Could not connect to any proxy server.\nThis might be due to network restrictions.\n\n' +
        'Error: ' + (err instanceof Error ? err.message : String(err)),
        'error'
      );
      process.exit(1);
    }

    const spinner = ora('Starting Veto proxy...').start();

    proxyServer = new ProxyServer(options.port || LOCAL_PROXY_PORT, currentProxy, {
      onProxyFailed: getNextWorkingProxy,
      statsMonitor: statsMonitor,
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

    const cacheStats = proxyCache.getStats();
    Banner.showStatus('Cached Proxies', `${cacheStats.reliable}/${cacheStats.total} reliable`, 'active');
    console.log('');

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
  } catch (err) {
    spinner.fail('Error during shutdown');
    console.error(err);
  }
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
  .version('2.0.0');

program
  .command('start')
  .description('Start the proxy server')
  .option('-p, --port <number>', 'Local proxy port', String(LOCAL_PROXY_PORT))
  .action(startProxy);

program
  .command('stop')
  .description('Stop the proxy server')
  .action(stopProxy);

program
  .command('status')
  .description('Show proxy status')
  .action(showStatus);

if (process.argv.length === 2) {
  // When double-clicked (no arguments), start the proxy automatically
  startProxy({ port: LOCAL_PROXY_PORT });
} else {
  program.parse(process.argv);
}
