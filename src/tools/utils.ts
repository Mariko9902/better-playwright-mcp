import { iso } from 'playwright-core/lib/coreBundle';

const { asLocator } = iso;

export async function waitForCompletion(tab: any, callback: () => Promise<any>) {
  const requests = new Set<any>();
  const ignoredResourceTypes = new Set(['eventsource', 'websocket']);
  const configuredSettleTimeout = Number(process.env.BETTER_PLAYWRIGHT_ACTION_SETTLE_TIMEOUT_MS);
  const settleTimeoutMs = Number.isFinite(configuredSettleTimeout) && configuredSettleTimeout > 0 ? configuredSettleTimeout : 5000;
  let frameNavigated = false;
  let sawActivity = false;
  let waitCallback = () => {};
  const waitBarrier = new Promise<void>(f => { waitCallback = f; });
  const requestListener = (request: any) => {
    const resourceType = request.resourceType?.();
    if (resourceType && ignoredResourceTypes.has(resourceType))
      return;
    sawActivity = true;
    requests.add(request);
  };
  const settleRequest = (request: any) => {
    requests.delete(request);
    if (!requests.size)
      waitCallback();
  };
  const frameNavigateListener = (frame: any) => {
    if (frame.parentFrame())
      return;
    frameNavigated = true;
    dispose();
    clearTimeout(timeout);
    void tab.waitForLoadState('load').then(waitCallback);
  };
  const onTimeout = () => {
    dispose();
    waitCallback();
  };
  tab.page.on('request', requestListener);
  tab.page.on('requestfinished', settleRequest);
  tab.page.on('requestfailed', settleRequest);
  tab.page.on('framenavigated', frameNavigateListener);
  const timeout = setTimeout(onTimeout, settleTimeoutMs);
  const dispose = () => {
    tab.page.off('request', requestListener);
    tab.page.off('requestfinished', settleRequest);
    tab.page.off('requestfailed', settleRequest);
    tab.page.off('framenavigated', frameNavigateListener);
    clearTimeout(timeout);
  };
  try {
    const result = await callback();
    if (!requests.size && !frameNavigated)
      waitCallback();
    await waitBarrier;
    await tab.waitForTimeout(sawActivity || frameNavigated ? 250 : 100);
    return result;
  } finally {
    dispose();
  }
}

function looksLikeLocatorExpression(value: string) {
  return /^((locator|frameLocator)\(|getBy[A-Z]|filter\(|first\(\)|last\(\)|nth\()/u.test(value);
}

export async function generateLocator(locator: any) {
  try {
    const { resolvedSelector } = await locator._resolveSelector();
    return asLocator('javascript', resolvedSelector);
  } catch {
  }

  try {
    const selector = typeof locator?._selector === 'string' ? locator._selector : undefined;
    if (selector)
      return asLocator('javascript', selector);
  } catch {
  }

  try {
    const raw = String(locator?.toString?.() ?? '').trim();
    if (looksLikeLocatorExpression(raw))
      return raw;
  } catch {
  }

  return undefined;
}

export function addReplayCode(response: any, code: string | undefined, fallbackComment: string) {
  response.addCode(code ?? `// ${fallbackComment}`);
}

export async function callOnPageNoTrace(page: any, callback: (page: any) => Promise<any>) {
  return await page._wrapApiCall(() => callback(page), { internal: true });
}
