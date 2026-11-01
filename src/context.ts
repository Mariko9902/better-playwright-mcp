import debug from 'debug';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { contextOptionsForDeviceMode } from './config.js';
import { logUnhandledError } from './utils/log.js';
import { Tab } from './tab.js';
import { outputFile } from './config.js';

const testDebug = debug('pw:bp:test');

export class Context {
  tools: any;
  config: any;
  sessionLog: any;
  options: any;
  _deviceMode?: 'H5' | 'PC';
  _browserContextPromise: any;
  _browserContextFactory: any;
  _tabs: any[] = [];
  _currentTab: any;
  _clientInfo: any;
  static _allContexts = new Set<Context>();
  static _initPageModuleCache = new Map<string, Promise<any>>();
  _initPageFailures = new WeakMap<any, any[]>();
  _closeBrowserContextPromise: any;
  _runningToolName: any;
  _abortController = new AbortController();

  constructor(options: any) {
    this.tools = options.tools;
    this.config = options.config;
    this.sessionLog = options.sessionLog;
    this.options = options;
    this._browserContextFactory = options.browserContextFactory;
    this._clientInfo = options.clientInfo;
    const requireDeviceMode = Boolean(this.config?.browser?.devicePolicy?.requireDeviceMode);
    const defaultDeviceMode = this.config?.browser?.devicePolicy?.defaultDeviceMode;
    if (!requireDeviceMode && (defaultDeviceMode === 'H5' || defaultDeviceMode === 'PC')) {
      this._deviceMode = defaultDeviceMode;
      this.config.browser.contextOptions = contextOptionsForDeviceMode(defaultDeviceMode, this.config.browser);
    }
    testDebug('create context');
    Context._allContexts.add(this);
  }

  deviceMode() {
    return this._deviceMode;
  }

  deviceModeRequired() {
    return Boolean(this.config?.browser?.devicePolicy?.requireDeviceMode);
  }

  async setDeviceMode(mode: 'H5' | 'PC') {
    this._deviceMode = mode;
    this.config.browser.contextOptions = contextOptionsForDeviceMode(mode, this.config.browser);

    // Apply to current tab if it already exists.
    const tab = this.currentTab();
    const viewport = this.config?.browser?.contextOptions?.viewport;
    if (tab && viewport && typeof viewport.width === 'number' && typeof viewport.height === 'number') {
      await tab.page.setViewportSize({ width: viewport.width, height: viewport.height }).catch(() => {});
    }
  }

  static async disposeAll() {
    await Promise.all([...Context._allContexts].map(context => context.dispose()));
  }

  tabs() {
    return this._tabs;
  }

  currentTab() {
    return this._currentTab;
  }

  currentTabOrDie() {
    if (!this._currentTab)
      throw new Error('No open pages available. Use the "browser_navigate" tool to navigate to a page first.');
    return this._currentTab;
  }

  async newTab() {
    const { browserContext } = await this._ensureBrowserContext();
    const page = await browserContext.newPage();
    const existing = this._tabs.find(t => t.page === page);
    if (existing) {
      this._currentTab = existing;
      return existing;
    }
    // Ensure page event races do not make newTab return undefined.
    this._onPageCreated(page);
    return this._currentTab;
  }

  async selectTab(index: number) {
    const tab = this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    await tab.page.bringToFront();
    this._currentTab = tab;
    return tab;
  }

  async ensureTab() {
    const { browserContext } = await this._ensureBrowserContext();
    if (!this._currentTab) {
      const page = await browserContext.newPage();
      if (!this._tabs.find(t => t.page === page))
        this._onPageCreated(page);
    }
    return this._currentTab;
  }

  async closeTab(index?: number) {
    const tab = index === undefined ? this._currentTab : this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    const url = tab.page.url();
    await tab.page.close();
    return url;
  }

  async outputFile(name: string) {
    return outputFile(this.config, this._clientInfo.rootPath, name);
  }

  initPageFailures(page: any) {
    return this._initPageFailures.get(page) ?? [];
  }

  _onPageCreated(page: any) {
    const tab = new Tab(this, page, (closedTab: any) => this._onPageClosed(closedTab));
    this._tabs.push(tab);
    if (!this._currentTab)
      this._currentTab = tab;
    tab.setReadyPromise(this._runInitPages(page));
  }

  async _runInitPages(page: any) {
    const failures: any[] = [];
    this._initPageFailures.set(page, failures);
    const initPages = this.config?.browser?.initPage;
    if (!initPages || initPages.length === 0)
      return;
    for (const initPagePath of initPages) {
      if (!initPagePath)
        continue;
      let resolved = initPagePath;
      try {
        resolved = this._resolveInitPageModulePath(initPagePath);
        let importPromise = Context._initPageModuleCache.get(resolved);
        if (!importPromise) {
          importPromise = import(pathToFileURL(resolved).toString());
          Context._initPageModuleCache.set(resolved, importPromise);
        }
        const mod = await importPromise;
        const fn = mod?.default;
        if (typeof fn !== 'function')
          throw new Error(`init-page module does not have a default function export: ${initPagePath}`);
        await fn({ page });
      } catch (e) {
        failures.push({
          path: initPagePath,
          resolvedPath: resolved,
          error: e instanceof Error ? (e.stack || e.message) : String(e),
        });
        testDebug(`init-page failed for ${initPagePath}: ${String(e)}`);
      }
    }
  }

