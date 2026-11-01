import { z } from 'zod';
import { defineTabTool, defineTool } from './tool.js';
import * as javascript from '../utils/codegen.js';
import { addReplayCode, generateLocator } from './utils.js';

const snapshot = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_snapshot',
    title: 'Page snapshot',
    description: 'Capture accessibility snapshot of the current page, this is better than screenshot',
    inputSchema: z.object({}),
    type: 'readOnly',
  },
  handle: async (context: any, _params: any, response: any) => {
    await context.ensureTab();
    response.setIncludeSnapshot();
  },
});

export const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().optional().describe('Exact target element reference from the page snapshot'),
  testId: z.string().optional().describe('Stable locator: data-testid value'),
  selector: z.string().optional().describe('Stable locator: CSS selector'),
  role: z.string().optional().describe('Stable locator: ARIA role (testing helper)'),
  name: z.string().optional().describe('Stable locator: accessible name (used with role)'),
  // Optional hints to reduce guessing and scope the search.
  controlType: z.enum(['button', 'input', 'select', 'checkbox', 'radio', 'slider', 'link', 'menu', 'table', 'dialog']).optional().describe('Hint: expected control type'),
  preferRole: z.string().optional().describe('Hint: preferred ARIA role to target (e.g., textbox/combobox/button/spinbutton)'),
  withinTestId: z.string().optional().describe('Hint: scope search within an ancestor container data-testid'),
  containerSelector: z.string().optional().describe('Hint: scope search within an ancestor container selector'),
  nearText: z.string().optional().describe('Hint: an anchor text near the target element, used for local search'),
});

export const elementSchemaBase = elementSchema;

export const refinedElementSchema = elementSchemaBase.refine(
  (v) => Boolean(v.ref || v.testId || v.selector || v.role),
  { message: 'One of ref/testId/selector/role is required' },
);

const fillRefSchema = elementSchemaBase.extend({
  value: z.string().describe('Value to fill in the element'),
  timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
});

const clickSchema = elementSchemaBase.extend({
  doubleClick: z.boolean().optional().describe('Whether to perform a double click instead of a single click'),
  button: z.enum(['left', 'right', 'middle']).optional().describe('Button to click, defaults to left'),
  timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
});

const click = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_click',
    title: 'Click',
    description: 'Perform click on a web page',
    inputSchema: clickSchema,
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.setIncludeSnapshot();
    const locator = await tab.refLocator(params);
    const button = params.button;
    const timeout = params.timeoutMs;
    const buttonAttr = button ? `{ button: '${button}' }` : '';
    const locatorSource = await generateLocator(locator);
    if (params.doubleClick) {
      addReplayCode(response,
        locatorSource ? `await page.${locatorSource}.dblclick(${buttonAttr});` : undefined,
        `Unable to generate reliable replay code for double-clicking element=${JSON.stringify(params.element)}`);
    } else {
      addReplayCode(response,
        locatorSource ? `await page.${locatorSource}.click(${buttonAttr});` : undefined,
        `Unable to generate reliable replay code for clicking element=${JSON.stringify(params.element)}`);
    }
    await tab.waitForCompletion(async () => {
      if (params.doubleClick)
        await locator.dblclick({ button, timeout });
      else
        await locator.click({ button, timeout });
    });
    response.addResult(`clicked element="${params.element}" locator=${locatorSource ?? '(replay code unavailable)'}`);
  },
});

const fillRef = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_fill_ref',
    title: 'Fill by ref',
    description: 'Fill an input by snapshot ref (testing helper)',
    inputSchema: fillRefSchema,
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.setIncludeSnapshot();
    const locator = await tab.refLocator({
      ...params,
      controlType: params.controlType ?? 'input',
      preferRole: params.preferRole ?? 'textbox',
    });
    const locatorSource = await generateLocator(locator);
    addReplayCode(response,
      locatorSource ? `await page.${locatorSource}.fill(${javascript.quote(params.value)});` : undefined,
      `Unable to generate reliable replay code for filling element=${JSON.stringify(params.element)}`);
    await tab.waitForCompletion(async () => {
      await locator.fill(params.value, { timeout: params.timeoutMs });
    });
    response.addResult(`filled element="${params.element}" locator=${locatorSource ?? '(replay code unavailable)'}`);
  },
});

