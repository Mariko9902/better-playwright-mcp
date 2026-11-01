import { EventEmitter } from 'events';
import { callOnPageNoTrace, waitForCompletion } from './tools/utils.js';
import { parseRoleNameOption } from './tools/role_name.js';
import { logUnhandledError } from './utils/log.js';
import { ManualPromise } from './mcp/manualPromise.js';

export const TabEvents = {
  modalState: 'modalState',
};

export class Tab extends EventEmitter {
  context: any;
  page: any;
  _lastTitle = 'about:blank';
  _readyPromise: Promise<void> = Promise.resolve();
  _consoleMessages: any[] = [];
  _recentConsoleMessages: any[] = [];
  _requests = new Map<any, any>();
  _onPageClose: (tab: Tab) => void;
  _modalStates: any[] = [];
  _downloads: any[] = [];
  _maxConsoleMessages = 500;
  _maxRecentConsoleMessages = 100;
  _maxRequests = 1000;

  constructor(context: any, page: any, onPageClose: (tab: Tab) => void) {
    super();
    this.context = context;
    this.page = page;
    this._onPageClose = onPageClose;
    page.on('console', (event: any) => this._handleConsoleMessage(messageToConsoleMessage(event)));
    page.on('pageerror', (error: any) => this._handleConsoleMessage(pageErrorToConsoleMessage(error)));
    page.on('request', (request: any) => this._trackRequest(request, null));
    page.on('response', (response: any) => this._trackRequest(response.request(), response));
    page.on('close', () => this._onClose());
    page.on('filechooser', (chooser: any) => {
      this.setModalState({
        type: 'fileChooser',
        description: 'File chooser',
        fileChooser: chooser,
      });
    });
    page.on('dialog', (dialog: any) => this._dialogShown(dialog));
    page.on('download', (download: any) => {
      void this._downloadStarted(download);
    });
    const navTimeout = Number.parseInt(String(process.env.BETTER_PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT_MS ?? ''), 10);
    const actionTimeout = Number.parseInt(String(process.env.BETTER_PLAYWRIGHT_DEFAULT_ACTION_TIMEOUT_MS ?? ''), 10);
    page.setDefaultNavigationTimeout(Number.isFinite(navTimeout) && navTimeout > 0 ? navTimeout : 18000);
    page.setDefaultTimeout(Number.isFinite(actionTimeout) && actionTimeout > 0 ? actionTimeout : 18000);
    page[tabSymbol] = this;
  }

  setReadyPromise(promise: Promise<void>) {
    this._readyPromise = promise.catch(logUnhandledError);
  }

  async waitUntilReady() {
    await this._readyPromise;
  }

  static forPage(page: any) {
    return page[tabSymbol];
  }

  modalStates() {
    return this._modalStates;
  }

  setModalState(modalState: any) {
    this._modalStates.push(modalState);
    this.emit(TabEvents.modalState, modalState);
  }

  clearModalState(modalState: any) {
    this._modalStates = this._modalStates.filter(state => state !== modalState);
  }

  modalStatesMarkdown() {
    return renderModalStates(this.context, this.modalStates());
  }

  _dialogShown(dialog: any) {
    this.setModalState({
      type: 'dialog',
      description: `"${dialog.type()}" dialog with message "${dialog.message()}"`,
      dialog,
    });
  }

  async _downloadStarted(download: any) {
    const entry = {
      download,
      finished: false,
      outputFile: await this.context.outputFile(download.suggestedFilename()),
    };
    this._downloads.push(entry);
    await download.saveAs(entry.outputFile);
    entry.finished = true;
  }

  _clearCollectedArtifacts() {
    this._consoleMessages.length = 0;
    this._recentConsoleMessages.length = 0;
    this._requests.clear();
  }

