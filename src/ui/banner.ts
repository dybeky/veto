import chalk from 'chalk';
import boxen from 'boxen';

export class Banner {
  static async show(): Promise<void> {
    // Use hardcoded beautiful ASCII logo for reliability in packaged exe
    const logo = `
██╗   ██╗███████╗████████╗ ██████╗
██║   ██║██╔════╝╚══██╔══╝██╔═══██╗
██║   ██║█████╗     ██║   ██║   ██║
╚██╗ ██╔╝██╔══╝     ██║   ██║   ██║
 ╚████╔╝ ███████╗   ██║   ╚██████╔╝
  ╚═══╝  ╚══════╝   ╚═╝    ╚═════╝
                                   `;

    const subtitle = 'Discord Proxy Bypass for Russia';
    const version = 'v2.0.0';

    try {
      console.clear();
    } catch (err) {
      // console.clear() may fail in some environments
      console.log('\n'.repeat(50));
    }
    console.log(chalk.red(logo));
    console.log(chalk.gray('  ' + subtitle));
    console.log(chalk.gray('  ' + version));
    console.log('');
  }

  static showBox(title: string, message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    const colors = {
      success: chalk.red,
      error: chalk.red,
      info: chalk.red,
      warning: chalk.yellow
    };

    const borderColors = {
      success: 'red',
      error: 'red',
      info: 'red',
      warning: 'yellow'
    } as const;

    const symbols = {
      success: '✔',
      error: '✖',
      info: 'ℹ',
      warning: '⚠'
    };

    const box = boxen(
      `${symbols[type]} ${colors[type].bold(title)}\n\n${message}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: borderColors[type],
        align: 'left'
      }
    );

    console.log(box);
  }

  static showStatus(label: string, value: string, status: 'active' | 'inactive' | 'error' = 'inactive'): void {
    const statusColors = {
      active: chalk.red('●'),
      inactive: chalk.gray('○'),
      error: chalk.red('●')
    };

    console.log(`  ${statusColors[status]} ${chalk.bold(label)}: ${value}`);
  }

  static showHelp(): void {
    console.log('');
    console.log(chalk.bold('Commands:'));
    console.log('  ' + chalk.cyan('start') + '   - Start the proxy server');
    console.log('  ' + chalk.cyan('stop') + '    - Stop the proxy server');
    console.log('  ' + chalk.cyan('status') + '  - Show proxy status');
    console.log('');
  }
}
