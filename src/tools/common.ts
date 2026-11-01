import { z } from 'zod';
import { defineTabTool, defineTool } from './tool.js';

function userError(message: string) {
  const error: any = new Error(message);
  error.mcpIsUserError = true;
  error.mcpCode = 'INVALID_BROWSER_STORAGE_CONTEXT';
  return error;
}

function assertStorageOrigin(tab: any, storageKind: 'localStorage' | 'sessionStorage') {
  const currentUrl = tab.page.url();
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    throw userError(
      `Cannot access ${storageKind} on the current page URL (${currentUrl}). Navigate to an http(s) origin first.`,
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null') {
    throw userError(
      `Cannot access ${storageKind} on the current page URL (${currentUrl}). Navigate to an http(s) origin first.`,
    );
  }
}

const setDeviceMode = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_set_device_mode',
    title: 'Set device mode',
    description: 'Set device mode policy (H5/PC). Use H5 for mobile/H5/Uni-app/MiniProgram. Apply default viewport for the session.',
    inputSchema: z.object({
      mode: z.enum(['H5', 'PC']).describe('Device mode to use. H5 is for mobile/H5/Uni-app/MiniProgram.'),
      defaultMobileViewportSize: z.string().optional().describe('Override default mobile viewport size as "width,height"'),
      defaultPcViewportSize: z.string().optional().describe('Override default PC viewport size as "width,height"'),
    }),
    type: 'destructive',
  },
  handle: async (context: any, params: any, response: any) => {
    if (params.defaultMobileViewportSize)
      context.config.browser.devicePolicy.defaultMobileViewportSize = params.defaultMobileViewportSize;
    if (params.defaultPcViewportSize)
      context.config.browser.devicePolicy.defaultPcViewportSize = params.defaultPcViewportSize;

    const hadOpenTabs = Boolean(context.tabs?.().length);
    await context.setDeviceMode(params.mode);
    response.addResult(`Device mode set to ${params.mode}`);
    if (hadOpenTabs)
      response.addResult('Full device emulation settings will apply to newly created browser contexts/pages; existing open pages keep their current browser-level capabilities.');
    response.addCode(`// browser_set_device_mode(${params.mode})`);
    response.setIncludeTabs();
  },
});

const setCookies = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_set_cookies',
    title: 'Set cookies',
    description: 'Add or update one or more browser context cookies before navigating or interacting with the page.',
    inputSchema: z.object({
      cookies: z.array(z.object({
        name: z.string().describe('Cookie name'),
        value: z.string().describe('Cookie value'),
        url: z.string().optional().describe('URL-scoped cookie target. Prefer this when setting cookies for a specific origin.'),
        domain: z.string().optional().describe('Cookie domain when url is not provided'),
        path: z.string().optional().describe('Cookie path, defaults to "/" when domain is used'),
        httpOnly: z.boolean().optional().describe('Whether the cookie is HttpOnly'),
        secure: z.boolean().optional().describe('Whether the cookie is secure'),
        sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('Cookie SameSite policy'),
        expires: z.number().optional().describe('Unix timestamp in seconds, or omit for a session cookie'),
      })).min(1).describe('Cookies to add to the current browser context'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const cookies = params.cookies.map((cookie: any) => {
      if (!cookie.url && !cookie.domain)
        throw new Error(`Cookie "${cookie.name}" must include either url or domain`);
      const normalizedCookie: any = {
        name: cookie.name,
        value: cookie.value,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        expires: cookie.expires,
      };

      if (cookie.url) {
        normalizedCookie.url = cookie.url;
      }
      else {
        normalizedCookie.domain = cookie.domain;
        normalizedCookie.path = cookie.path ?? '/';
      }

      return normalizedCookie;
    });
    response.addCode(`await page.context().addCookies(${JSON.stringify(cookies, null, 2)});`);
    await tab.page.context().addCookies(cookies);
    response.addResult(`set ${cookies.length} cookie(s)`);
  },
});

const localStorageSchema = z.object({
  entries: z.record(z.string()).describe('Key/value pairs to write into localStorage for the current origin.'),
  reload: z.boolean().optional().default(false).describe('Reload the page after writing storage. Useful when the app reads storage only during bootstrap.'),
});

