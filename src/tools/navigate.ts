import { z } from 'zod';
import { defineTool } from './tool.js';

function appendLoopbackHint(url: string, error: any) {
  const raw = error instanceof Error ? (error.stack || error.message) : String(error);
  if (!raw.includes('ERR_CONNECTION_REFUSED'))
    return error;
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
  }
  const host = parsed?.hostname;
  if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host))
    return error;
  const decorated: any = new Error(
    `${raw}\nHint: This looks like a local dev server on ${host}. Some apps bind only one loopback hostname. Try the same URL with localhost, 127.0.0.1, or ::1.`,
  );
  decorated.mcpIsUserError = true;
  decorated.mcpCode = 'LOCALHOST_LOOPBACK_HINT';
  return decorated;
}

const navigate = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_navigate',
    title: 'Navigate',
    description: 'Navigate to a URL. When device mode is required and none is set yet, this tool will use the provided mode or fall back to the configured default mode, otherwise H5.',
    inputSchema: z.object({
      url: z.string().describe('URL to navigate to'),
      mode: z.enum(['H5', 'PC']).optional().describe('Optional device mode to set before navigation'),
    }),
    type: 'destructive',
  },
  handle: async (context: any, params: any, response: any) => {
    const fallbackMode = context?.deviceModeRequired?.() && !context?.deviceMode?.()
      ? (context?.config?.browser?.devicePolicy?.defaultDeviceMode ?? 'H5')
      : undefined;
    const effectiveMode = params.mode ?? fallbackMode;
    if (effectiveMode)
      await context.setDeviceMode(effectiveMode);
    await context.ensureTab();
    const tab = context.currentTabOrDie();
    if (effectiveMode)
      response.addCode(`// browser_set_device_mode(${effectiveMode})`);
    response.addCode(`await page.goto(${JSON.stringify(params.url)});`);
    try {
      await tab.navigate(params.url);
    } catch (error) {
      throw appendLoopbackHint(params.url, error);
    }
    response.addResult(`Navigated to ${params.url}`);
    response.setIncludeSnapshot();
    response.setIncludeTabs();
  },
});

export default [navigate];
