import { z } from 'zod';
import { defineTabTool } from './tool.js';
import { addReplayCode, generateLocator } from './utils.js';
import { elementSchemaBase } from './snapshot.js';

const clickAndWaitForApi = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_click_and_wait_for_api',
    title: 'Click and wait for API response',
    description: 'Click an element and wait for a matching API response. The listener is attached before the click to avoid race conditions.',
    inputSchema: elementSchemaBase.extend({
      doubleClick: z.boolean().optional().describe('Whether to perform a double click instead of a single click'),
      button: z.enum(['left', 'right', 'middle']).optional().describe('Button to click, defaults to left'),
      urlPattern: z.string().describe('Substring that should appear in the response URL'),
      method: z.string().optional().describe('Optional HTTP method filter such as GET or POST'),
      timeoutMs: z.number().optional().describe('Maximum time to wait in milliseconds, defaults to 15000'),
      clickTimeoutMs: z.number().optional().describe('Click timeout in milliseconds (optional, defaults to locator default timeout)'),
      allowTimeout: z.boolean().optional().describe('When true, return success=false on timeout instead of throwing an error'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const timeoutMs = params.timeoutMs ?? 15000;

    const locator = await tab.refLocator(params);
    const locatorSource = await generateLocator(locator);
    const locatorExpression = locatorSource ? `await page.${locatorSource}` : undefined;
    const button = params.button;
    const buttonAttr = button ? `{ button: '${button}' }` : '';
    const clickCode = locatorExpression
      ? (params.doubleClick
        ? `${locatorExpression}.dblclick(${buttonAttr});`
        : `${locatorExpression}.click(${buttonAttr});`)
      : undefined;
    if (params.allowTimeout && clickCode) {
      addReplayCode(response,
        `let __resp = null;\n` +
        `try {\n` +
        `  [__resp] = await Promise.all([\n` +
        `    page.waitForResponse((resp) => resp.url().includes(${JSON.stringify(params.urlPattern)})` +
        `${params.method ? ` && resp.request().method() === ${JSON.stringify(params.method)}` : ''}, { timeout: ${timeoutMs} }),\n` +
        `    ${clickCode}\n` +
        `  ]);\n` +
        `} catch (e) {}\n` +
        `__resp;`,
        `Unable to generate reliable replay code for clicking element=${JSON.stringify(params.element)} while waiting for API ${JSON.stringify(params.urlPattern)}`);
    } else if (clickCode) {
      addReplayCode(response,
        `await Promise.all([\n` +
        `  page.waitForResponse((resp) => resp.url().includes(${JSON.stringify(params.urlPattern)})` +
        `${params.method ? ` && resp.request().method() === ${JSON.stringify(params.method)}` : ''}, { timeout: ${timeoutMs} }),\n` +
        `  ${clickCode}\n` +
        `]);`,
        `Unable to generate reliable replay code for clicking element=${JSON.stringify(params.element)} while waiting for API ${JSON.stringify(params.urlPattern)}`);
    } else {
      addReplayCode(response, undefined, `Unable to generate reliable replay code for clicking element=${JSON.stringify(params.element)} while waiting for API ${JSON.stringify(params.urlPattern)}`);
    }

    const result = await tab.waitForCompletion(async () => {
      try {
        const respPromise = tab.page.waitForResponse((resp: any) => {
          if (!resp.url().includes(params.urlPattern))
            return false;
          if (params.method && resp.request().method() !== params.method)
            return false;
          return true;
        }, { timeout: timeoutMs });

        const clickTimeout = params.clickTimeoutMs;
        if (params.doubleClick)
          await locator.dblclick({ button, timeout: clickTimeout });
        else
          await locator.click({ button, timeout: clickTimeout });

        const resp = await respPromise;
        let body: any = null;
        try {
          body = await resp.json();
        } catch {
          try {
            body = await resp.text();
          } catch {
          }
        }

        return {
          success: true,
          status: resp.status(),
          body,
          url: resp.url(),
          method: resp.request().method(),
        };
      } catch (error: any) {
        const message = error?.message || String(error);
        if (message.includes('Timeout') || message.includes('timeout')) {
          const timeoutResult = { success: false, timeout: true, error: message };
          if (params.allowTimeout)
            return timeoutResult;
          throw new Error(`Timed out waiting for API response: urlPattern=${params.urlPattern}${params.method ? ` method=${params.method}` : ''}. Original error: ${message}`);
        }
        throw error;
      }
    });

    response.addResult(JSON.stringify(result, null, 2));
  },
});

