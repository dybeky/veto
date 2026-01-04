import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APP_NAME = 'Veto';

export class AutoStart {
  /**
   * Enable autostart on Windows boot
   */
  static async enable(): Promise<boolean> {
    if (process.platform !== 'win32') {
      console.warn('Autostart is only supported on Windows');
      return false;
    }

    try {
      // Get the path to the current executable
      const exePath = process.execPath;

      // If running via node, use the script path
      const isPackaged = !exePath.includes('node.exe');
      const targetPath = isPackaged ? exePath : path.join(__dirname, '..', '..', 'dist', 'index.js');

      const command = isPackaged
        ? `"${exePath}" start`
        : `"${exePath}" "${targetPath}" start`;

      await execAsync(
        `reg add "${REGISTRY_KEY}" /v "${APP_NAME}" /t REG_SZ /d "${command}" /f`
      );

      return true;
    } catch (err) {
      console.error('Failed to enable autostart:', err);
      return false;
    }
  }

  /**
   * Disable autostart
   */
  static async disable(): Promise<boolean> {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      await execAsync(`reg delete "${REGISTRY_KEY}" /v "${APP_NAME}" /f`);
      return true;
    } catch {
      // Key might not exist, that's okay
      return true;
    }
  }

  /**
   * Check if autostart is enabled
   */
  static async isEnabled(): Promise<boolean> {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      const { stdout } = await execAsync(`reg query "${REGISTRY_KEY}" /v "${APP_NAME}"`);
      return stdout.includes(APP_NAME);
    } catch {
      return false;
    }
  }

  /**
   * Toggle autostart
   */
  static async toggle(): Promise<boolean> {
    const isEnabled = await this.isEnabled();
    if (isEnabled) {
      await this.disable();
      return false;
    } else {
      await this.enable();
      return true;
    }
  }
}
