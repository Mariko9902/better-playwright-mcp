import { z } from 'zod';
import { defineTabTool } from './tool.js';

function createEnhancedRuntimeError(tab: any, message: string) {
  const failures = tab.context?.initPageFailures?.(tab.page) ?? [];
  const details = failures.length
    ? ` init_page_failures=${JSON.stringify(failures.map((item: any) => ({ path: item.path, resolvedPath: item.resolvedPath, error: String(item.error ?? '').slice(0, 500) })))}`
    : ' Ensure BETTER_PLAYWRIGHT_INIT_PAGE points to the enhanced init-page module.';
  const error: any = new Error(`${message}.${details}`);
  error.mcpIsUserError = true;
  error.mcpCode = 'ENHANCED_RUNTIME_UNAVAILABLE';
  return error;
}

const resilienceAction = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_resilient_action',
    title: 'Resilient browser action',
    description: 'Execute retry, JS fallback, diagnose, or enhanced screenshot actions through page.smart utilities',
    inputSchema: z.object({
      action: z.enum([
        'click_with_retry',
        'fill_with_retry',
        'js_click',
        'js_fill',
        'diagnose',
        'smart_screenshot',
      ]).describe('Resilient action to execute'),
      selector: z.string().optional().describe('CSS selector for click/fill fallback actions'),
      value: z.string().optional().describe('Value to fill when action requires text input'),
      retries: z.number().optional().describe('Retry count for retry-based actions'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds for retry-based actions'),
      name: z.string().optional().describe('Optional screenshot name prefix'),
      delayMs: z.number().int().min(0).optional().describe('Delay before taking screenshot in milliseconds. Default is 2000 (only for action=smart_screenshot).'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    if (params.action === 'diagnose' || params.action === 'smart_screenshot')
      response.setIncludeSnapshot();

    const validators: Record<string, () => void> = {
      click_with_retry: () => {
        if (typeof params.selector !== 'string')
          throw new Error('selector is required for click_with_retry');
      },
      fill_with_retry: () => {
        if (typeof params.selector !== 'string')
          throw new Error('selector is required for fill_with_retry');
        if (typeof params.value !== 'string')
          throw new Error('value is required for fill_with_retry');
      },
      js_click: () => {
        if (typeof params.selector !== 'string')
          throw new Error('selector is required for js_click');
      },
      js_fill: () => {
        if (typeof params.selector !== 'string')
          throw new Error('selector is required for js_fill');
        if (typeof params.value !== 'string')
          throw new Error('value is required for js_fill');
      },
      diagnose: () => {},
      smart_screenshot: () => {},
    };

    const codeByAction: Record<string, string> = {
      click_with_retry: `await page.smart.clickWithRetry(${JSON.stringify(params.selector ?? '')}, { retries: ${params.retries ?? 2}, timeout: ${params.timeoutMs ?? 3000} });`,
      fill_with_retry: `await page.smart.fillWithRetry(${JSON.stringify(params.selector ?? '')}, ${JSON.stringify(params.value ?? '')}, { retries: ${params.retries ?? 2}, timeout: ${params.timeoutMs ?? 3000} });`,
      js_click: `await page.smart.jsClick(${JSON.stringify(params.selector ?? '')});`,
      js_fill: `await page.smart.jsFill(${JSON.stringify(params.selector ?? '')}, ${JSON.stringify(params.value ?? '')});`,
      diagnose: `await page.smart.diagnose();`,
      smart_screenshot: `await page.smart.screenshot(${params.name ? JSON.stringify(params.name) : ''});`,
    };

    validators[params.action]?.();
    response.addCode(codeByAction[params.action]);

    const result = await tab.waitForCompletion(async () => {
      const smart = (tab.page as any).smart;
      if (!smart)
        throw createEnhancedRuntimeError(tab, 'page.smart is not available');

      switch (params.action) {
        case 'click_with_retry':
          return await smart.clickWithRetry(params.selector, { retries: params.retries ?? 2, timeout: params.timeoutMs ?? 3000 });
        case 'fill_with_retry':
          return await smart.fillWithRetry(params.selector, params.value, { retries: params.retries ?? 2, timeout: params.timeoutMs ?? 3000 });
        case 'js_click':
          return await smart.jsClick(params.selector);
        case 'js_fill':
          return await smart.jsFill(params.selector, params.value);
        case 'diagnose':
          return await smart.diagnose();
        case 'smart_screenshot':
          await tab.waitForTimeout(params.delayMs ?? 2000);
          return await smart.screenshot(params.name);
        default:
          throw new Error(`Unsupported resilient action: ${params.action}`);
      }
    });

    response.addResult(JSON.stringify(result, null, 2) || 'ok');
  },
});

export default [resilienceAction];
