import { z } from 'zod';
import { defineTabTool } from './tool.js';
import { addReplayCode, generateLocator } from './utils.js';
import * as javascript from '../utils/codegen.js';

 const fillForm = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_fill_form',
    title: 'Fill form',
    description: 'Fill multiple form fields',
    inputSchema: z.object({
      fields: z.array(z.object({
        name: z.string().describe('Human-readable field name'),
        type: z.enum(['textbox', 'spinbutton', 'checkbox', 'radio', 'combobox', 'slider']).describe('Type of the field'),
        ref: z.string().optional().describe('Exact target field reference from the page snapshot'),
        testId: z.string().optional().describe('Stable locator: data-testid value'),
        selector: z.string().optional().describe('Stable locator: CSS selector'),
        role: z.string().optional().describe('Stable locator: ARIA role'),
        roleName: z.string().optional().describe('Accessible name (used with role)'),
        controlType: z.enum(['button', 'input', 'select', 'checkbox', 'radio', 'slider', 'link', 'menu', 'table', 'dialog']).optional().describe('Hint: expected control type'),
        preferRole: z.string().optional().describe('Hint: preferred ARIA role to target (e.g., textbox/combobox/button/spinbutton)'),
        withinTestId: z.string().optional().describe('Hint: scope search within an ancestor container data-testid'),
        containerSelector: z.string().optional().describe('Hint: scope search within an ancestor container selector'),
        nearText: z.string().optional().describe('Hint: an anchor text near the target element, used for local search'),
        value: z.string().describe('Value to fill in the field. If the field is a checkbox, the value should be `true` or `false`. If the field is a combobox, the value should be the text of the option.'),
      })).describe('Fields to fill in'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    for (const field of params.fields) {
      // In Uni-app / component-based UI, data-testid is often attached to a container element
      // (e.g. <uni-view>) instead of the actual <input>. When only testId is provided, infer
      // a stable inner role so Tab.refLocator can narrow to getByTestId(...).getByRole(...).
      let inferredRole: string | undefined;
      if (field.testId && !field.role) {
        if (field.type === 'textbox') inferredRole = 'textbox';
        else if (field.type === 'spinbutton') inferredRole = 'spinbutton';
        else if (field.type === 'checkbox') inferredRole = 'checkbox';
        else if (field.type === 'radio') inferredRole = 'radio';
        else if (field.type === 'combobox') inferredRole = 'combobox';
        else if (field.type === 'slider') inferredRole = 'slider';
      }

      const locator = await tab.refLocator({
        element: field.name,
        ref: field.ref,
        testId: field.testId,
        selector: field.selector,
        role: field.role ?? inferredRole,
        name: field.roleName,
        controlType: field.controlType,
        preferRole: field.preferRole,
        withinTestId: field.withinTestId,
        containerSelector: field.containerSelector,
        nearText: field.nearText,
      });
      const replayLocatorSource = await generateLocator(locator);
      const locatorExpr = replayLocatorSource ? `await page.${replayLocatorSource}` : undefined;
      if (field.type === 'textbox' || field.type === 'spinbutton' || field.type === 'slider') {
        await locator.fill(field.value);
        addReplayCode(response,
          locatorExpr ? `${locatorExpr}.fill(${javascript.quote(field.value)});` : undefined,
          `Unable to generate reliable replay code for filling field=${JSON.stringify(field.name)}`);
      } else if (field.type === 'checkbox' || field.type === 'radio') {
        await locator.setChecked(field.value === 'true');
        addReplayCode(response,
          locatorExpr ? `${locatorExpr}.setChecked(${javascript.quote(field.value)});` : undefined,
          `Unable to generate reliable replay code for toggling field=${JSON.stringify(field.name)}`);
      } else if (field.type === 'combobox') {
        // Universal combobox handling:
        // - If it's a native <select>, use selectOption.
        // - Otherwise, treat it as a component picker: click to open, click the option,
        //   and click a confirm button if present.

        const page = tab.page;
        const firstUsable = async (loc: any) => {
          try {
            const cnt = await loc.count();
            const max = Math.min(cnt, 8);
            for (let i = 0; i < max; i++) {
              const v = loc.nth(i);
              try {
                if (await v.isVisible()) {
                  try {
                    if (await v.isEnabled()) return v;
                  } catch {
                    return v;
                  }
                }
              } catch {
              }
            }
          } catch {
          }
          return loc.first();
        };

        const isNativeSelect = await locator.evaluate((el: any) => {
          const tag = (el?.tagName ?? '').toLowerCase();
          return tag === 'select';
        }).catch(() => false);

        if (isNativeSelect) {
          await locator.selectOption({ label: field.value });
          addReplayCode(response,
            locatorExpr ? `${locatorExpr}.selectOption(${javascript.quote(field.value)});` : undefined,
            `Unable to generate reliable replay code for selecting combobox field=${JSON.stringify(field.name)}`);
        } else {
          await locator.click();
          addReplayCode(response,
            locatorExpr ? `${locatorExpr}.click();` : undefined,
            `Unable to generate reliable replay code for opening combobox field=${JSON.stringify(field.name)}`);

          // Prefer selecting within visible dialogs/popups to avoid matching background text.
          const visibleDialog = page.getByRole('dialog' as any).filter({ has: page.locator(':visible') }).first();
          let scope: any = page;
          try {
            if (await visibleDialog.count()) scope = visibleDialog;
          } catch {
          }

          const byRoleOption = scope.getByRole('option' as any, { name: field.value });
          const byText = scope.getByText(field.value, { exact: false });

          const optionLocator = (await byRoleOption.count()) ? byRoleOption : byText;
          const option = await firstUsable(optionLocator);
          await option.click();

          // If there's an explicit confirm button, click it. Otherwise ignore.
          const confirmButtons = scope.getByRole('button' as any).filter({
            hasText: /^(\u786e\u5b9a|\u786e\u8ba4|\u5b8c\u6210|OK|Ok|ok|Yes|yes)$/,
          });
          try {
            if (await confirmButtons.count()) {
              await (await firstUsable(confirmButtons)).click();
            }
          } catch {
          }
        }
      }
    }
  },
});

export default [fillForm];
