import { z } from 'zod';
import { defineTabTool } from './tool.js';
import { buildFuzzyRoleNameOption, parseRoleNameOption } from './role_name.js';

function parseBooleanLike(value: string) {
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized))
    return true;
  if (['false', '0', 'no', 'off'].includes(normalized))
    return false;
  return undefined;
}

async function retryEnhancedAction(tab: any, action: (tab: any) => Promise<boolean>, timeoutMs?: number) {
  const deadline = Date.now() + Math.max(500, timeoutMs ?? 5000);
  let lastResult = false;
  while (Date.now() < deadline) {
    lastResult = await action(tab).catch(() => false);
    if (lastResult)
      return true;
    await tab.page.waitForTimeout(150);
  }
  return lastResult;
}

const selectorSchema = z.object({
  selector: z.string().describe('CSS selector'),
  timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
});

const clickRole = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_click_role',
    title: 'Click by role',
    description: 'Click an element by ARIA role and name (testing helper)',
    inputSchema: z.object({
      role: z.string().describe('ARIA role, e.g. button'),
      name: z.string().describe('Accessible name'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const timeoutMs = params.timeoutMs;
    const role = String(params.role);
    const rawName = String(params.name);
    const exactName = parseRoleNameOption(rawName);
    const fuzzyName = buildFuzzyRoleNameOption(rawName);

    const clickByName = async (name: string | RegExp, suffix?: string) => {
      const locator = tab.page.getByRole(role, { name });
      const count = await locator.count().catch(() => 0);
      if (!count)
        throw new Error(`Strict role locator did not match any element for role=${role} name=${String(name)}`);
      await tab.waitForCompletion(async () => {
        await locator.first().click({ timeout: timeoutMs });
      });
      response.addResult(`clicked role=${role} name=${rawName}${suffix ?? ''}`);
    };

    let lastError: any;
    try {
      await clickByName(exactName);
      return;
    } catch (error: any) {
      lastError = error;
    }

    if (fuzzyName) {
      try {
        await clickByName(fuzzyName, ' (fuzzy)');
        return;
      } catch (error: any) {
        lastError = error;
      }
    }

    const candidates = await tab.page.getByRole(role).evaluateAll((elements: any[]) => {
      const items: any[] = [];
      for (const element of elements.slice(0, 12)) {
        const text = (element as HTMLElement).innerText || element.textContent || '';
        items.push({
          tag: (element as HTMLElement).tagName,
          role: element.getAttribute('role'),
          ariaLabel: element.getAttribute('aria-label'),
          title: element.getAttribute('title'),
          text: String(text).trim().slice(0, 160),
        });
      }
      return items;
    }).catch(() => []);
    const hint = candidates.length ? ` Candidates(role=${role})[0..${candidates.length - 1}]=${JSON.stringify(candidates)}` : '';
    const message = lastError?.message || String(lastError);
    throw new Error(
      `Unable to click by role. role=${role} name=${rawName}. Tried exact=${String(exactName)}${fuzzyName ? `, fuzzy=${String(fuzzyName)}` : ''}. Original error: ${message}.${hint}`
    );
  },
});

const fillLabel = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_fill_label',
    title: 'Fill by label',
    description: 'Fill an input by label (testing helper)',
    inputSchema: z.object({
      label: z.string().describe('Label text'),
      value: z.string().describe('Value to fill'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const booleanValue = parseBooleanLike(params.value);
    try {
      const locator = tab.page.getByLabel(params.label).first();
      await tab.waitForCompletion(async () => {
        await locator.fill(params.value, { timeout: params.timeoutMs });
      });
      response.addResult(`filled label=${params.label}`);
      return;
    } catch (error: any) {
      if (booleanValue !== undefined) {
        const toggled = await retryEnhancedAction(tab, async (currentTab: any) => {
          return await currentTab.page.evaluate(({ label, checked }: any) => {
            return (window as any).__playwrightEnhanced?.uni?.toggleCheckboxByLabel?.(label, checked) || false;
          }, { label: params.label, checked: booleanValue });
        }, params.timeoutMs);
        if (toggled) {
          response.addResult(`toggled label=${params.label} checked=${booleanValue}`);
          return;
        }
      }

      const filled = await retryEnhancedAction(tab, async (currentTab: any) => {
        return await currentTab.page.evaluate(({ label, value }: any) => {
          return (window as any).__playwrightEnhanced?.uni?.fillInputByLabel?.(label, value) || false;
        }, { label: params.label, value: params.value });
      }, params.timeoutMs);
      if (filled) {
        response.addResult(`filled label=${params.label}`);
        return;
      }

      const message = error?.message || String(error);
      if (booleanValue !== undefined) {
        throw new Error(
          `Unable to toggle label=${params.label}. The label does not resolve to a checkbox-like control. Original error: ${message}`
        );
      }
      throw new Error(
        `Unable to fill label=${params.label}. The label may not target a fillable input. Original error: ${message}`
      );
    }
  },
});