  _resolveInitPageModulePath(initPagePath: string) {
    if (path.isAbsolute(initPagePath))
      return initPagePath;

    // Try relative to the launcher script (works better under mcp-gateway / arbitrary cwd).
    const script = process.argv?.[1];
    if (script) {
      const scriptDir = path.dirname(script);
      const candidates = [
        path.resolve(scriptDir, initPagePath),
        path.resolve(scriptDir, '..', initPagePath),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p))
          return p;
      }
    }

    // Try upward search from cwd (repo-root friendly).
    let dir = process.cwd();
    while (true) {
      const p = path.resolve(dir, initPagePath);
      if (fs.existsSync(p))
        return p;
      const parent = path.dirname(dir);
      if (parent === dir)
        break;
      dir = parent;
    }

    // Fallback to cwd resolution.
    return path.resolve(process.cwd(), initPagePath);
  }

  _onPageClosed(tab: any) {
    const index = this._tabs.indexOf(tab);
    if (index === -1)
      return;
    this._tabs.splice(index, 1);
    if (this._currentTab === tab)
      this._currentTab = this._tabs[Math.min(index, this._tabs.length - 1)];
    if (!this._tabs.length)
      void this.closeBrowserContext();
  }

  async closeBrowserContext() {
    if (!this._closeBrowserContextPromise)
      this._closeBrowserContextPromise = this._closeBrowserContextImpl().catch(logUnhandledError);
    await this._closeBrowserContextPromise;
    this._closeBrowserContextPromise = undefined;
  }

  isRunningTool() {
    return this._runningToolName !== undefined;
  }

  setRunningTool(name: any) {
    this._runningToolName = name;
  }

  async _closeBrowserContextImpl() {
    if (!this._browserContextPromise)
      return;
    testDebug('close context');
    const promise = this._browserContextPromise;
    this._browserContextPromise = undefined;
    await promise.then(async ({ browserContext, close }: any) => {
      if (this.config.saveTrace)
        await browserContext.tracing.stop();
      await close();
    });
  }

  async dispose() {
    this._abortController.abort('Browser context disposed');
    await this.closeBrowserContext();
    Context._allContexts.delete(this);
  }

  async _setupRequestInterception(context: any) {
    if (this.config.network?.allowedOrigins?.length) {
      await context.route('**', (route: any) => route.abort('blockedbyclient'));
      for (const origin of this.config.network.allowedOrigins)
        await context.route(`*://${origin}/**`, (route: any) => route.continue());
    }
    if (this.config.network?.blockedOrigins?.length) {
      for (const origin of this.config.network.blockedOrigins)
        await context.route(`*://${origin}/**`, (route: any) => route.abort('blockedbyclient'));
    }
  }

  _ensureBrowserContext() {
    if (!this._browserContextPromise) {
      this._browserContextPromise = this._setupBrowserContext();
      this._browserContextPromise.catch(() => {
        this._browserContextPromise = undefined;
      });
    }
    return this._browserContextPromise;
  }

  async _setupBrowserContext() {
    if (this._closeBrowserContextPromise)
      throw new Error('Another browser context is being closed.');
    const result = await this._browserContextFactory.createContext(this._clientInfo, this._abortController.signal, this._runningToolName);
    const { browserContext } = result;
    await this._setupRequestInterception(browserContext);
    if (this.sessionLog)
      await InputRecorder.create(this, browserContext);
    for (const page of browserContext.pages())
      this._onPageCreated(page);
    browserContext.on('page', (page: any) => this._onPageCreated(page));
    if (this.config.saveTrace) {
      await browserContext.tracing.start({
        name: 'trace',
        screenshots: false,
        snapshots: true,
        sources: false,
      });
    }
    return result;
  }
}

export class InputRecorder {
  _context: Context;
  _browserContext: any;

  constructor(context: Context, browserContext: any) {
    this._context = context;
    this._browserContext = browserContext;
  }

  static async create(context: Context, browserContext: any) {
    const recorder = new InputRecorder(context, browserContext);
    await recorder._initialize();
    return recorder;
  }

  async _initialize() {
    const sessionLog = this._context.sessionLog;
    await this._browserContext._enableRecorder({
      mode: 'recording',
      recorderMode: 'api',
    }, {
      actionAdded: (page: any, data: any, code: string) => {
        if (this._context.isRunningTool())
          return;
        const tab = Tab.forPage(page);
        if (tab)
          sessionLog.logUserAction(data.action, tab, code, false);
      },
      actionUpdated: (page: any, data: any, code: string) => {
        if (this._context.isRunningTool())
          return;
        const tab = Tab.forPage(page);
        if (tab)
          sessionLog.logUserAction(data.action, tab, code, true);
      },
      signalAdded: (page: any, data: any) => {
        if (this._context.isRunningTool())
          return;
        if (data.signal.name !== 'navigation')
          return;
        const tab = Tab.forPage(page);
        const navigateAction = {
          name: 'navigate',
          url: data.signal.url,
          signals: [],
        };
        if (tab)
          sessionLog.logUserAction(navigateAction, tab, `await page.goto('${data.signal.url}');`, false);
      },
    });
  }
}
