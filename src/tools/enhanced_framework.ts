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

async function waitForTransientPickerOverlayToClose(tab: any, timeoutMs = 3000) {
  await tab.page.waitForFunction(() => {
    const selectors = [
      '.picker-dialog.open',
      '.uv-picker',
      '.u-picker',
      '.uv-popup',
      '[role="dialog"]',
      '[aria-modal="true"]',
    ];
    const isVisible = (element: Element | null) => {
      if (!(element instanceof HTMLElement))
        return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none')
        return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return !selectors.some(selector => Array.from(document.querySelectorAll(selector)).some(node => isVisible(node)));
  }, { timeout: timeoutMs }).catch(() => {});
}

async function fieldRowContainsText(tab: any, label: string, text: string) {
  return await tab.page.evaluate(({ label, text }: any) => {
    const normalize = (value: any) => String(value || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
    const normalizedLabel = normalize(label);
    const normalizedText = normalize(text);
    const isVisible = (node: any) => {
      if (!(node instanceof HTMLElement))
        return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden')
        return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const rowSelectors = '.field, .el-field, [data-field], [data-testid], uni-forms-item, li, tr, div';
    const labelNodes = Array.from(document.querySelectorAll('label, .label, span, div, text, uni-text')).filter((node: any) => {
      return isVisible(node) && normalize(node.innerText || node.textContent || '').replace(/\*/g, '') === normalizedLabel;
    });
    const controlSelector = 'input, textarea, select, button, [role="button"], [role="combobox"], [aria-haspopup], uni-picker, .picker-row, .uv-input, uni-view, uni-text';
    const candidates: HTMLElement[] = [];
    for (const labelNode of labelNodes) {
      let current = labelNode as HTMLElement | null;
      while (current && current !== document.body) {
        if (current.matches(rowSelectors) && isVisible(current))
          candidates.push(current);
        current = current.parentElement;
      }
    }
    const uniqueCandidates = Array.from(new Set(candidates));
    const sortedCandidates = uniqueCandidates.sort((a, b) => {
      const aControls = Array.from(a.querySelectorAll(controlSelector)).filter((node: any) => isVisible(node)).length;
      const bControls = Array.from(b.querySelectorAll(controlSelector)).filter((node: any) => isVisible(node)).length;
      if (aControls !== bControls)
        return bControls - aControls;
      return normalize(a.innerText || a.textContent || '').length - normalize(b.innerText || b.textContent || '').length;
    });
    for (const row of sortedCandidates) {
      const rowText = normalize((row as HTMLElement).innerText || (row as HTMLElement).textContent || '');
      if (!rowText.includes(normalizedLabel))
        continue;
      const controlCandidates = Array.from((row as HTMLElement).querySelectorAll(controlSelector))
        .filter((node: any) => isVisible(node));
      const controlText = controlCandidates
        .map((node: any) => normalize(node.value ?? node.innerText ?? node.textContent ?? node.getAttribute?.('placeholder') ?? ''))
        .find((value: string) => value.includes(normalizedText));
      if (controlText)
        return true;
      if (controlCandidates.length && rowText.includes(normalizedText) && !rowText.includes('\u8bf7\u9009\u62e9\u7ecf\u8425\u7c7b\u578b'))
        return true;
    }
    return false;
  }, { label, text }).catch(() => false);
}

async function fallbackUniSelectFieldOptionByLabel(tab: any, label: string, optionText: string, confirmTexts: string[] = []) {
  const opened = await tab.page.evaluate((fieldLabel: string) => {
    return (window as any).__playwrightEnhanced?.uni?.clickFieldByLabel?.(fieldLabel) || false;
  }, label).catch(() => false);
  if (!opened)
    return false;

  await tab.page.waitForTimeout(150);

  let optionClicked = false;
  for (const exact of [true, false]) {
    try {
      await tab.page.getByText(optionText, { exact }).last().click({ timeout: 3000 });
      optionClicked = true;
      break;
    } catch {
    }
  }
  if (!optionClicked)
    return false;

  const confirmCandidates = confirmTexts.length ? confirmTexts : ['\u786e\u5b9a', '\u786e\u8ba4', '\u5b8c\u6210'];
  for (const confirmText of confirmCandidates) {
    for (const exact of [true, false]) {
      try {
        await tab.page.getByText(confirmText, { exact }).last().click({ timeout: 3000 });
        await waitForTransientPickerOverlayToClose(tab);
        return await fieldRowContainsText(tab, label, optionText);
      } catch {
      }
    }
  }

  await waitForTransientPickerOverlayToClose(tab);
  return await fieldRowContainsText(tab, label, optionText);
}

const frameworkAction = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_framework_action',
    title: 'Framework-specific browser action',
    description: 'Execute a high-level action for Uni-app or Element Plus components when standard browser tools are unreliable',
    inputSchema: z.object({
      action: z.enum([
        'uni_fill',
        'uni_fill_by_label',
        'uni_click',
        'uni_click_field_by_label',
        'uni_textarea',
        'uni_picker',
        'uni_select_field_option_by_label',
        'el_select',
        'el_tree_select',
        'el_date_picker',
      ]).describe('High-level framework action to execute'),
      index: z.number().optional().describe('Index for component-based operations such as uni_fill or el_select'),
      label: z.string().optional().describe('Visible field label for label-based operations'),
      text: z.string().optional().describe('Text value for click, tree node selection, or textarea fill'),
      value: z.string().optional().describe('Value for input fill or date picker'),
      optionText: z.string().optional().describe('Option text for picker/select operations'),
      optionIndex: z.number().optional().describe('Option index for picker or select operations'),
      confirmTexts: z.array(z.string()).optional().describe('Candidate confirm button texts for picker dialogs'),
      selector: z.string().optional().describe('Optional selector for Element Plus component targeting'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    const selectText = typeof params.optionText === 'string' ? params.optionText : params.text;
    const treeSelectText = typeof params.optionText === 'string' ? params.optionText : params.text;
    const requiredEnhancedMethodByAction: Record<string, string | undefined> = {
      uni_fill_by_label: 'fillInputByLabel',
      uni_click_field_by_label: 'clickFieldByLabel',
      uni_select_field_option_by_label: 'selectFieldOptionByLabel',
    };
    const codeByAction: Record<string, string> = {
      uni_fill: `await page.smart.uniFill(${params.index ?? 0}, ${JSON.stringify(params.value ?? '')});`,
      uni_fill_by_label: `await page.evaluate(({ label, value }) => window.__playwrightEnhanced?.uni?.fillInputByLabel(label, value) || false, { label: ${JSON.stringify(params.label ?? '')}, value: ${JSON.stringify(params.value ?? '')} });`,
      uni_click: typeof params.index === 'number'
        ? `await page.smart.uniClick(${params.index});`
        : `await page.smart.uniClick(${JSON.stringify(params.text ?? '')});`,
      uni_click_field_by_label: `await page.evaluate((label) => window.__playwrightEnhanced?.uni?.clickFieldByLabel(label) || false, ${JSON.stringify(params.label ?? '')});`,
      uni_textarea: `await page.smart.uniTextarea(${JSON.stringify(params.value ?? params.text ?? '')});`,
      uni_picker: `await page.smart.uniPicker(${params.index ?? 0}, ${params.optionIndex ?? 0});`,
      uni_select_field_option_by_label: `await page.evaluate(({ label, optionText, confirmTexts }) => window.__playwrightEnhanced?.uni?.selectFieldOptionByLabel(label, optionText, { confirmTexts }) || false, { label: ${JSON.stringify(params.label ?? '')}, optionText: ${JSON.stringify(params.optionText ?? '')}, confirmTexts: ${JSON.stringify(params.confirmTexts ?? [])} });`,
      el_select: `await page.smart.elSelect(${typeof params.selector === 'string' ? JSON.stringify(params.selector) : params.index ?? 0}, ${typeof selectText === 'string' ? JSON.stringify(selectText) : params.optionIndex ?? 0});`,
      el_tree_select: `await page.smart.elTreeSelect(${typeof params.selector === 'string' ? JSON.stringify(params.selector) : params.index ?? 0}, ${typeof treeSelectText === 'string' ? JSON.stringify(treeSelectText) : 'undefined'});`,
      el_date_picker: `await page.smart.elDatePicker(${typeof params.selector === 'string' ? JSON.stringify(params.selector) : params.index ?? 0}, ${typeof params.value === 'string' ? JSON.stringify(params.value) : 'undefined'});`,
    };

    const validators: Record<string, () => void> = {
      uni_fill: () => {
        if (typeof params.index !== 'number')
          throw new Error('index is required for uni_fill');
        if (typeof params.value !== 'string')
          throw new Error('value is required for uni_fill');
      },
      uni_fill_by_label: () => {
        if (typeof params.label !== 'string')
          throw new Error('label is required for uni_fill_by_label');
        if (typeof params.value !== 'string')
          throw new Error('value is required for uni_fill_by_label');
      },
      uni_click: () => {
        if (typeof params.index !== 'number' && typeof params.text !== 'string')
          throw new Error('Either index or text is required for uni_click');
      },
      uni_click_field_by_label: () => {
        if (typeof params.label !== 'string')
          throw new Error('label is required for uni_click_field_by_label');
      },
      uni_textarea: () => {
        if (typeof params.value !== 'string' && typeof params.text !== 'string')
          throw new Error('value or text is required for uni_textarea');
      },
      uni_picker: () => {
        if (typeof params.index !== 'number' || typeof params.optionIndex !== 'number')
          throw new Error('index and optionIndex are required for uni_picker');
      },
      uni_select_field_option_by_label: () => {
        if (typeof params.label !== 'string')
          throw new Error('label is required for uni_select_field_option_by_label');
        if (typeof params.optionText !== 'string')
          throw new Error('optionText is required for uni_select_field_option_by_label');
      },
      el_select: () => {
        if (typeof params.selector !== 'string' && typeof params.index !== 'number')
          throw new Error('selector or index is required for el_select');
        if (typeof selectText !== 'string' && typeof params.optionIndex !== 'number')
          throw new Error('text/optionText or optionIndex is required for el_select');
      },
      el_tree_select: () => {
        if (typeof params.selector !== 'string' && typeof params.index !== 'number')
          throw new Error('selector or index is required for el_tree_select');
      },
      el_date_picker: () => {
        if (typeof params.selector !== 'string' && typeof params.index !== 'number')
          throw new Error('selector or index is required for el_date_picker');
      },
    };

    validators[params.action]?.();
    response.addCode(codeByAction[params.action]);

    const result = await tab.waitForCompletion(async () => {
      const smart = (tab.page as any).smart;
      if (!smart && !String(params.action).includes('by_label'))
        throw createEnhancedRuntimeError(tab, 'page.smart is not available');
      const requiredEnhancedMethod = requiredEnhancedMethodByAction[params.action];
      if (requiredEnhancedMethod) {
        const available = await tab.page.evaluate((methodName: string) => {
          return typeof (window as any).__playwrightEnhanced?.uni?.[methodName] === 'function';
        }, requiredEnhancedMethod);
        if (!available)
          throw createEnhancedRuntimeError(tab, `window.__playwrightEnhanced.uni.${requiredEnhancedMethod} is not available`);
      }
      switch (params.action) {
        case 'uni_fill':
          return await smart.uniFill(params.index, params.value);
        case 'uni_fill_by_label':
          return await tab.page.evaluate((payload: any) => {
            return (window as any).__playwrightEnhanced?.uni?.fillInputByLabel(payload.label, payload.value) || false;
          }, { label: params.label, value: params.value });
        case 'uni_click':
          return await smart.uniClick(typeof params.index === 'number' ? params.index : params.text);
        case 'uni_click_field_by_label':
          return await tab.page.evaluate((label: any) => {
            return (window as any).__playwrightEnhanced?.uni?.clickFieldByLabel(label) || false;
          }, params.label);
        case 'uni_textarea':
          return await smart.uniTextarea(params.value ?? params.text);
        case 'uni_picker':
          return await smart.uniPicker(params.index, params.optionIndex);
        case 'uni_select_field_option_by_label':
          return await tab.page.evaluate((payload: any) => {
            return (window as any).__playwrightEnhanced?.uni?.selectFieldOptionByLabel(payload.label, payload.optionText, { confirmTexts: payload.confirmTexts }) || false;
          }, { label: params.label, optionText: params.optionText, confirmTexts: params.confirmTexts });
        case 'el_select':
          return await smart.elSelect(params.selector ?? params.index, selectText ?? params.optionIndex);
        case 'el_tree_select':
          return await smart.elTreeSelect(params.selector ?? params.index, treeSelectText);
        case 'el_date_picker':
          return await smart.elDatePicker(params.selector ?? params.index, params.value);
        default:
          throw new Error(`Unsupported framework action: ${params.action}`);
      }
    });

    if (result === false) {
      switch (params.action) {
        case 'uni_fill_by_label':
          throw new Error(`uni_fill_by_label failed: label=${String(params.label ?? '')}, value=${String(params.value ?? '')}`);
        case 'uni_click_field_by_label':
          throw new Error(`uni_click_field_by_label failed: label=${String(params.label ?? '')}`);
        case 'uni_select_field_option_by_label':
          throw new Error(`uni_select_field_option_by_label failed: label=${String(params.label ?? '')}, optionText=${String(params.optionText ?? '')}, confirmTexts=${JSON.stringify(params.confirmTexts ?? [])}`);
      }
    }

    if (params.action === 'uni_select_field_option_by_label') {
      await waitForTransientPickerOverlayToClose(tab);
      const selected = await fieldRowContainsText(tab, String(params.label ?? ''), String(params.optionText ?? ''));
      if (!selected) {
        const recovered = await fallbackUniSelectFieldOptionByLabel(tab, String(params.label ?? ''), String(params.optionText ?? ''), params.confirmTexts ?? []);
        if (!recovered)
          throw new Error(`uni_select_field_option_by_label failed: label=${String(params.label ?? '')}, optionText=${String(params.optionText ?? '')}, confirmTexts=${JSON.stringify(params.confirmTexts ?? [])}`);
      }
    }

    response.addResult(JSON.stringify(result, null, 2) || 'ok');
  },
});

export default [frameworkAction];
