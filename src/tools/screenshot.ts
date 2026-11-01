import { z } from 'zod';
import { defineTabTool } from './tool.js';
import * as javascript from '../utils/codegen.js';
import { addReplayCode, generateLocator } from './utils.js';

const screenshotSchema = z.object({
  type: z.enum(['png', 'jpeg']).default('png').describe('Image format for the screenshot. Default is png.'),
  filename: z.string().optional().describe('File name to save the screenshot to. Supports absolute paths. Relative paths are resolved under the configured output directory. Defaults to `page-{timestamp}.{png|jpeg}` if not specified.'),
  element: z.string().optional().describe('Human-readable element description used to obtain permission to screenshot the element. If not provided, the screenshot will be taken of viewport. If element is provided, ref must be provided too.'),
  ref: z.string().optional().describe('Exact target element reference from the page snapshot. If not provided, the screenshot will be taken of viewport. If ref is provided, element must be provided too.'),
  fullPage: z.boolean().optional().describe('When true, takes a screenshot of the full scrollable page, instead of the currently visible viewport. Cannot be used with element screenshots.'),
  delayMs: z.number().int().min(0).optional().describe('Delay before taking screenshot in milliseconds. Default is 2000.'),
}).refine(data => {
  return !!data.element === !!data.ref;
}, {
  message: 'Both element and ref must be provided or neither.',
  path: ['ref', 'element'],
}).refine(data => {
  return !(data.fullPage && (data.element || data.ref));
}, {
  message: 'fullPage cannot be used with element screenshots.',
  path: ['fullPage'],
});

const screenshot = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_take_screenshot',
    title: 'Take a screenshot',
    description: `Take a screenshot of the current page. You can't perform actions based on the screenshot, use browser_snapshot for actions.`,
    inputSchema: screenshotSchema,
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const fileType = params.type || 'png';
    const fileName = await tab.context.outputFile(params.filename ?? `page-${new Date().toISOString()}.${fileType}`);
    const delayMs = params.delayMs ?? 2000;
    const options: any = {
      type: fileType,
      quality: fileType === 'png' ? undefined : 90,
      scale: 'css',
      path: fileName,
      ...(params.fullPage !== undefined && { fullPage: params.fullPage }),
    };
    const isElementScreenshot = params.element && params.ref;
    const screenshotTarget = isElementScreenshot ? params.element : (params.fullPage ? 'full page' : 'viewport');
    response.addCode(`// Screenshot ${screenshotTarget} and save it as ${fileName}`);
    response.addCode(`// Delay ${delayMs}ms before taking screenshot`);
    await tab.waitForTimeout(delayMs);
    const locator = params.ref ? await tab.refLocator({ element: params.element || '', ref: params.ref }) : null;
    if (locator) {
      const locatorSource = await generateLocator(locator);
      addReplayCode(response,
        locatorSource ? `await page.${locatorSource}.screenshot(${javascript.formatObject(options)});` : undefined,
        `Unable to generate reliable replay code for screenshotting element=${JSON.stringify(params.element)}`);
    } else {
      response.addCode(`await page.screenshot(${javascript.formatObject(options)});`);
    }
    const buffer = locator ? await locator.screenshot(options) : await tab.page.screenshot(options);
    response.addResult(`Took the ${screenshotTarget} screenshot and saved it as ${fileName}`);
    if (!params.fullPage) {
      response.addImage({
        contentType: fileType === 'png' ? 'image/png' : 'image/jpeg',
        data: buffer,
      });
    }
  },
});

export default [screenshot];
