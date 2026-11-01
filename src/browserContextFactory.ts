import fs from 'fs';
import net from 'net';
import path from 'path';
import * as playwright from 'playwright';
import { registry, server as playwrightServer } from 'playwright-core/lib/coreBundle';
import { logUnhandledError, testDebug } from './utils/log.js';
import { createHash } from './utils/guid.js';
import { outputFile } from './config.js';

const { registryDirectory } = registry;
const { startTraceViewerServer } = playwrightServer;

export function contextFactory(config: any) {
  if (config.browser.remoteEndpoint)
    return new RemoteContextFactory(config);
  if (config.browser.cdpEndpoint)
    return new CdpContextFactory(config);
  if (config.browser.isolated)
    return new IsolatedContextFactory(config);
  return new PersistentContextFactory(config);
}

class BaseContextFactory {
  config: any;
  _logName: string;
  _browserPromise: any;

  constructor(name: string, config: any) {
    this._logName = name;
    this.config = config;
  }

  async _obtainBrowser(clientInfo: any) {
    if (this._browserPromise)
      return this._browserPromise;
    testDebug(`obtain browser (${this._logName})`);
    this._browserPromise = this._doObtainBrowser(clientInfo);
    void this._browserPromise.then((browser: any) => {
      browser.on('disconnected', () => {
        this._browserPromise = undefined;
      });
    }).catch(() => {
      this._browserPromise = undefined;
    });
    return this._browserPromise;
  }

  async _doObtainBrowser(_clientInfo: any): Promise<any> {
    throw new Error('Not implemented');
  }

  async createContext(clientInfo: any) {
    testDebug(`create browser context (${this._logName})`);
    const browser = await this._obtainBrowser(clientInfo);
    const browserContext = await this._doCreateContext(browser);
    return { browserContext, close: () => this._closeBrowserContext(browserContext, browser) };
  }

  async _doCreateContext(_browser: any): Promise<any> {
    throw new Error('Not implemented');
  }

  async _closeBrowserContext(browserContext: any, browser: any) {
    testDebug(`close browser context (${this._logName})`);
    if (browser.contexts().length === 1)
      this._browserPromise = undefined;
    await browserContext.close().catch(logUnhandledError);
    if (browser.contexts().length === 0) {
      testDebug(`close browser (${this._logName})`);
      await browser.close().catch(logUnhandledError);
    }
  }
}

class IsolatedContextFactory extends BaseContextFactory {
  constructor(config: any) {
    super('isolated', config);
  }

  async _doObtainBrowser(clientInfo: any) {
    await injectCdpPort(this.config.browser);
    const browserType = (playwright as any)[this.config.browser.browserName];
    return browserType.launch({
      tracesDir: await startTraceServer(this.config, clientInfo.rootPath),
      ...this.config.browser.launchOptions,
      handleSIGINT: false,
      handleSIGTERM: false,
    }).catch((error: any) => {
      if (error.message.includes('Executable doesn\'t exist'))
        throw new Error('Browser specified in your config is not installed. Either install it (likely) or change the config.');
      throw error;
    });
  }

  async _doCreateContext(browser: any) {
    return browser.newContext(this.config.browser.contextOptions);
  }
}

class CdpContextFactory extends BaseContextFactory {
  constructor(config: any) {
    super('cdp', config);
  }

  async _doObtainBrowser() {
    return playwright.chromium.connectOverCDP(this.config.browser.cdpEndpoint);
  }

  async _doCreateContext(browser: any) {
    return this.config.browser.isolated ? await browser.newContext() : browser.contexts()[0];
  }
}

class RemoteContextFactory extends BaseContextFactory {
  constructor(config: any) {
    super('remote', config);
  }

  async _doObtainBrowser() {
    const url = new URL(this.config.browser.remoteEndpoint);
    url.searchParams.set('browser', this.config.browser.browserName);
    if (this.config.browser.launchOptions)
      url.searchParams.set('launch-options', JSON.stringify(this.config.browser.launchOptions));
    return (playwright as any)[this.config.browser.browserName].connect(String(url));
  }

  async _doCreateContext(browser: any) {
    return browser.newContext();
  }
}

class PersistentContextFactory {
  config: any;
  name = 'persistent';
  description = 'Create a new persistent browser context';
  _userDataDirs = new Set<string>();

  constructor(config: any) {
    this.config = config;
  }