const waitForUrlContains = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for_url_contains',
    title: 'Wait for URL contains',
    description: 'Wait for current page URL to contain a substring (testing helper)',
    inputSchema: z.object({
      contains: z.string().describe('Substring that should appear in URL'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const timeout = params.timeoutMs ?? 30000;
    await tab.page.waitForURL((url: URL) => url.toString().includes(params.contains), { timeout });
    response.addResult(tab.page.url());
  },
});

const clickSelector = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_click_selector',
    title: 'Click by selector',
    description: 'Click an element by CSS selector (testing helper)',
    inputSchema: selectorSchema.extend({
      force: z.boolean().optional().describe('Whether to force the click'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const locator = tab.page.locator(params.selector).first();
    if (params.timeoutMs !== undefined)
      await locator.waitFor({ state: 'visible', timeout: params.timeoutMs });
    await locator.click({ timeout: params.timeoutMs, force: params.force });
    response.addResult(`clicked selector: ${params.selector}`);
  },
});

const fillSelector = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_fill_selector',
    title: 'Fill by selector',
    description: 'Fill an input by CSS selector (testing helper)',
    inputSchema: selectorSchema.extend({
      value: z.string().describe('Value to fill'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const locator = tab.page.locator(params.selector).first();
    if (params.timeoutMs !== undefined)
      await locator.waitFor({ state: 'visible', timeout: params.timeoutMs });
    await locator.fill(params.value, { timeout: params.timeoutMs });
    response.addResult(`filled selector: ${params.selector}`);
  },
});

const waitForSelector = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for_selector',
    title: 'Wait for selector',
    description: 'Wait for a selector to be in a given state (testing helper)',
    inputSchema: selectorSchema.extend({
      state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().describe('Wait state'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const locator = tab.page.locator(params.selector).first();
    await locator.waitFor({ state: params.state ?? 'visible', timeout: params.timeoutMs });
    response.addResult(`waited selector: ${params.selector} state=${params.state ?? 'visible'}`);
  },
});

const hoverSelector = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_hover_selector',
    title: 'Hover by selector',
    description: 'Hover an element by CSS selector (testing helper)',
    inputSchema: selectorSchema,
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const locator = tab.page.locator(params.selector).first();
    if (params.timeoutMs !== undefined)
      await locator.waitFor({ state: 'visible', timeout: params.timeoutMs });
    await locator.hover({ timeout: params.timeoutMs });
    response.addResult(`hovered selector: ${params.selector}`);
  },
});

const clickText = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_click_text',
    title: 'Click by text',
    description: 'Click an element by text (testing helper)',
    inputSchema: z.object({
      text: z.string().describe('Text to match'),
      exact: z.boolean().optional().describe('Exact match'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const exact = Boolean(params.exact);
    const overlaySelectors = [
      '[role="listbox"]',
      '[role="menu"]',
      '[role="dialog"]',
      '[data-radix-popper-content-wrapper]',
      '[data-state="open"]',
      '.el-select-dropdown',
      '.el-popper',
    ];
    try {
      for (const selector of overlaySelectors) {
        const roots = tab.page.locator(selector);
        const count = await roots.count().catch(() => 0);
        for (let index = count - 1; index >= 0; index--) {
          const root = roots.nth(index);
          const visible = await root.isVisible().catch(() => false);
          if (!visible)
            continue;
          const scoped = root.getByText(params.text, { exact }).first();
          const scopedCount = await scoped.count().catch(() => 0);
          if (!scopedCount)
            continue;
          await tab.waitForCompletion(async () => {
            await scoped.click({ timeout: params.timeoutMs });
          });
          response.addResult(`clicked text: ${params.text} (overlay=${selector})`);
          return;
        }
      }

      const locator = tab.page.getByText(params.text, { exact }).first();
      await tab.waitForCompletion(async () => {
        await locator.click({ timeout: params.timeoutMs });
      });
      response.addResult(`clicked text: ${params.text}`);
      return;
    } catch (error) {
      const clicked = await tab.page.evaluate((payload: any) => {
        return (window as any).__playwrightEnhanced?.uni?.clickByText?.(payload.text) || false;
      }, { text: params.text }).catch(() => false);
      if (!clicked)
        throw error;
      response.addResult(`clicked text: ${params.text}`);
    }
  },
});

const waitText = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for_text',
    title: 'Wait for text',
    description: 'Wait for text to appear (testing helper)',
    inputSchema: z.object({
      text: z.string().describe('Text to match'),
      exact: z.boolean().optional().describe('Exact match'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const locator = tab.page.getByText(params.text, { exact: Boolean(params.exact) }).first();
    await locator.waitFor({ state: 'visible', timeout: params.timeoutMs });
    response.addResult(`waited text: ${params.text}`);
  },
});

const getUrl = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_get_url',
    title: 'Get current URL',
    description: 'Get the current page URL (testing helper)',
    inputSchema: z.object({}),
    type: 'readOnly',
  },
  handle: async (tab: any, _params: any, response: any) => {
    response.addResult(tab.page.url());
  },
});

export default [
  clickSelector,
  fillSelector,
  waitForSelector,
  hoverSelector,
  clickText,
  clickRole,
  fillLabel,
  waitText,
  waitForUrlContains,
  getUrl,
];
