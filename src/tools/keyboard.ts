import { z } from 'zod';
import { defineTabTool } from './tool.js';
import { addReplayCode, generateLocator } from './utils.js';
import { elementSchemaBase } from './snapshot.js';

const type = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_type',
    title: 'Type text',
    description: 'Type text into editable element',
    inputSchema: elementSchemaBase.extend({
      text: z.string().describe('Text to type into the element'),
      submit: z.boolean().optional().describe('Whether to submit entered text (press Enter after)'),
      slowly: z.boolean().optional().describe('Whether to type one character at a time. Useful for triggering key handlers in the page. By default entire text is filled in at once.'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const locator = await tab.refLocator({
      ...params,
      controlType: params.controlType ?? 'input',
      preferRole: params.preferRole ?? 'textbox',
    });
    const locatorSource = await generateLocator(locator);
    const locatorExpr = locatorSource ? `await page.${locatorSource}` : undefined;
    await tab.waitForCompletion(async () => {
      if (params.slowly) {
        response.setIncludeSnapshot();
        addReplayCode(response,
          locatorExpr ? `${locatorExpr}.pressSequentially(${JSON.stringify(params.text)});` : undefined,
          `Unable to generate reliable replay code for typing slowly into element=${JSON.stringify(params.element)}`);
        await locator.pressSequentially(params.text);
      } else {
        addReplayCode(response,
          locatorExpr ? `${locatorExpr}.fill(${JSON.stringify(params.text)});` : undefined,
          `Unable to generate reliable replay code for filling element=${JSON.stringify(params.element)}`);
        await locator.fill(params.text);
      }
      if (params.submit) {
        response.setIncludeSnapshot();
        addReplayCode(response,
          locatorExpr ? `${locatorExpr}.press('Enter');` : undefined,
          `Unable to generate reliable replay code for submitting element=${JSON.stringify(params.element)}`);
        await locator.press('Enter');
      }
    });
  },
});

export default [type];
