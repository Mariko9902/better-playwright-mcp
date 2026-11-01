import os from 'node:os';
import path from 'node:path';

export function cacheDir() {
  let cacheDirectory: string;
  if (process.platform === 'linux')
    cacheDirectory = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  else if (process.platform === 'darwin')
    cacheDirectory = path.join(os.homedir(), 'Library', 'Caches');
  else if (process.platform === 'win32')
    cacheDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  else
    throw new Error('Unsupported platform: ' + process.platform);
  return path.join(cacheDirectory, 'ms-playwright');
}

export function sanitizeForFilePath(s: string) {
  const sanitize = (value: string) => value.replace(/[\x00-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]+/g, '-');
  const separator = s.lastIndexOf('.');
  if (separator === -1)
    return sanitize(s);
  return sanitize(s.substring(0, separator)) + '.' + sanitize(s.substring(separator + 1));
}
