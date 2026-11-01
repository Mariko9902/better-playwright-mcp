import { z } from 'zod';
import { defineTabTool } from './tool.js';
import * as javascript from '../utils/codegen.js';
import { addReplayCode, generateLocator } from './utils.js';
import { elementSchemaBase } from './snapshot.js';

const evaluateSchema = z.object({
  function: z.string().describe('() => { /* code */ } or (element) => { /* code */ } when element is provided'),
}).merge(elementSchemaBase.partial());

const evaluate = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_evaluate',
    title: 'Evaluate JavaScript',
    description: 'Evaluate JavaScript expression on page or element',
    inputSchema: evaluateSchema,
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    let locator: any;
    let compiledFn: any;
    if (params.element) {
      locator = await tab.refLocator(params);
      const locatorSource = await generateLocator(locator);
      addReplayCode(response,
        locatorSource ? `await page.${locatorSource}.evaluate(${javascript.quote(params.function)});` : undefined,
        `Unable to generate reliable replay code for evaluating on element=${JSON.stringify(params.element)}`);
    } else {
      response.addCode(`await page.evaluate(${javascript.quote(params.function)});`);
    }
    await tab.waitForCompletion(async () => {
      try {
        compiledFn = new Function(`return (${params.function});`)();
      } catch (error: any) {
        throw new Error(`Failed to compile evaluate function: ${error?.message || String(error)}`);
      }

      const result = locator
        ? await locator.evaluate(compiledFn)
        : await tab.page.evaluate(compiledFn);
      response.addResult(JSON.stringify(result, null, 2) || 'undefined');
    });
  },
});

export default [evaluate];
