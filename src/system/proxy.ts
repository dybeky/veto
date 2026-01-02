import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SystemProxy {
  private pacUrl: string;

  constructor(pacFilePath: string) {
    this.pacUrl = `file:///${pacFilePath.replace(/\\/g, '/')}`;
  }

  async enable(): Promise<void> {
    if (process.platform === 'win32') {
      await this.enableWindows();
    } else {
      throw new Error('Only Windows is currently supported');
    }
  }

  async disable(): Promise<void> {
    if (process.platform === 'win32') {
      await this.disableWindows();
    }
  }

  private async enableWindows(): Promise<void> {
    // Enable automatic configuration script
    const commands = [
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoConfigURL /t REG_SZ /d "' + this.pacUrl + '" /f',
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoDetect /t REG_DWORD /d 0 /f'
    ];

    for (const cmd of commands) {
      try {
        await execAsync(cmd);
      } catch (err) {
        console.error('Failed to set proxy:', err);
        throw err;
      }
    }

    // Notify system of proxy change
    await this.notifyProxyChange();
  }

  private async disableWindows(): Promise<void> {
    const commands = [
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoConfigURL /f',
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoDetect /t REG_DWORD /d 1 /f'
    ];

    for (const cmd of commands) {
      try {
        await execAsync(cmd);
      } catch (err) {
        // Ignore errors when disabling
      }
    }

    await this.notifyProxyChange();
  }

  private async notifyProxyChange(): Promise<void> {
    // Refresh Internet Explorer settings to apply changes system-wide
    try {
      const { exec } = require('child_process');
      exec('rundll32.exe user32.dll,UpdatePerUserSystemParameters');
    } catch (err) {
      // Ignore errors
    }
  }

  async getStatus(): Promise<boolean> {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      const { stdout } = await execAsync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoConfigURL'
      );
      return stdout.includes(this.pacUrl);
    } catch (err) {
      return false;
    }
  }
}
