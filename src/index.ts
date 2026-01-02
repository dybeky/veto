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

const program = new Command();

let proxyServer: ProxyServer | null = null;
let systemProxy: SystemProxy | null = null;
let currentProxy: ProxyProvider | null = null;

async function findWorkingProxy(): Promise<ProxyProvider> {
  const spinner = ora('Finding working proxy server...').start();
  const checker = new ProxyChecker();

  for (const proxy of BUILTIN_PROXIES) {
    spinner.text = `Testing ${proxy.name} (${proxy.country})...`;
    const isWorking = await checker.check(proxy, 3000);

    if (isWorking) {
      spinner.succeed(`Connected to ${proxy.name} (${proxy.country})`);
      return proxy;
    }
  }

  spinner.fail('No working proxy found');
  throw new Error('Could not find a working proxy server. Please try again later.');
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

    proxyServer = new ProxyServer(options.port || LOCAL_PROXY_PORT, currentProxy);
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
    console.log('');

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
    if (systemProxy) {
      await systemProxy.disable();
    }

    if (proxyServer) {
      await proxyServer.stop();
    }

    await PACGenerator.remove();

    spinner.succeed('Veto stopped');
    Banner.showBox('Stopped', 'Proxy has been disabled and cleaned up.', 'info');
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
  .version('1.0.0');

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