  _handleConsoleMessage(message: any) {
    this._consoleMessages.push(message);
    this._recentConsoleMessages.push(message);
    if (this._consoleMessages.length > this._maxConsoleMessages)
      this._consoleMessages.splice(0, this._consoleMessages.length - this._maxConsoleMessages);
    if (this._recentConsoleMessages.length > this._maxRecentConsoleMessages)
      this._recentConsoleMessages.splice(0, this._recentConsoleMessages.length - this._maxRecentConsoleMessages);
  }

  _trackRequest(request: any, response: any) {
    this._requests.set(request, response);
    if (this._requests.size <= this._maxRequests)
      return;
    const overflow = this._requests.size - this._maxRequests;
    if (overflow <= 0)
      return;
    let i = 0;
    for (const key of this._requests.keys()) {
      this._requests.delete(key);
      i++;
      if (i >= overflow)
        break;
    }
  }

  debugConsoleTail(limit = 20) {
    return this._consoleMessages.slice(-limit);
  }

  debugNetworkTail(limit = 50, includeStatic = false) {
    const want = Math.max(0, limit);
    if (!want)
      return [];
    const staticExt = (url: string) => url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.webp') || url.endsWith('.gif') || url.endsWith('.svg') || url.endsWith('.css') || url.endsWith('.js') || url.endsWith('.woff') || url.endsWith('.woff2') || url.endsWith('.ttf');

    // Avoid cloning the entire map: scan from the tail of insertion order.
    const keys = Array.from(this._requests.keys());
    const out: any[] = [];
    const maxScan = Math.min(keys.length, want * 50);
    for (let i = keys.length - 1; i >= 0 && out.length < want && (keys.length - 1 - i) < maxScan; i--) {
      const req = keys[i];
      if (!includeStatic) {
        const url = req.url();
        if (staticExt(url))
          continue;
      }
      out.push([req, this._requests.get(req)]);
    }
    out.reverse();
    return out;
  }

  _onClose() {
    this._clearCollectedArtifacts();
    this._onPageClose(this);
  }

  async updateTitle() {
    await this._raceAgainstModalStates(async () => {
      this._lastTitle = await callOnPageNoTrace(this.page, (page: any) => page.title());
    });
  }

  lastTitle() {
    return this._lastTitle;
  }

  isCurrentTab() {
    return this === this.context.currentTab();
  }

  async waitForLoadState(state: any, options: any) {
    await callOnPageNoTrace(this.page, (page: any) => page.waitForLoadState(state, options).catch(logUnhandledError));
  }