const setLocalStorage = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_set_local_storage',
    title: 'Set localStorage',
    description: 'Set one or more localStorage entries for the current page origin. Navigate to the target origin first.',
    inputSchema: localStorageSchema,
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    assertStorageOrigin(tab, 'localStorage');
    const entries = Object.entries(params.entries ?? {});
    response.addCode(`await page.evaluate((entries) => {
  for (const [key, value] of entries)
    localStorage.setItem(key, value);
}, ${JSON.stringify(entries)});`);
    await tab.waitForCompletion(async () => {
      await tab.page.evaluate((pairs: Array<[string, string]>) => {
        for (const [key, value] of pairs)
          window.localStorage.setItem(key, value);
      }, entries);
      if (params.reload)
        await tab.page.reload({ waitUntil: 'domcontentloaded' });
    });
    response.addResult(`set ${entries.length} localStorage entr${entries.length === 1 ? 'y' : 'ies'}`);
    if (params.reload)
      response.addResult('reloaded page after updating localStorage');
    response.setIncludeSnapshot();
  },
});

const setSessionStorage = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_set_session_storage',
    title: 'Set sessionStorage',
    description: 'Set one or more sessionStorage entries for the current page origin. Navigate to the target origin first.',
    inputSchema: localStorageSchema,
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    assertStorageOrigin(tab, 'sessionStorage');
    const entries = Object.entries(params.entries ?? {});
    response.addCode(`await page.evaluate((entries) => {
  for (const [key, value] of entries)
    sessionStorage.setItem(key, value);
}, ${JSON.stringify(entries)});`);
    await tab.waitForCompletion(async () => {
      await tab.page.evaluate((pairs: Array<[string, string]>) => {
        for (const [key, value] of pairs)
          window.sessionStorage.setItem(key, value);
      }, entries);
      if (params.reload)
        await tab.page.reload({ waitUntil: 'domcontentloaded' });
    });
    response.addResult(`set ${entries.length} sessionStorage entr${entries.length === 1 ? 'y' : 'ies'}`);
    if (params.reload)
      response.addResult('reloaded page after updating sessionStorage');
    response.setIncludeSnapshot();
  },
});

const close = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_close',
    title: 'Close browser',
    description: 'Close the page',
    inputSchema: z.object({}),
    type: 'destructive',
  },
  handle: async (context: any, _params: any, response: any) => {
    await context.closeBrowserContext();
    response.setIncludeTabs();
    response.addCode('await page.close()');
  },
});

const resize = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_resize',
    title: 'Resize browser window',
    description: 'Resize the browser window',
    inputSchema: z.object({
      width: z.number().describe('Width of the browser window'),
      height: z.number().describe('Height of the browser window'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.addCode(`await page.setViewportSize({ width: ${params.width}, height: ${params.height} });`);
    await tab.waitForCompletion(async () => {
      await tab.page.setViewportSize({ width: params.width, height: params.height });
    });
  },
});

const setViewportSize = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_set_viewport_size',
    title: 'Set viewport size',
    description: 'Set the page viewport size',
    inputSchema: z.object({
      width: z.number().describe('Width of the viewport'),
      height: z.number().describe('Height of the viewport'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.addCode(`await page.setViewportSize({ width: ${params.width}, height: ${params.height} });`);
    await tab.waitForCompletion(async () => {
      await tab.page.setViewportSize({ width: params.width, height: params.height });
    });
  },
});

const restart = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_restart',
    title: 'Restart browser',
    description: 'Restart browser context and optionally switch headless mode',
    inputSchema: z.object({
      headless: z.boolean().optional().describe('Whether to run the browser in headless mode'),
    }),
    type: 'destructive',
  },
  handle: async (context: any, params: any, response: any) => {
    if (params.headless !== undefined)
      context.config.browser.launchOptions.headless = params.headless;
    await context.closeBrowserContext();
    await context.ensureTab();
    response.setIncludeTabs();
    response.addCode(`// Restarted browser context (headless=${params.headless})`);
  },
});

export default [setDeviceMode, setCookies, setLocalStorage, setSessionStorage, close, resize, setViewportSize, restart];