  async createContext(clientInfo: any) {
    await injectCdpPort(this.config.browser);
    testDebug('create browser context (persistent)');
    const userDataDir = this.config.browser.userDataDir ?? await this._createUserDataDir(clientInfo.rootPath);
    const tracesDir = await startTraceServer(this.config, clientInfo.rootPath);
    await ensureChromeUserPreferences(this.config.browser?.browserName, userDataDir);
    this._userDataDirs.add(userDataDir);
    testDebug('lock user data dir', userDataDir);
    const browserType = (playwright as any)[this.config.browser.browserName];
    for (let i = 0; i < 5; i++) {
      try {
        const browserContext = await browserType.launchPersistentContext(userDataDir, {
          tracesDir,
          ...this.config.browser.launchOptions,
          ...this.config.browser.contextOptions,
          handleSIGINT: false,
          handleSIGTERM: false,
        });
        const close = () => this._closeBrowserContext(browserContext, userDataDir);
        return { browserContext, close };
      } catch (error: any) {
        if (error.message.includes('Executable doesn\'t exist'))
          throw new Error('Browser specified in your config is not installed. Either install it (likely) or change the config.');
        if (this._shouldRetryLaunch(error)) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Browser is already in use for ${userDataDir}, use --isolated to run multiple instances of the same browser`);
  }

  async _closeBrowserContext(browserContext: any, userDataDir: string) {
    testDebug('close browser context (persistent)');
    testDebug('release user data dir', userDataDir);
    await browserContext.close().catch(logUnhandledError);
    this._userDataDirs.delete(userDataDir);
    testDebug('close browser context complete (persistent)');
  }

  async _createUserDataDir(rootPath?: string) {
    const dir = process.env.PWMCP_PROFILES_DIR_FOR_TEST ?? registryDirectory;
    const browserToken = this.config.browser.launchOptions?.channel ?? this.config.browser?.browserName;
    const rootPathToken = rootPath ? `-${createHash(rootPath)}` : `-pid-${process.pid}`;
    const result = path.join(dir, `better-playwright-${browserToken}${rootPathToken}`);
    await fs.promises.mkdir(result, { recursive: true });
    return result;
  }

  _shouldRetryLaunch(error: any) {
    const message = String(error?.message ?? error ?? '');
    return message.includes('ProcessSingleton')
      || message.includes('Invalid URL')
      || message.includes('Failed to launch the browser process');
  }
}

async function ensureChromeUserPreferences(browserName: string | undefined, userDataDir: string) {
  // Only chromium-based browsers use this preferences file layout.
  if (browserName !== 'chromium')
    return;
  const defaultProfileDir = path.join(userDataDir, 'Default');
  const prefFile = path.join(defaultProfileDir, 'Preferences');
  await fs.promises.mkdir(defaultProfileDir, { recursive: true });
  let prefs: any = {};
  try {
    prefs = JSON.parse(await fs.promises.readFile(prefFile, 'utf8'));
  } catch {
  }
  prefs.credentials_enable_service = false;
  prefs.credentials_enable_autosignin = false;
  prefs.translate = {
    ...(prefs.translate ?? {}),
    enabled: false,
  };
  prefs.profile = {
    ...(prefs.profile ?? {}),
    password_manager_enabled: false,
  };
  await fs.promises.writeFile(prefFile, JSON.stringify(prefs, null, 2), 'utf8');
}

async function injectCdpPort(browserConfig: any) {
  if (browserConfig.browserName === 'chromium') {
    browserConfig.launchOptions.cdpPort = await findFreePort();
    ensureChromiumLaunchArgs(browserConfig.launchOptions);
  }
}

function ensureChromiumLaunchArgs(launchOptions: any) {
  const args: string[] = Array.isArray(launchOptions?.args) ? launchOptions.args : [];
  const want = [
    '--disable-translate',
    '--disable-features=Translate,TranslateUI',
    '--disable-save-password-bubble',
    '--disable-extensions',
  ];
  for (const a of want) {
    if (!args.includes(a))
      args.push(a);
  }
  launchOptions.args = args;
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function startTraceServer(config: any, rootPath?: string) {
  if (!config.saveTrace)
    return undefined;
  const tracesDir = await outputFile(config, rootPath, `traces-${Date.now()}`);
  const server = await startTraceViewerServer();
  const urlPrefix = server.urlPrefix('human-readable');
  const traceUrl = urlPrefix + '/trace/index.html?trace=' + tracesDir + '/trace.json';
  console.error('\nTrace viewer listening on ' + traceUrl);
  return tracesDir;
}
