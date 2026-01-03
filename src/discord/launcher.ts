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

interface DiscordInstallation {
  updateExe: string;
  appExe: string;
  name: string;
}

export class DiscordLauncher {
  private static readonly DISCORD_FOLDERS = ['Discord', 'DiscordPTB', 'DiscordCanary'];

  /**
   * Find Discord installation (Update.exe and app exe)
   */
  static async findDiscordInstallation(): Promise<DiscordInstallation | null> {
    const localAppData = process.env.LOCALAPPDATA || '';

    for (const folder of this.DISCORD_FOLDERS) {
      const basePath = path.join(localAppData, folder);

      try {
        // Check for Update.exe (main launcher)
        const updateExe = path.join(basePath, 'Update.exe');
        await fs.access(updateExe);

        // Find app-* folder for the actual exe
        const entries = await fs.readdir(basePath);
        const appFolders = entries
          .filter(e => e.startsWith('app-'))
          .sort()
          .reverse();

        if (appFolders.length > 0) {
          const exeName = folder === 'Discord' ? 'Discord.exe' :
                          folder === 'DiscordPTB' ? 'DiscordPTB.exe' : 'DiscordCanary.exe';
          const appExe = path.join(basePath, appFolders[0], exeName);

          try {
            await fs.access(appExe);
            return { updateExe, appExe, name: folder };
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Find Discord executable path (legacy method)
   */
  static async findDiscordPath(): Promise<string | null> {
    const installation = await this.findDiscordInstallation();
    return installation?.appExe || null;
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
    const installation = await this.findDiscordInstallation();

    if (!installation) {
      console.error('Discord not found. Please install Discord or launch it manually with:');
      console.error(`  discord.exe --proxy-server="http://${options.proxyHost}:${options.proxyPort}"`);
      return false;
    }

    console.log(`Found Discord: ${installation.name}`);
    console.log(`Path: ${installation.appExe}`);

    // Always kill existing Discord to restart with proxy
    console.log('Closing Discord...');
    await this.killDiscord();

    // Wait for Discord to fully close
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Launch Discord with proxy flag using cmd /c start
    const proxyArg = `--proxy-server=http://${options.proxyHost}:${options.proxyPort}`;

    try {
      // Method 1: Use Update.exe with --processStart (recommended way)
      const command = `"${installation.updateExe}" --processStart "${path.basename(installation.appExe)}" --process-start-args="${proxyArg}"`;

      console.log(`Launching Discord with proxy...`);

      exec(command, { windowsHide: true }, (error) => {
        if (error) {
          console.error('Update.exe launch failed, trying direct launch...');
          // Method 2: Direct launch as fallback
          const child = spawn('cmd.exe', ['/c', 'start', '', installation.appExe, proxyArg], {
            detached: true,
            stdio: 'ignore',
            shell: true
          });
          child.unref();
        }
      });

      // Give Discord time to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      return true;
    } catch (err) {
      console.error('Failed to launch Discord:', err);

      // Last resort: try direct spawn
      try {
        const child = spawn(installation.appExe, [proxyArg], {
          detached: true,
          stdio: 'ignore',
          shell: true
        });
        child.unref();
        return true;
      } catch {
        return false;
      }
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
