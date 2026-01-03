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
  static async killDiscord(): Promise<boolean> {
    if (process.platform !== 'win32') return true;

    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // PowerShell is most reliable for killing processes
      try {
        await execAsync(
          `powershell -Command "Get-Process | Where-Object { $_.ProcessName -match '^Discord' } | Stop-Process -Force -ErrorAction SilentlyContinue"`,
          { windowsHide: true, timeout: 5000 }
        );
      } catch {
        // Ignore
      }

      // Also try taskkill for good measure
      try {
        await execAsync('taskkill /F /IM "Discord*" 2>nul', { windowsHide: true, timeout: 5000 });
      } catch {
        // Ignore
      }

      // Wait for processes to terminate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if Discord is still running
      if (!(await this.isDiscordRunning())) {
        return true; // Successfully killed
      }
    }

    // Final aggressive attempt with PowerShell
    try {
      await execAsync(
        `powershell -Command "$procs = Get-Process | Where-Object { $_.ProcessName -match '^Discord' }; foreach ($p in $procs) { $p.Kill() }"`,
        { windowsHide: true, timeout: 10000 }
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch {
      // Ignore
    }

    return !(await this.isDiscordRunning());
  }

  /**
   * Launch Discord with proxy settings
   */
  static async launch(options: DiscordLaunchOptions): Promise<boolean> {
    const installation = await this.findDiscordInstallation();

    if (!installation) {
      console.error('\x1b[31m\u2718 Discord not found\x1b[0m');
      console.error('  Please install Discord or launch manually with:');
      console.error(`  discord.exe --proxy-server="http://${options.proxyHost}:${options.proxyPort}"`);
      return false;
    }

    console.log(`\x1b[36m\u25CF\x1b[0m Found: \x1b[1m${installation.name}\x1b[0m`);

    // Always kill existing Discord to restart with proxy
    const wasRunning = await this.isDiscordRunning();
    if (wasRunning) {
      process.stdout.write('\x1b[33m\u25CF\x1b[0m Closing Discord... ');
      const killed = await this.killDiscord();
      if (killed) {
        console.log('\x1b[32m\u2714\x1b[0m');
      } else {
        console.log('\x1b[31m\u2718 Failed to close\x1b[0m');
        return false;
      }
    }

    // Wait for Discord to fully close
    await new Promise(resolve => setTimeout(resolve, 500));

    // Launch Discord with proxy flags
    const proxyServer = `http://${options.proxyHost}:${options.proxyPort}`;
    const proxyArgs = [
      `--proxy-server=${proxyServer}`,
      `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE ${options.proxyHost}"`,
      '--ignore-certificate-errors'
    ];

    process.stdout.write('\x1b[33m\u25CF\x1b[0m Starting Discord with proxy... ');

    try {
      // Method 1: Use Update.exe with --processStart (recommended way)
      const argsString = proxyArgs.join(' ');
      const command = `"${installation.updateExe}" --processStart "${path.basename(installation.appExe)}" --process-start-args="${argsString}"`;

      exec(command, { windowsHide: true }, (error) => {
        if (error) {
          // Method 2: Direct launch as fallback
          const child = spawn('cmd.exe', ['/c', 'start', '', installation.appExe, ...proxyArgs], {
            detached: true,
            stdio: 'ignore',
            shell: true
          });
          child.unref();
        }
      });

      // Give Discord time to start
      await new Promise(resolve => setTimeout(resolve, 1500));

      const running = await this.isDiscordRunning();
      if (running) {
        console.log('\x1b[32m\u2714\x1b[0m');
        console.log(`\x1b[32m\u2714 Discord running with proxy ${options.proxyHost}:${options.proxyPort}\x1b[0m`);
        return true;
      } else {
        console.log('\x1b[31m\u2718\x1b[0m');
        return false;
      }
    } catch (err) {
      console.log('\x1b[31m\u2718\x1b[0m');

      // Last resort: try direct spawn
      try {
        const child = spawn(installation.appExe, proxyArgs, {
          detached: true,
          stdio: 'ignore',
          shell: true
        });
        child.unref();
        console.log(`\x1b[32m\u2714 Discord launched (fallback)\x1b[0m`);
        return true;
      } catch {
        console.error('\x1b[31m\u2718 Failed to launch Discord\x1b[0m');
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
