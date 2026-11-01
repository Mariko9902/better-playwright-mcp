import fs from 'fs';
import { createRequire } from 'module';
import vm from 'vm';
import { z } from 'zod';
import { defineTabTool } from './tool.js';

const nodeRequire = createRequire(import.meta.url);

function serializeRunCodeResult(result: any) {
  if (result === undefined)
    return 'undefined';
  if (typeof result === 'string')
    return result;
  try {
    const json = JSON.stringify(result, null, 2);
    if (json !== undefined)
      return json;
  } catch {
  }
  return String(result);
}

function decorateRunCodeError(error: any) {
  const originalMessage = error instanceof Error ? (error.stack || error.message) : String(error);
  if (/\b(localStorage|sessionStorage|document|window|location|navigator)\b is not defined/.test(originalMessage)) {
    const decorated: any = new Error(
      `${originalMessage}\nHint: browser_run_code executes in Node/Playwright context, not inside the page. Use await page.evaluate(() => { ... }) to read or write DOM state, window, localStorage, or sessionStorage.`,
    );
    decorated.mcpIsUserError = true;
    decorated.mcpCode = 'RUN_CODE_PAGE_CONTEXT_REQUIRED';
    return decorated;
  }
  return error;
}

function createAsyncEventGuard(rethrow: (error: any) => void) {
  return (listener: any) => {
    if (typeof listener !== 'function')
      return listener;
    return (...args: any[]) => {
      try {
        const result = listener(...args);
        if (result && typeof result.then === 'function')
          result.catch(rethrow);
        return result;
      } catch (error) {
        rethrow(error);
      }
    };
  };
}

const runCode = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_run_code',
    title: 'Run Playwright code',
    description: 'Run a Playwright code snippet. The function runs in Node/Playwright context. To access DOM APIs, window, localStorage, or sessionStorage, use page.evaluate inside the snippet.',
    inputSchema: z.object({
      code: z.string().describe("A JavaScript function containing Playwright code to execute. It will be invoked with a single argument, page, which you can use for any page interaction. For example: `async (page) => { await page.getByRole('button', { name: 'Submit' }).click(); return await page.title(); }`. To read or write page globals such as localStorage or document, wrap that part in `await page.evaluate(() => { ... })`."),
      filename: z.string().optional().describe('Filename to save the result to. If not provided, result is returned as JSON string.'),
      timeoutMs: z.number().optional().describe('Maximum time to allow the code snippet to run before failing, defaults to 10000.'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const timeoutMs = params.timeoutMs ?? 10000;
    response.setIncludeSnapshot();
    response.addCode(`await (${params.code})(page);`);
    await tab.waitForCompletion(async () => {
      let asyncErrorReject: ((error: any) => void) | undefined;
      const asyncError = new Promise((_, reject) => {
        asyncErrorReject = reject;
      });
      const rejectAsyncError = (error: any) => {
        asyncErrorReject?.(decorateRunCodeError(error));
      };
      const wrapAsyncListener = createAsyncEventGuard(rejectAsyncError);

      const pageProxy = new Proxy(tab.page, {
        get(target, prop, receiver) {
          if (prop === 'on' || prop === 'once') {
            const method = Reflect.get(target, prop, receiver);
            return (eventName: any, listener: any) => method.call(target, eventName, wrapAsyncListener(listener));
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const context = vm.createContext({
        page: pageProxy,
        require: nodeRequire,
        console,
        setTimeout,
        clearTimeout,
        Promise,
        URL,
        URLSearchParams,
        TextDecoder,
        TextEncoder,
        Buffer,
      });
      const script = new vm.Script(`(${params.code})(page)`);
      let timeoutId: NodeJS.Timeout | undefined;
      const execution = Promise.resolve().then(() => script.runInContext(context)).catch((error: any) => {
        throw decorateRunCodeError(error);
      });
      const result = await Promise.race([
        execution,
        asyncError,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            const error: any = new Error(`browser_run_code timed out after ${timeoutMs}ms`);
            error.mcpCode = 'RUN_CODE_TIMEOUT';
            error.mcpIsUserError = true;
            reject(error);
          }, timeoutMs);
        }),
      ]);
      if (timeoutId)
        clearTimeout(timeoutId);
      const serialized = serializeRunCodeResult(result);
      if (params.filename) {
        const fileName = await tab.context.outputFile(params.filename);
        await fs.promises.writeFile(fileName, serialized, 'utf8');
        response.addResult(`Saved result to ${fileName}`);
      } else {
        response.addResult(serialized);
      }
    });
  },
});

export default [runCode];
