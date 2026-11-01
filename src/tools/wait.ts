import { z } from 'zod';
import { defineTool } from './tool.js';

const wait = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for',
    title: 'Wait for',
    description: 'Wait for text to appear or disappear or a specified time to pass',
    inputSchema: z.object({
      time: z.number().optional().describe('The time to wait in seconds'),
      text: z.string().optional().describe('The text to wait for'),
      textGone: z.string().optional().describe('The text to wait for to disappear'),
    }),
    type: 'readOnly',
  },
  handle: async (context: any, params: any, response: any) => {
    if (!params.text && !params.textGone && params.time === undefined)
      throw new Error('Either time, text or textGone must be provided');
    if (params.time !== undefined) {
      response.addCode(`await new Promise(f => setTimeout(f, ${params.time} * 1000));`);
      const currentTab = context.currentTab();
      if (currentTab)
        await currentTab.waitForTimeout(params.time * 1000);
      else
        await new Promise(f => setTimeout(f, params.time * 1000));
    }
    if (!params.text && !params.textGone) {
      response.addResult(`Waited for ${params.time}`);
      return;
    }
    const tab = context.currentTabOrDie();
    const locator = params.text ? tab.page.getByText(params.text).first() : undefined;
    const goneLocator = params.textGone ? tab.page.getByText(params.textGone).first() : undefined;
    if (goneLocator) {
      response.addCode(`await page.getByText(${JSON.stringify(params.textGone)}).first().waitFor({ state: 'hidden' });`);
      await goneLocator.waitFor({ state: 'hidden' });
    }
    if (locator) {
      response.addCode(`await page.getByText(${JSON.stringify(params.text)}).first().waitFor({ state: 'visible' });`);
      await locator.waitFor({ state: 'visible' });
    }
    response.addResult(`Waited for ${params.text ?? params.textGone ?? params.time}`);
  },
});

export default [wait];