  async navigate(url: string) {
    await this.waitUntilReady();
    this._clearCollectedArtifacts();
    const downloadEvent = callOnPageNoTrace(this.page, (page: any) => page.waitForEvent('download').catch(logUnhandledError));
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (_e: any) {
      const e = _e;
      const mightBeDownload = e.message.includes('net::ERR_ABORTED') || e.message.includes('Download is starting');
      if (!mightBeDownload)
        throw e;
      const download = await Promise.race([
        downloadEvent,
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
      if (!download)
        throw e;
      await new Promise(resolve => setTimeout(resolve, 500));
      return;
    }
    await this.waitForLoadState('load', { timeout: 5000 });
  }

  consoleMessages() {
    return this._consoleMessages;
  }

  requests() {
    return this._requests;
  }

  async captureSnapshot() {
    let tabSnapshot;
    const modalStates = await this._raceAgainstModalStates(async () => {
      await this.page.evaluate(async () => {
        const runtime = (window as any).__playwrightEnhanced;
        if (typeof runtime?.syncSemantics === 'function') {
          runtime.syncSemantics();
          await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }).catch(() => {});
      const rawSnapshot = await snapshotForAI(this.page);
      const snapshotText = typeof rawSnapshot === 'string' ? rawSnapshot : JSON.stringify(rawSnapshot, null, 2);
      const snapshot = normalizeAriaSnapshot(snapshotText);
      tabSnapshot = {
        url: this.page.url(),
        title: await this.page.title(),
        ariaSnapshot: snapshot,
        modalStates: [],
        consoleMessages: [],
        downloads: this._downloads,
      };
    });
    if (tabSnapshot) {
      (tabSnapshot as any).consoleMessages = this._recentConsoleMessages;
      this._recentConsoleMessages = [];
    }
    return tabSnapshot ?? {
      url: this.page.url(),
      title: '',
      ariaSnapshot: '',
      modalStates,
      consoleMessages: [],
      downloads: [],
    };
  }

  _javaScriptBlocked() {
    return this._modalStates.some(state => state.type === 'dialog');
  }

  async _raceAgainstModalStates(action: () => Promise<any>) {
    if (this.modalStates().length)
      return this.modalStates();
    const promise = new ManualPromise<any>();
    const listener = (modalState: any) => promise.resolve([modalState]);
    this.once(TabEvents.modalState, listener);
    return await Promise.race([
      action().then(result => {
        this.off(TabEvents.modalState, listener);
        return result;
      }),
      promise,
    ]);
  }

  async waitForCompletion(callback: () => Promise<any>) {
    return await this._raceAgainstModalStates(() => waitForCompletion(this, callback));
  }

  async refLocator(params: any) {
    return (await this.refLocators([params]))[0];
  }

  async refLocators(params: any[]) {
    const applyScopeHints = async (param: any) => {
      let scope: any = this.page;

      if (param?.withinTestId) {
        try {
          scope = scope.getByTestId(String(param.withinTestId));
        } catch {
        }
      }
      if (param?.containerSelector) {
        try {
          scope = scope.locator(String(param.containerSelector));
        } catch {
        }
      }
      if (param?.nearText) {
        try {
          const anchor = scope.getByText(String(param.nearText), { exact: false }).first();
          const container = anchor.locator('xpath=ancestor-or-self::*[self::uni-view or self::div or self::li or self::tr][1]');
          if (await container.count())
            scope = container;
        } catch {
        }
      }
      return scope;
    };

    const formatLocatorHints = (param: any) => {
      const hints = {
        element: param?.element,
        withinTestId: param?.withinTestId,
        containerSelector: param?.containerSelector,
        nearText: param?.nearText,
        preferRole: param?.preferRole,
        controlType: param?.controlType,
        role: param?.role,
        name: param?.name,
        testId: param?.testId,
        selector: param?.selector,
        ref: param?.ref,
      };
      return JSON.stringify(Object.fromEntries(Object.entries(hints).filter(([, value]) => value !== undefined)));
    };

    const countLocator = async (locator: any) => {
      try {
        return await locator.count();
      } catch {
        return 0;
      }
    };

    const interactiveSelector = 'button, [role="button"], a, [role="link"], input, textarea, select, [role="textbox"], [role="spinbutton"], [role="combobox"], [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
    const editableSelector = 'input, textarea, select, [role="textbox"], [role="spinbutton"], [role="combobox"], [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';

    const inferRefSelector = (param: any) => {
      const controlType = String(param?.controlType ?? '').toLowerCase();
      const preferRole = String(param?.preferRole ?? '').toLowerCase();
      const role = String(param?.role ?? '').toLowerCase();
      const element = String(param?.element ?? '');
      if (role === 'textbox' || role === 'spinbutton' || role === 'combobox')
        return editableSelector;
      if (controlType === 'input' || controlType === 'select' || controlType === 'slider')
        return editableSelector;
      if (controlType === 'button' || controlType === 'link' || controlType === 'checkbox' || controlType === 'radio' || controlType === 'menu')
        return interactiveSelector;
      if (preferRole === 'textbox' || preferRole === 'spinbutton' || preferRole === 'combobox')
        return editableSelector;
      if (/\u8f93\u5165|\u586b\u5199|\u7f16\u8f91|\u8d26\u53f7|\u5bc6\u7801|\u624b\u673a\u53f7|\u7535\u8bdd|\u5730\u5740|\u8054\u7cfb\u4eba|\u540d\u79f0|\u90ae\u7bb1|\u5907\u6ce8|\u8bf4\u660e|\u6807\u9898|\u5185\u5bb9/.test(element))
        return editableSelector;
      if (/\u6309\u94ae|\u70b9\u51fb|\u4fdd\u5b58|\u63d0\u4ea4|\u786e\u8ba4|\u53d6\u6d88|\u8fd4\u56de|\u94fe\u63a5/.test(element))
        return interactiveSelector;
      return '';
    };

    const strictLocatorError = (kind: string, param: any, details: string) => {
      const recoveryHint = kind === 'ref'
        ? ' The page may have re-rendered or opened an overlay; capture a fresh browser_snapshot before reusing the new ref.'
        : '';
      throw new Error(`${details}. locator_kind=${kind}. hints=${formatLocatorHints(param)}.${recoveryHint} Remove explicit locator fields if you want heuristic fallback.`);
    };

    const smartTextCandidates = (raw: string | undefined): string[] => {
      const element = (raw ?? '').trim();
      if (!element) return [];
      const stripped = element
        .replace(/[\\/()（）\[\]{}:：,，.。?？!！*·#“”"'`]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const cands = new Set<string>();
      cands.add(element);
      if (stripped) cands.add(stripped);
      for (const part of element.split(/[\s\-_/·:：()（）【】\[\]]+/g)) {
        const p = part.trim();
        if (p.length >= 2) cands.add(p);
      }
      return Array.from(cands);
    };

    const smartLocatorFromElement = async (param: any) => {
      const element = String(param?.element ?? '').trim();
      const candidates = smartTextCandidates(element);
      const prefersButton = /\u6309\u94ae|\u63d0\u4ea4|\u786e\u5b9a|\u53d6\u6d88|\u4fdd\u5b58|\u4e0b\u4e00\u6b65|\u8fd4\u56de/.test(element);
      const prefersSelect = /\u9009\u62e9|\u4e0b\u62c9|\u7c7b\u578b|\u7ecf\u8425/.test(element);
      const prefersInput = /\u8f93\u5165|\u624b\u673a\u53f7|\u7535\u8bdd|\u5730\u5740|\u8054\u7cfb\u4eba|\u540d\u79f0|\u90ae\u7bb1|\u5907\u6ce8|\u8bf4\u660e|\u6807\u9898|\u5185\u5bb9/.test(element);

      const scope = await applyScopeHints(param);

      const firstUsable = async (loc: any) => {
        try {
          const cnt = await loc.count();
          const max = Math.min(cnt, 6);
          for (let i = 0; i < max; i++) {
            const v = loc.nth(i);
            try {
              if (await v.isVisible()) {
                try {
                  if (await v.isEnabled())
                    return v;
                } catch {
                  // Some nodes do not support isEnabled; treat visible as usable.
                  return v;
                }
              }
            } catch {
            }
          }
        } catch {
        }
        return loc.first();
      };

      const toActionable = async (hit: any) => {
        // Prefer clicking an actionable ancestor first (button/link/input/select etc).
        const ancestor = hit
          .locator('xpath=ancestor-or-self::*[self::button or @role="button" or self::a or @role="link" or self::input or self::textarea or self::select][1]')
          .first();
        if (await ancestor.count())
          return await firstUsable(ancestor);
        const descendant = hit
          .locator('button, [role="button"], a, [role="link"], input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')
          .first();
        if (await descendant.count())
          return await firstUsable(descendant);
        return await firstUsable(hit);
      };

      const labelScopedField = async (label: string) => {
        const labelHit = scope.getByText(label, { exact: false });
        if (!(await labelHit.count())) return null;
        const labelNode = await firstUsable(labelHit);
        const container = labelNode.locator(
          'xpath=ancestor-or-self::*[self::uni-view or self::div or self::li or self::tr][1]'
        );
        const preferred = element.includes('\u624b\u673a\u53f7') || element.includes('\u7535\u8bdd')
          ? 'input[type="tel"], input[type="number"], input, textarea'
          : 'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
        const control = container.locator(preferred).first();
        if (await control.count())
          return await firstUsable(control);
        // Some component libraries render inputs as role=textbox/spinbutton.
        const role = element.includes('\u624b\u673a\u53f7') || element.includes('\u7535\u8bdd') ? 'spinbutton' : 'textbox';
        const byRole = container.getByRole(role as any);
        if (await byRole.count())
          return await firstUsable(byRole);
        return null;
      };

      const labelScopedPick = async (label: string) => {
        const labelHit = scope.getByText(label, { exact: false });
        if (!(await labelHit.count())) return null;
        const labelNode = await firstUsable(labelHit);
        // Heuristic: pick the closest container that likely represents a form row.
        // This keeps the search local and avoids matching unrelated placeholders elsewhere.
        const container = labelNode.locator(
          'xpath=ancestor-or-self::*[self::uni-view or self::div or self::li or self::tr][1]'
        );

        const actionable = container
          .locator('button, [role="button"], a, [role="link"], input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')
          .first();
        if (await actionable.count())
          return actionable;

        // Some pickers are clickable on placeholder text.
        const placeholder = container.getByText('\u8bf7\u9009\u62e9', { exact: false });
        if (await placeholder.count())
          return await toActionable(placeholder);

        // Already selected fields may not contain the placeholder; clicking the row container can be enough
        // to open the picker. Returning container avoids falling back to the label text <span>.
        if (await container.count())
          return await toActionable(container);
        return null;
      };

      if (prefersButton) {
        for (const t of candidates) {
          const byRole = scope.getByRole('button' as any, { name: t });
          if (await byRole.count()) return byRole.first().describe(param.element);
        }
      }

      if (param?.preferRole) {
        const role = String(param.preferRole);
        for (const t of candidates) {
          const byRole = scope.getByRole(role as any, { name: t });
          if (await byRole.count())
            return (await firstUsable(byRole)).describe(param.element);
        }
        const anyByRole = scope.getByRole(role as any);
        if (await anyByRole.count())
          return (await firstUsable(anyByRole)).describe(param.element);
      }

      if (param?.controlType) {
        const ct = String(param.controlType);
        const map: Record<string, string> = {
          button: 'button, [role="button"]',
          link: 'a, [role="link"]',
          input: 'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
          select: 'select, [role="combobox"], [role="listbox"], [aria-haspopup="listbox"], [aria-haspopup="dialog"]',
          checkbox: 'input[type="checkbox"], [role="checkbox"]',
          radio: 'input[type="radio"], [role="radio"]',
          slider: 'input[type="range"], [role="slider"]',
          menu: '[role="menu"], [role="menuitem"]',
          table: 'table, [role="table"], [role="grid"]',
          dialog: '[role="dialog"], dialog',
        };
        const sel = map[ct];
        if (sel) {
          const loc = scope.locator(sel);
          if (await loc.count())
            return (await firstUsable(loc)).describe(param.element);
        }
      }

      // For select and picker fields, prefer common placeholder text.
      if (prefersSelect) {
        // 1) Prefer label-scoped search to keep results local.
        for (const t of candidates) {
          const scoped = await labelScopedPick(t);
          if (scoped)
            return scoped.describe(param.element);
        }

        // 2) Try direct text hit for candidates (visible-first).
        for (const t of candidates) {
          const exact = scope.getByText(t, { exact: true });
          if (await exact.count())
            return (await toActionable(exact)).describe(param.element);
        }

        // 3) As a last resort, try a placeholder combined with each candidate.
        const pickers = candidates.map(t => `\u8bf7\u9009\u62e9${t}`).filter(Boolean);
        for (const t of pickers) {
          const fuzzy = scope.getByText(t, { exact: false });
          if (!(await fuzzy.count())) continue;
          const hit = await toActionable(fuzzy);
          return hit.describe(param.element);
        }
      }

      // Input-like fields: prefer label-scoped control discovery.
      if (prefersInput) {
        for (const t of candidates) {
          const scoped = await labelScopedField(t);
          if (scoped)
            return scoped.describe(param.element);
        }
      }

      for (const t of candidates) {
        const exact = scope.getByText(t, { exact: true });
        if (await exact.count()) return (await toActionable(exact)).describe(param.element);
      }
      for (const t of candidates) {
        const fuzzy = scope.getByText(t, { exact: false });
        if (await fuzzy.count()) return (await toActionable(fuzzy)).describe(param.element);
      }

      const genericActionable = scope
        .locator('button, [role="button"], a, [role="link"], input, textarea, select')
        .first();
      if (await genericActionable.count())
        return genericActionable.describe(param.element);

      throw new Error(`Unable to locate element by description: ${param.element}. hints=${formatLocatorHints(param)}`);
    };

    return await Promise.all(params.map(async (param) => {
      const scope = await applyScopeHints(param);

      if (!param?.testId && !param?.selector && !param?.role && !param?.ref)
        return await smartLocatorFromElement(param);

      if (param?.testId) {
        const base = scope.getByTestId(param.testId);
        let loc = base;
        if (param.role)
          loc = loc.getByRole(param.role as any, param.name !== undefined ? { name: parseRoleNameOption(param.name) } : undefined);
        const strictCount = await countLocator(loc);
        if (strictCount) {
          if (param.role && !param.name && strictCount > 1)
            strictLocatorError('testId+role', param, `Ambiguous strict locator matched ${strictCount} elements`);
          // When testId points to a container, narrow down to a likely actionable descendant.
          if (!param.role) {
            const actionable = loc
              .locator(
                'button, [role="button"], a, [role="link"], input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'
              )
              .first();
            if (await countLocator(actionable))
              return actionable.describe(param.element);
          }
          return loc.first().describe(param.element);
        }
        const actionable = base
          .locator(
            'button, [role="button"], a, [role="link"], input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'
          )
          .first();
        if (!param.role && await countLocator(actionable))
          return actionable.describe(param.element);
        strictLocatorError('testId', param, `Strict locator did not match any element for testId=${String(param.testId)}`);
      }

      if (param?.selector) {
        const loc = scope.locator(String(param.selector));
        if (await countLocator(loc))
          return loc.first().describe(param.element);
        strictLocatorError('selector', param, `Strict locator did not match any element for selector=${String(param.selector)}`);
      }

      if (param?.role) {
        const role = String(param.role);
        const name = param?.name !== undefined ? parseRoleNameOption(param.name) : undefined;
        const loc = scope.getByRole(role as any, name !== undefined ? { name } : undefined);
        const strictCount = await countLocator(loc);
        if (!strictCount)
          strictLocatorError('role', param, `Strict locator did not match any element for role=${role}${name ? ` name=${name}` : ''}`);
        if (!name && strictCount > 1)
          strictLocatorError('role', param, `Ambiguous strict locator matched ${strictCount} elements for role=${role}`);
        if (name instanceof RegExp && strictCount > 1)
          strictLocatorError('role', param, `Ambiguous strict locator matched ${strictCount} elements for role=${role} name=${String(name)}`);
        if (strictCount)
          return loc.first().describe(param.element);
      }

      if (!param?.ref)
        throw new Error('Missing locator: provide one of ref/testId/selector/role');
      const ref = String(param.ref).trim();
      const locator = scope.locator(`aria-ref=${ref}`);
      if (!await countLocator(locator))
        strictLocatorError('ref', param, `Ref ${ref} was not found on the current page`);
      const narrowedSelector = inferRefSelector(param);
      if (narrowedSelector) {
        const narrowed = locator.locator(narrowedSelector).first();
        if (await countLocator(narrowed))
          return narrowed.describe(param.element);
      }
      return locator.first().describe(param.element);
    }));
  }

  async waitForTimeout(time: number) {
    if (this._javaScriptBlocked()) {
      await new Promise(f => setTimeout(f, time));
      return;
    }
    await callOnPageNoTrace(this.page, (page: any) => {
      return page.evaluate((ms: number) => new Promise(f => setTimeout(f, ms)), time);
    });
  }
}

function messageToConsoleMessage(message: any) {
  return {
    type: message.type(),
    text: message.text(),
    toString: () => `[${message.type().toUpperCase()}] ${message.text()} @ ${message.location().url}:${message.location().lineNumber}`,
  };
}

function pageErrorToConsoleMessage(errorOrValue: any) {
  if (errorOrValue instanceof Error) {
    return {
      type: undefined,
      text: errorOrValue.message,
      toString: () => errorOrValue.stack || errorOrValue.message,
    };
  }
  return {
    type: undefined,
    text: String(errorOrValue),
    toString: () => String(errorOrValue),
  };
}

export function renderModalStates(context: any, modalStates: any[]) {
  const result = ['### Modal state'];
  if (modalStates.length === 0)
    result.push('- There is no modal state present');
  for (const state of modalStates) {
    const tool = context.tools.filter((tool: any) => 'clearsModalState' in tool).find((tool: any) => tool.clearsModalState === state.type);
    result.push(`- [${state.description}]: can be handled by the "${tool?.schema.name}" tool`);
  }
  return result;
}

function normalizeAriaSnapshot(snapshot: string) {
  const parsed = tryParseSnapshotJson(snapshot);
  if (parsed && typeof parsed.full === 'string') {
    parsed.full = normalizeAriaSnapshotLines(parsed.full);
    return JSON.stringify(parsed, null, 2);
  }
  return normalizeAriaSnapshotLines(snapshot);
}

function normalizeAriaSnapshotLines(snapshot: string) {
  const lines = snapshot.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(/^(\s*)- generic \[ref=([^\]]+)\]:\s*$/);
    if (!match)
      continue;

    const [, indent, ref] = match;
    const blockLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const candidate = lines[cursor];
      const candidateIndent = candidate.match(/^(\s*)/)?.[1] ?? '';
      if (candidate.trim() && candidateIndent.length <= indent.length)
        break;
      blockLines.push(candidate);
    }

    const bubbledRole = findBubbledControlRole(blockLines, indent.length);
    if (!bubbledRole)
      continue;

    const blockText = sanitizeSnapshotText(blockLines.map(extractSnapshotText).join(' '));
    if (!blockText)
      continue;

    lines[index] = `${indent}- ${bubbledRole} ${JSON.stringify(blockText)} [ref=${ref}]:`;
  }
  return lines.join('\n');
}

function findBubbledControlRole(blockLines: string[], parentIndentLength: number) {
  for (const line of blockLines) {
    const indentLength = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indentLength <= parentIndentLength)
      continue;
    const roleMatch = line.match(/- (checkbox|radio|switch)\b/);
    if (roleMatch)
      return roleMatch[1];
  }
  return undefined;
}

function tryParseSnapshotJson(snapshot: string) {
  try {
    return JSON.parse(snapshot);
  } catch {
    return undefined;
  }
}

function extractSnapshotText(line: string) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1)
    return '';
  return line.slice(colonIndex + 1).replace(/^\s+/, '').replace(/^"|"$/g, '');
}

function sanitizeSnapshotText(text: string) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{Letter}\p{Number}\u4e00-\u9fff《（[(]+/u, '')
    .trim();
}

async function snapshotForAI(page: any) {
  try {
    if (typeof page?._snapshotForAI === 'function')
      return await page._snapshotForAI();
  } catch {
  }

  try {
    if (typeof page?.ariaSnapshot === 'function') {
      try {
        return await page.ariaSnapshot({ mode: 'ai' });
      } catch {
        return await page.ariaSnapshot();
      }
    }
  } catch {
  }

  try {
    const body = page?.locator?.('body');
    if (body && typeof body.ariaSnapshot === 'function') {
      try {
        return await body.ariaSnapshot({ mode: 'ai' });
      } catch {
        return await body.ariaSnapshot();
      }
    }
  } catch {
  }

  try {
    const snapshot = await page?.accessibility?.snapshot?.({ interestingOnly: false });
    return JSON.stringify(snapshot ?? null, null, 2);
  } catch {
  }
  return '';
}

const tabSymbol = Symbol('Tab');