const waitForAny = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for_any',
    title: 'Wait for any condition',
    description: 'Wait until any one of url, selector, text, or textGone conditions matches',
    inputSchema: z.object({
      url: z.string().optional().describe('Substring that should appear in the current URL'),
      notUrl: z.string().optional().describe('Substring that must not appear in the current URL when url is matched'),
      selector: z.string().optional().describe('CSS selector that should appear on the page'),
      text: z.string().optional().describe('Text that should appear on the page'),
      textGone: z.string().optional().describe('Text that should disappear from the page'),
      timeoutMs: z.number().optional().describe('Maximum time to wait in milliseconds, defaults to 10000'),
      allowTimeout: z.boolean().optional().describe('When true, return timeout details instead of throwing on timeout'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    if (!params.url && !params.selector && !params.text && !params.textGone)
      throw new Error('At least one of url, selector, text, or textGone must be provided');

    const timeoutMs = params.timeoutMs ?? 10000;
    if (params.allowTimeout) {
      response.addCode(`await page.smart?.waitForAny?.(${JSON.stringify({
        url: params.url,
        notUrl: params.notUrl,
        selector: params.selector,
        text: params.text,
        textGone: params.textGone,
      })}, ${timeoutMs});`);
    } else {
      response.addCode(`const __waitAny = await page.smart?.waitForAny?.(${JSON.stringify({
        url: params.url,
        notUrl: params.notUrl,
        selector: params.selector,
        text: params.text,
        textGone: params.textGone,
      })}, ${timeoutMs});\nif (__waitAny?.timeout) throw new Error(__waitAny.error || 'Timed out waiting for any condition');`);
    }

    const result = await tab.waitForCompletion(async () => {
      try {
        await tab.page.waitForFunction((payload: any) => {
          const href = window.location.href;
          const urlMatched = payload.url
            ? href.includes(payload.url) && (!payload.notUrl || !href.includes(payload.notUrl))
            : false;
          const selectorMatched = payload.selector
            ? Boolean(document.querySelector(payload.selector))
            : false;
          const bodyText = document.body?.innerText ?? '';
          const textMatched = payload.text
            ? bodyText.includes(payload.text)
            : false;
          const textGoneMatched = payload.textGone
            ? !bodyText.includes(payload.textGone)
            : false;
          return urlMatched || selectorMatched || textMatched || textGoneMatched;
        }, {
          url: params.url,
          notUrl: params.notUrl,
          selector: params.selector,
          text: params.text,
          textGone: params.textGone,
        }, { timeout: timeoutMs });

        if (params.url) {
          const currentUrl = tab.page.url();
          if (currentUrl.includes(params.url)) {
            if (!params.notUrl || !currentUrl.includes(params.notUrl))
              return { matched: 'url', value: currentUrl };
          }
        }

        if (params.selector) {
          const count = await tab.page.locator(params.selector).count().catch(() => 0);
          if (count > 0)
            return { matched: 'selector', value: params.selector };
        }

        if (params.text) {
          const count = await tab.page.getByText(params.text).count().catch(() => 0);
          if (count > 0)
            return { matched: 'text', value: params.text };
        }

        if (params.textGone) {
          const count = await tab.page.getByText(params.textGone).count().catch(() => 0);
          if (count === 0)
            return { matched: 'textGone', value: params.textGone };
        }

        return { matched: null, timeout: true, error: 'Condition matched during wait, but final state could not be resolved.' };
      } catch (error: any) {
        const message = error?.message || String(error);
        if (message.includes('Timeout') || message.includes('timeout'))
          return { matched: null, timeout: true, error: message };
        throw error;
      }
    });

    response.addResult(JSON.stringify(result, null, 2));
    if (result?.timeout && !params.allowTimeout)
      throw new Error(result.error || 'Timed out waiting for any condition');
  },
});

const waitForApi = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for_api',
    title: 'Wait for API response',
    description: 'Wait for a matching API response by URL pattern and optional HTTP method',
    inputSchema: z.object({
      urlPattern: z.string().describe('Substring that should appear in the response URL'),
      method: z.string().optional().describe('Optional HTTP method filter such as GET or POST'),
      timeoutMs: z.number().optional().describe('Maximum time to wait in milliseconds, defaults to 15000'),
      allowTimeout: z.boolean().optional().describe('When true, return success=false on timeout instead of throwing an error'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const timeoutMs = params.timeoutMs ?? 15000;
    const codegenCall = `page.smart?.waitForAPI?.(${JSON.stringify(params.urlPattern)}, ${JSON.stringify({
      method: params.method,
      timeout: timeoutMs,
    })})`;
    if (params.allowTimeout)
      response.addCode(`await ${codegenCall};`);
    else
      response.addCode(`const __r = await ${codegenCall};\nif (!__r?.success) throw new Error('Timed out waiting for API response');`);

    const result = await tab.waitForCompletion(async () => {
      return await new Promise((resolve) => {
        let timeoutId: NodeJS.Timeout | undefined;
        const cleanup = () => {
          tab.page.off('response', handler);
          if (timeoutId)
            clearTimeout(timeoutId);
        };
        const handler = async (resp: any) => {
          if (!resp.url().includes(params.urlPattern))
            return;
          if (params.method && resp.request().method() !== params.method)
            return;

          let body: any = null;
          try {
            body = await resp.json();
          } catch {
            try {
              body = await resp.text();
            } catch {
            }
          }

          cleanup();
          resolve({
            success: true,
            status: resp.status(),
            body,
            url: resp.url(),
            method: resp.request().method(),
          });
        };

        tab.page.on('response', handler);
        timeoutId = setTimeout(() => {
          cleanup();
          resolve({
            success: false,
            timeout: true,
            urlPattern: params.urlPattern,
            method: params.method ?? null,
          });
        }, timeoutMs);
      });
    });

    if (!result?.success && result?.timeout && !params.allowTimeout)
      throw new Error(`Timed out waiting for API response: urlPattern=${params.urlPattern}${params.method ? ` method=${params.method}` : ''}.`);

    response.addResult(JSON.stringify(result, null, 2));
  },
});

export default [waitForAny, waitForApi, clickAndWaitForApi];
