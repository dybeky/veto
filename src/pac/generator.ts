import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DISCORD_DOMAINS, LOCAL_PROXY_PORT } from '../config/domains';

export class PACGenerator {
  static generate(): string {
    return `function FindProxyForURL(url, host) {
  // Normalize host
  host = host.toLowerCase();

  // Discord domains that should go through proxy
  var discordDomains = [${DISCORD_DOMAINS.map(d => `"${d}"`).join(', ')}];

  // Helper function to check if host ends with suffix
  function endsWith(str, suffix) {
    return str.length >= suffix.length && str.substring(str.length - suffix.length) === suffix;
  }

  // Check if host matches any Discord domain
  for (var i = 0; i < discordDomains.length; i++) {
    var domain = discordDomains[i];

    if (domain.indexOf('*.') === 0) {
      // Wildcard domain - match base domain and all subdomains
      var baseDomain = domain.substring(2);
      if (host === baseDomain || endsWith(host, '.' + baseDomain)) {
        return "PROXY 127.0.0.1:${LOCAL_PROXY_PORT}";
      }
    } else {
      // Exact domain match
      if (host === domain) {
        return "PROXY 127.0.0.1:${LOCAL_PROXY_PORT}";
      }
    }
  }

  // All other traffic goes direct
  return "DIRECT";
}`;
  }

  static getFilePath(): string {
    return path.join(os.tmpdir(), 'veto-proxy.pac');
  }

  static async write(): Promise<string> {
    const filePath = this.getFilePath();
    const content = this.generate();

    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  static async remove(): Promise<void> {
    const filePath = this.getFilePath();

    try {
      await fs.unlink(filePath);
    } catch (err) {
      // Ignore if file doesn't exist
    }
  }
}