const drag = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_drag',
    title: 'Drag mouse',
    description: 'Perform drag and drop between two elements',
    inputSchema: z.object({
      startElement: z.string().describe('Human-readable source element description used to obtain the permission to interact with the element'),
      startRef: z.string().optional().describe('Exact source element reference from the page snapshot'),
      startTestId: z.string().optional().describe('Stable locator: data-testid value for source element'),
      startSelector: z.string().optional().describe('Stable locator: CSS selector for source element'),
      startRole: z.string().optional().describe('Stable locator: ARIA role for source element'),
      startName: z.string().optional().describe('Accessible name for source element (used with role)'),
      endElement: z.string().describe('Human-readable target element description used to obtain the permission to interact with the element'),
      endRef: z.string().optional().describe('Exact target element reference from the page snapshot'),
      endTestId: z.string().optional().describe('Stable locator: data-testid value for target element'),
      endSelector: z.string().optional().describe('Stable locator: CSS selector for target element'),
      endRole: z.string().optional().describe('Stable locator: ARIA role for target element'),
      endName: z.string().optional().describe('Accessible name for target element (used with role)'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.setIncludeSnapshot();
    const [startLocator, endLocator] = await tab.refLocators([
      { element: params.startElement, ref: params.startRef, testId: params.startTestId, selector: params.startSelector, role: params.startRole, name: params.startName },
      { element: params.endElement, ref: params.endRef, testId: params.endTestId, selector: params.endSelector, role: params.endRole, name: params.endName },
    ]);
    await tab.waitForCompletion(async () => {
      try {
        await startLocator.dragTo(endLocator);
      }
      catch {
        const startBox = await startLocator.boundingBox();
        const endBox = await endLocator.boundingBox();
        if (!startBox || !endBox)
          throw new Error('Unable to compute drag bounding boxes for fallback drag');

        const startX = startBox.x + startBox.width / 2;
        const startY = startBox.y + startBox.height / 2;
        const endX = endBox.x + endBox.width / 2;
        const endY = endBox.y + Math.min(40, Math.max(12, endBox.height / 2));

        await tab.page.mouse.move(startX, startY);
        await tab.page.mouse.down();
        await tab.page.mouse.move(endX, endY, { steps: 20 });
        await tab.page.mouse.up();
      }
    });
    const startSource = await generateLocator(startLocator);
    const endSource = await generateLocator(endLocator);
    addReplayCode(response,
      startSource && endSource ? `await page.${startSource}.dragTo(page.${endSource});` : undefined,
      `Unable to generate reliable replay code for dragging ${JSON.stringify(params.startElement)} to ${JSON.stringify(params.endElement)}`);
  },
});

const hover = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_hover',
    title: 'Hover mouse',
    description: 'Hover over element on page',
    inputSchema: elementSchema,
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.setIncludeSnapshot();
    const locator = await tab.refLocator(params);
    const locatorSource = await generateLocator(locator);
    addReplayCode(response,
      locatorSource ? `await page.${locatorSource}.hover();` : undefined,
      `Unable to generate reliable replay code for hovering element=${JSON.stringify(params.element)}`);
    await tab.waitForCompletion(async () => {
      await locator.hover();
    });
  },
});

const selectOptionSchema = elementSchemaBase.extend({
  values: z.array(z.string()).describe('Array of values to select in the dropdown. This can be a single value or multiple values.'),
});

const selectOption = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_select_option',
    title: 'Select option',
    description: 'Select an option in a dropdown',
    inputSchema: selectOptionSchema,
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.setIncludeSnapshot();
    const locator = await tab.refLocator(params);
    const locatorSource = await generateLocator(locator);
    addReplayCode(response,
      locatorSource ? `await page.${locatorSource}.selectOption(${javascript.formatObject(params.values)});` : undefined,
      `Unable to generate reliable replay code for selecting option on element=${JSON.stringify(params.element)}`);
    await tab.waitForCompletion(async () => {
      await locator.selectOption(params.values);
    });
  },
});

export default [snapshot, click, fillRef, drag, hover, selectOption];
