import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export interface DiscordLaunchOptions {
  proxyHost: string;
  proxyPort: number;
  killExisting?: boolean;
}

export class DiscordLauncher {
  private static readonly DISCORD_PATHS = [
    // Standard Discord
    path.join(process.env.LOCALAPPDATA || '', 'Discord'),
    // Discord PTB
    path.join(process.env.LOCALAPPDATA || '', 'DiscordPTB'),
    // Discord Canary
    path.join(process.env.LOCALAPPDATA || '', 'DiscordCanary'),
  ];

  /**
   * Find Discord executable path
   */
  static async findDiscordPath(): Promise<string | null> {
    for (const basePath of this.DISCORD_PATHS) {
      try {
        const entries = await fs.readdir(basePath);

        // Find latest app-* version folder
        const appFolders = entries
          .filter(e => e.startsWith('app-'))
          .sort()
          .reverse();

        if (appFolders.length > 0) {
          const exePath = path.join(basePath, appFolders[0], 'Discord.exe');
          try {
            await fs.access(exePath);
            return exePath;
          } catch {
            // Try alternative names
            const altNames = ['DiscordPTB.exe', 'DiscordCanary.exe'];
            for (const name of altNames) {
              const altPath = path.join(basePath, appFolders[0], name);
              try {
                await fs.access(altPath);
                return altPath;
              } catch {
                continue;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Check if Discord is already running
   */
  static async isDiscordRunning(): Promise<boolean> {
    if (process.platform !== 'win32') return false;

    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Discord.exe" /NH');
      return stdout.toLowerCase().includes('discord.exe');
    } catch {
      return false;
    }
  }

  /**
   * Kill all Discord processes
   */
  static async killDiscord(): Promise<void> {
    if (process.platform !== 'win32') return;

    const processNames = ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe'];

    for (const procName of processNames) {
      try {
        await execAsync(`taskkill /F /IM ${procName} 2>nul`);
      } catch {
        // Ignore errors (process might not exist)
      }
    }

    // Wait for processes to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  /**
   * Launch Discord with proxy settings
   */
  static async launch(options: DiscordLaunchOptions): Promise<boolean> {
    const discordPath = await this.findDiscordPath();

    if (!discordPath) {
      console.error('Discord not found. Please install Discord or launch it manually with:');
      console.error(`  discord.exe --proxy-server="http://${options.proxyHost}:${options.proxyPort}"`);
      return false;
    }

    // Always kill existing Discord to restart with proxy
    // This ensures Discord runs with correct proxy settings
    await this.killDiscord();

    // Wait a bit more to ensure Discord is fully closed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Launch Discord with proxy flag
    const proxyArg = `--proxy-server=http://${options.proxyHost}:${options.proxyPort}`;

    try {
      // Use spawn with detached option so Discord runs independently
      const child = spawn(discordPath, [proxyArg], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });

      // Unref to allow Node.js to exit independently
      child.unref();

      return true;
    } catch (err) {
      console.error('Failed to launch Discord:', err);
      return false;
    }
  }

  /**
   * Get Discord installation info
   */
  static async getInfo(): Promise<{ installed: boolean; path: string | null; running: boolean }> {
    const discordPath = await this.findDiscordPath();
    const isRunning = await this.isDiscordRunning();

    return {
      installed: discordPath !== null,
      path: discordPath,
      running: isRunning
    };
  }
}
