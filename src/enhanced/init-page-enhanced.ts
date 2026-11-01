export default async ({ page }: { page: any }) => {
  await page.addInitScript(() => {
    const normalizeText = (value: any) => String(value || '').replace(/\s+/g, ' ').trim();
    const getText = (node: Element | null | undefined) => normalizeText((node as HTMLElement | null)?.innerText || node?.textContent || '');
    const textHasSemanticContent = (value: string) => /[\p{Letter}\p{Number}\u4e00-\u9fff]/u.test(value);
    const isVisibleElement = (node: Element | null | undefined) => {
      if (!(node instanceof HTMLElement))
        return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0)
        return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const controlSelector = 'input, textarea, select, input[type="checkbox"], input[type="radio"], [role="textbox"], [role="spinbutton"], [role="combobox"], [role="checkbox"], [role="radio"], [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], uni-picker, .picker-row, .agreement-section, .uv-checkbox, .uv-checkbox__icon, [role="button"], [role="link"], [aria-haspopup="listbox"], [aria-haspopup="dialog"], [aria-checked], button, a, [data-testid="agreement-section"], [data-testid="agreement-checkbox"]';
    const clickableSelector = 'button, [role="button"], [role="link"], [role="checkbox"], [role="radio"], a, uni-button, .picker-row, .agreement-section, .uv-checkbox, .uv-checkbox__icon, [aria-haspopup], [aria-checked], [data-testid], [tabindex]';
    const rowSelector = '.field, .el-field, .agreement-section, [data-field], [data-testid], uni-forms-item, uni-view, li, tr, div';
    const isEditableControl = (node: Element | null | undefined) => {
      if (!(node instanceof HTMLElement))
        return false;
      const role = (node.getAttribute('role') || '').toLowerCase();
      const tag = node.tagName.toLowerCase();
      return tag === 'input'
        || tag === 'textarea'
        || tag === 'select'
        || role === 'textbox'
        || role === 'spinbutton'
        || role === 'combobox'
        || node.getAttribute('contenteditable') === 'true'
        || node.getAttribute('contenteditable') === ''
        || node.getAttribute('contenteditable') === 'plaintext-only';
    };
    const isToggleControl = (node: Element | null | undefined) => {
      if (!(node instanceof HTMLElement))
        return false;
      const role = (node.getAttribute('role') || '').toLowerCase();
      const type = (node.getAttribute('type') || '').toLowerCase();
      return type === 'checkbox'
        || type === 'radio'
        || role === 'checkbox'
        || role === 'radio'
        || node.hasAttribute('aria-checked')
        || node.matches('.uv-checkbox, .uv-checkbox__icon, [data-testid="agreement-section"], [data-testid="agreement-checkbox"]');
    };
    const isTriggerControl = (node: Element | null | undefined) => {
      if (!(node instanceof HTMLElement))
        return false;
      const role = (node.getAttribute('role') || '').toLowerCase();
      const tag = node.tagName.toLowerCase();
      const style = window.getComputedStyle(node);
      return tag === 'button'
        || tag === 'a'
        || tag === 'select'
        || tag === 'uni-picker'
        || isToggleControl(node)
        || role === 'button'
        || role === 'combobox'
        || role === 'link'
        || node.classList.contains('picker-row')
        || node.classList.contains('agreement-section')
        || node.hasAttribute('aria-haspopup')
        || style.cursor === 'pointer';
    };
    const isClickableElement = (node: Element | null | undefined) => {
      if (!(node instanceof HTMLElement))
        return false;
      if (isTriggerControl(node))
        return true;
      const style = window.getComputedStyle(node);
      return node.matches(clickableSelector)
        || style.cursor === 'pointer'
        || typeof (node as any).onclick === 'function';
    };
    const clickElement = (node: HTMLElement | null | undefined) => {
      if (!(node instanceof HTMLElement))
        return false;
      const target = (node.matches(clickableSelector) ? node : node.closest(clickableSelector)) as HTMLElement | null;
      const element = target || node;
      try {
        element.focus?.();
      } catch {
      }
      try {
        element.click();
        return true;
      } catch {
      }
      try {
        element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      } catch {
      }
      return false;
    };
    const isCheckedLike = (node: Element | null | undefined) => {
      if (!(node instanceof HTMLElement))
        return false;
      const ariaChecked = node.getAttribute('aria-checked');
      if (ariaChecked === 'true')
        return true;
      if (ariaChecked === 'false')
        return false;
      const input = node.matches('input[type="checkbox"], input[type="radio"]')
        ? node as HTMLInputElement
        : node.querySelector('input[type="checkbox"], input[type="radio"]') as HTMLInputElement | null;
      if (input)
        return Boolean(input.checked);
      return node.matches('.is-checked, .checked, .uv-checkbox--checked, .uv-radio--checked, .uv-switch--on')
        || Boolean(node.querySelector('.is-checked, .checked, .uv-checkbox--checked, .uv-radio--checked, .uv-switch--on'));
    };
    const setAttributeIfChanged = (node: HTMLElement | null | undefined, name: string, value: string) => {
      if (!(node instanceof HTMLElement))
        return;
      if (node.getAttribute(name) === value)
        return;
      node.setAttribute(name, value);
    };
    const getOrderedControls = (root: ParentNode | null | undefined, predicate?: (node: HTMLElement) => boolean) => {
      if (!root)
        return [] as HTMLElement[];
      const elements = Array.from(root.querySelectorAll(controlSelector)) as HTMLElement[];
      const deduped = Array.from(new Set(elements.filter(node => isVisibleElement(node) && (!predicate || predicate(node)))));
      return deduped.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        if (Math.abs(ar.top - br.top) > 6)
          return ar.top - br.top;
        if (Math.abs(ar.left - br.left) > 6)
          return ar.left - br.left;
        return (a.tabIndex || 0) - (b.tabIndex || 0);
      });
    };
    const pickControlForLabel = (row: HTMLElement | null, label: string, mode: 'fill' | 'click' | 'select') => {
      if (!row)
        return null;
      const normalizedLabel = normalizeText(label);
      const wantsPhone = /\u624b\u673a\u53f7|\u7535\u8bdd|\u624b\u673a/.test(normalizedLabel);
      const wantsPicker = /\u7c7b\u578b|\u7ecf\u8425|\u5730\u533a|\u533a\u57df|\u90e8\u95e8|\u65e5\u671f|\u65f6\u95f4|\u9009\u62e9/.test(normalizedLabel) || mode === 'select';
      const controls = getOrderedControls(row, node => {
        if (mode === 'fill')
          return isEditableControl(node);
        if (mode === 'select')
          return isTriggerControl(node) || isEditableControl(node);
        return isTriggerControl(node) || isEditableControl(node);
      });
      if (!controls.length)
        return null;
      const scored = controls.map((node, index) => {
        const type = (node.getAttribute('type') || '').toLowerCase();
        const role = (node.getAttribute('role') || '').toLowerCase();
        const placeholder = normalizeText(node.getAttribute('placeholder') || node.getAttribute('aria-label') || '');
        let score = index * 10;
        if (mode === 'fill' && isEditableControl(node)) score -= 40;
        if (mode !== 'fill' && isTriggerControl(node)) score -= 40;
        if (mode === 'click' && isToggleControl(node)) score -= 50;
        if (wantsPicker && isTriggerControl(node)) score -= 50;
        if (!wantsPicker && isTriggerControl(node) && !isEditableControl(node)) score += 20;
        if (wantsPhone) {
          if (type === 'tel' || type === 'number' || role === 'spinbutton') score -= 50;
        } else if (type === 'tel' || type === 'number' || role === 'spinbutton') {
          score += 60;
        }
        if (placeholder && (placeholder.includes(normalizedLabel) || normalizedLabel.includes(placeholder)))
          score -= 20;
        if (node.matches('[readonly], [disabled], [aria-disabled="true"]'))
          score += 30;
        return { node, score };
      }).sort((a, b) => a.score - b.score);
      return scored[0]?.node || null;
    };
    const findRowByLabel = (label: string) => {
      const normalized = normalizeText(label);
      if (!normalized)
        return null;
      const labelNodes = Array.from(document.querySelectorAll('label, .label, span, div, text, uni-text')) as HTMLElement[];
      const exactMatches = labelNodes.filter(node => {
        const text = getText(node).replace(/\*/g, '');
        return text === normalized;
      });
      const candidates: Array<{ row: HTMLElement; score: number }> = [];
      const pushCandidate = (row: HTMLElement | null, score: number) => {
        if (!row || !isVisibleElement(row))
          return;
        if (!getOrderedControls(row).length)
          return;
        candidates.push({ row, score });
      };
      for (const labelNode of exactMatches) {
        let current: HTMLElement | null = labelNode;
        let depth = 0;
        while (current && current !== document.body) {
          if (current.matches(rowSelector)) {
            const text = getText(current);
            pushCandidate(current, depth * 10 + text.length + getOrderedControls(current).length * 100);
          }
          current = current.parentElement;
          depth += 1;
        }
      }
      if (!candidates.length) {
        const broadCandidates = Array.from(document.querySelectorAll(rowSelector)) as HTMLElement[];
        for (const row of broadCandidates) {
          const text = getText(row).replace(/\*/g, '');
          if (!text.includes(normalized))
            continue;
          const controls = getOrderedControls(row);
          if (!controls.length)
            continue;
          pushCandidate(row, controls.length * 100 + text.length);
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      return candidates[0]?.row || null;
    };
    const applyValueToControl = (input: HTMLElement | null, value: string) => {
      if (!input)
        return false;
      if ('value' in input) {
        (input as HTMLInputElement | HTMLTextAreaElement).value = value;
      } else {
        input.textContent = value;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const hideDecorativeDescendants = (root: HTMLElement | null | undefined) => {
      if (!(root instanceof HTMLElement))
        return;
      for (const node of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
        const text = getText(node);
        if (!text || text.length > 2)
          continue;
        if (textHasSemanticContent(text))
          continue;
        if (node.matches('a, button, input, textarea, select, [role], [data-testid="agreement-checkbox"]'))
          continue;
        setAttributeIfChanged(node, 'aria-hidden', 'true');
      }
    };
    const syncPickerSemantics = () => {
      const pickerRows = Array.from(document.querySelectorAll('.picker-row')) as HTMLElement[];
      for (const row of pickerRows) {
        if (!isVisibleElement(row))
          continue;
        const field = row.closest('.field') as HTMLElement | null;
        const label = normalizeText(getText(field?.querySelector('.label') || null).replace(/\*/g, ''));
        setAttributeIfChanged(row, 'role', 'button');
        setAttributeIfChanged(row, 'aria-haspopup', row.getAttribute('aria-haspopup') || 'dialog');
        if (label)
          setAttributeIfChanged(row, 'aria-label', label);
        if (!row.hasAttribute('tabindex'))
          setAttributeIfChanged(row, 'tabindex', '0');
        hideDecorativeDescendants(row);
      }
    };
    const syncAgreementSemantics = () => {
      const sections = Array.from(document.querySelectorAll('[data-testid="agreement-section"], .agreement-section')) as HTMLElement[];
      for (const section of sections) {
        if (!isVisibleElement(section))
          continue;
        const label = normalizeText(getText(section).replace(/\*/g, '')) || '\u9605\u8bfb\u5e76\u540c\u610f\u7528\u6237\u670d\u52a1\u534f\u8bae\u53ca\u9690\u79c1\u653f\u7b56';
        const checked = isCheckedLike(section);
        setAttributeIfChanged(section, 'role', 'checkbox');
        setAttributeIfChanged(section, 'aria-checked', checked ? 'true' : 'false');
        setAttributeIfChanged(section, 'aria-label', label);
        if (!section.hasAttribute('tabindex'))
          setAttributeIfChanged(section, 'tabindex', '0');

        const checkboxLikeNodes = Array.from(section.querySelectorAll('[data-testid="agreement-checkbox"], .uv-checkbox, .uv-checkbox__icon')) as HTMLElement[];
        for (const node of checkboxLikeNodes) {
          setAttributeIfChanged(node, 'role', 'checkbox');
          setAttributeIfChanged(node, 'aria-checked', checked ? 'true' : 'false');
          setAttributeIfChanged(node, 'aria-label', label);
          if (!node.hasAttribute('tabindex'))
            setAttributeIfChanged(node, 'tabindex', '0');
          if (node !== section && node.dataset.playwrightEnhancedProxy !== '1') {
            node.dataset.playwrightEnhancedProxy = '1';
            node.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              clickElement(section);
              queueMicrotask(syncSemantics);
            });
          }
        }
        hideDecorativeDescendants(section);
      }
    };
    const syncSemantics = () => {
      syncPickerSemantics();
      syncAgreementSemantics();
    };
    let semanticSyncQueued = false;
    let semanticSyncTimer: number | undefined;
    const scheduleSemanticSync = () => {
      if (!semanticSyncQueued) {
        semanticSyncQueued = true;
        queueMicrotask(() => {
          semanticSyncQueued = false;
          syncSemantics();
        });
      }
      if (semanticSyncTimer !== undefined)
        window.clearTimeout(semanticSyncTimer);
      semanticSyncTimer = window.setTimeout(() => {
        semanticSyncTimer = undefined;
        syncSemantics();
      }, 120);
    };
    const findClickableByText = (text: string, root: ParentNode | null | undefined = document) => {
      const normalized = normalizeText(text);
      if (!normalized || !root)
        return null;
      const elements = Array.from(root.querySelectorAll('*')) as HTMLElement[];
      const seen = new Set<HTMLElement>();
      const candidates: Array<{ node: HTMLElement; score: number }> = [];
      for (const node of elements) {
        if (!isVisibleElement(node))
          continue;
        const nodeText = normalizeText(getText(node).replace(/\*/g, ''));
        if (!nodeText)
          continue;
        const exact = nodeText === normalized;
        const partial = nodeText.includes(normalized) || normalized.includes(nodeText);
        if (!exact && !partial)
          continue;
        const target = (isClickableElement(node) ? node : node.closest(clickableSelector)) as HTMLElement | null;
        if (!target || !isVisibleElement(target) || seen.has(target))
          continue;
        seen.add(target);
        let score = exact ? 0 : 50 + Math.abs(nodeText.length - normalized.length);
        if (target.matches('[data-testid]')) score -= 10;
        if (isToggleControl(target)) score -= 20;
        if (isTriggerControl(target)) score -= 10;
        if (target.matches('[data-testid="agreement-section"], .agreement-section')) score -= 20;
        candidates.push({ node: target, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      return candidates[0]?.node || null;
    };
    const getVisibleFillableControls = () => getOrderedControls(document, node => {
      if (!isEditableControl(node))
        return false;
      if (node.matches('[readonly], [disabled], [aria-disabled="true"]'))
        return false;
      return true;
    });
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const findVisibleDialog = () => {
      const candidates = Array.from(document.querySelectorAll('.picker-dialog.open, .uv-popup, .uv-picker, .u-picker, [role="dialog"], [aria-modal="true"]')) as HTMLElement[];
      return candidates.find(node => isVisibleElement(node)) || null;
    };

    syncSemantics();
    scheduleSemanticSync();
    const observer = new MutationObserver(() => scheduleSemanticSync());
    const observeRoot = document.documentElement || document.body;
    if (observeRoot) {
      observer.observe(observeRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }
    const periodicSyncDeadline = Date.now() + 10000;
    const periodicSync = window.setInterval(() => {
      syncSemantics();
      if (Date.now() >= periodicSyncDeadline)
        window.clearInterval(periodicSync);
    }, 500);
    window.addEventListener('beforeunload', () => {
      if (semanticSyncTimer !== undefined)
        window.clearTimeout(semanticSyncTimer);
      window.clearInterval(periodicSync);
    }, { once: true });
    document.addEventListener('click', () => scheduleSemanticSync(), true);
    window.addEventListener('load', () => scheduleSemanticSync(), { once: true });
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', () => scheduleSemanticSync(), { once: true });

    (window as any).__playwrightEnhanced = {
      version: '1.1.0',
      syncSemantics,
      uni: {
        findRowByLabel,
        getInputs: () => Array.from(document.querySelectorAll('input.uni-input-input')),
        getButtons: () => Array.from(document.querySelectorAll('uni-button')),
        clickByText: (text: string) => {
          const target = findClickableByText(text);
          if (!target)
            return false;
          const clicked = clickElement(target);
          queueMicrotask(syncSemantics);
          return clicked;
        },
        clickButton: (text: string) => {
          return (window as any).__playwrightEnhanced?.uni?.clickByText?.(text) || false;
        },
        fillInput: (index: number, value: string) => {
          const inputs = getVisibleFillableControls();
          return applyValueToControl(inputs[index] || null, value);
        },
        fillInputByLabel: (label: string, value: string) => {
          const row = findRowByLabel(label) as HTMLElement | null;
          const input = pickControlForLabel(row, label, 'fill');
          return applyValueToControl(input, value);
        },
        clickFieldByLabel: (label: string) => {
          const row = findRowByLabel(label) as HTMLElement | null;
          if (!row)
            return false;
          const target = pickControlForLabel(row, label, 'click') || row;
          if (!target)
            return false;
          const clicked = clickElement(target);
          queueMicrotask(syncSemantics);
          return clicked;
        },
        toggleCheckboxByLabel: (label: string, desiredChecked?: boolean) => {
          const row = findRowByLabel(label) as HTMLElement | null;
          const target = pickControlForLabel(row, label, 'click') || findClickableByText(label) || row;
          if (!target)
            return false;
          const currentChecked = isCheckedLike(target) || isCheckedLike(row);
          const nextChecked = typeof desiredChecked === 'boolean' ? desiredChecked : !currentChecked;
          if (currentChecked !== nextChecked)
            clickElement(target as HTMLElement);
          queueMicrotask(syncSemantics);
          return true;
        },
        selectPicker: (pickerIndex: number, optionIndex: number) => {
          const pickers = document.querySelectorAll('uni-picker');
          const picker = pickers[pickerIndex] as any;
          if (picker) {
            const event = new CustomEvent('change', {
              detail: { value: optionIndex },
              bubbles: true,
            });
            picker.dispatchEvent(event);
            return true;
          }
          return false;
        },
        selectFieldOptionByLabel: async (label: string, optionText: string, options?: { confirmTexts?: string[] }) => {
          const row = findRowByLabel(label) as HTMLElement | null;
          if (!row)
            return false;
          const trigger = pickControlForLabel(row, label, 'select') || row;
          if (!trigger)
            return false;
          clickElement(trigger as HTMLElement);

          let dialog = findVisibleDialog();
          for (let attempt = 0; attempt < 10 && !dialog; attempt++) {
            await delay(50);
            dialog = findVisibleDialog();
          }

          let option: HTMLElement | undefined;
          for (let attempt = 0; attempt < 10 && !option; attempt++) {
            const optionScope = dialog || document.body;
            option = findClickableByText(optionText, optionScope)
              || Array.from(optionScope.querySelectorAll('.uni-picker-item, .uv-picker__view__column__item, [role="option"], button, li')).find(el => {
                const text = normalizeText((el as HTMLElement).innerText || (el as HTMLElement).textContent || '');
                return text === optionText || text.includes(optionText);
              }) as HTMLElement | undefined;
            if (!option)
              await delay(50);
          }
          if (!option)
            return false;
          clickElement(option);

          const confirmTexts = options?.confirmTexts?.length ? options.confirmTexts : ['\u786e\u5b9a', '\u786e\u8ba4', '\u5b8c\u6210'];
          let confirm: HTMLElement | undefined;
          for (let attempt = 0; attempt < 10 && !confirm; attempt++) {
            const confirmScope = findVisibleDialog() || dialog || document.body;
            confirm = confirmTexts.map(text => findClickableByText(text, confirmScope)).find(Boolean) as HTMLElement | undefined
              || Array.from(confirmScope.querySelectorAll('button, .confirm, [class*="confirm"], [role="button"], uni-button, uni-view, uni-text')).find(el => {
                const text = normalizeText((el as HTMLElement).innerText || (el as HTMLElement).textContent || '');
                return confirmTexts.some(t => text.includes(t));
              }) as HTMLElement | undefined;
            if (!confirm)
              await delay(50);
          }
          if (confirm)
            clickElement(confirm);
          queueMicrotask(syncSemantics);
          return true;
        },
      },
      el: {
        getSelects: () => Array.from(document.querySelectorAll('.el-select')),
        getDropdownItems: () => Array.from(document.querySelectorAll('.el-select-dropdown__item')),
        getTreeNodes: () => Array.from(document.querySelectorAll('.el-tree-node__content')),
        getDatePickers: () => Array.from(document.querySelectorAll('.el-date-editor')),
      },
      diagnose: () => ({
        url: location.href,
        title: document.title,
        inputs: document.querySelectorAll('input').length,
        buttons: document.querySelectorAll('button').length,
        uniInputs: document.querySelectorAll('input.uni-input-input').length,
        uniButtons: document.querySelectorAll('uni-button').length,
        elSelects: document.querySelectorAll('.el-select').length,
        bodyPreview: document.body?.innerText?.slice(0, 300) || '',
      }),
    };
  });

  (page as any).smart = {
    openElementPlusTrigger: async (locator: any) => {
      try {
        await locator.click({ timeout: 2000 });
        return;
      } catch {
      }

      const innerTrigger = locator.locator('input, .el-select__wrapper, .el-input__wrapper, .el-input').first();
      try {
        if (await innerTrigger.count()) {
          try {
            await innerTrigger.click({ timeout: 2000 });
            return;
          } catch {
          }
          await innerTrigger.evaluate((el: any) => el.click());
          return;
        }
      } catch {
      }

      try {
        await locator.evaluate((el: any) => el.click());
        return;
      } catch {
      }

      throw new Error('Unable to open Element Plus trigger');
    },
    retry: async (fn: () => Promise<any>, options: { retries?: number; delay?: number } = {}) => {
      const { retries = 3, delay = 300 } = options;
      let lastError: any;
      for (let i = 0; i <= retries; i++) {
        try {
          return await fn();
        } catch (e) {
          lastError = e;
          if (i < retries) await page.waitForTimeout(delay * (i + 1));
        }
      }
      throw lastError;
    },

    clickWithRetry: async (selector: string, options: { retries?: number; timeout?: number } = {}) => {
      return (page as any).smart.retry(
        () => page.click(selector, { timeout: options.timeout || 3000 }),
        { retries: options.retries || 2 },
      );
    },

    fillWithRetry: async (selector: string, value: string, options: { retries?: number; timeout?: number } = {}) => {
      return (page as any).smart.retry(
        () => page.fill(selector, value, { timeout: options.timeout || 3000 }),
        { retries: options.retries || 2 },
      );
    },

    uniFill: async (index: number, value: string) => {
      const inputs = await page.locator('input.uni-input-input').all();
      if (inputs[index]) {
        await inputs[index].fill(value);
        return true;
      }
      return page.evaluate(({ idx, val }: { idx: number; val: string }) => {
        return (window as any).__playwrightEnhanced?.uni?.fillInput(idx, val) || false;
      }, { idx: index, val: value });
    },

    uniClick: async (textOrIndex: string | number) => {
      if (typeof textOrIndex === 'number') {
        await page.evaluate((idx: number) => {
          const btns = document.querySelectorAll('uni-button');
          (btns[idx] as any)?.click();
        }, textOrIndex);
      } else {
        const clicked = await page.evaluate((text: string) => {
          return (window as any).__playwrightEnhanced?.uni?.clickByText?.(text) || false;
        }, textOrIndex);
        if (!clicked)
          throw new Error(`Unable to find clickable text: ${textOrIndex}`);
      }
    },

    uniTextarea: async (value: string) => {
      await page.locator('textarea.uni-textarea-textarea').first().fill(value);
    },

    uniPicker: async (pickerIndex: number, optionIndex: number) => {
      await page.evaluate(({ pIdx, oIdx }: { pIdx: number; oIdx: number }) => {
        (window as any).__playwrightEnhanced?.uni?.selectPicker(pIdx, oIdx);
      }, { pIdx: pickerIndex, oIdx: optionIndex });
    },

    elSelect: async (selectorOrIndex: string | number, optionTextOrIndex: string | number) => {
      const selects = await page.locator('.el-select').all();
      const selectEl = typeof selectorOrIndex === 'number' ? selects[selectorOrIndex] : page.locator(selectorOrIndex);

      await (page as any).smart.openElementPlusTrigger(selectEl);
      await page.waitForSelector('.el-select-dropdown__item', { timeout: 3000 });
      await page.waitForTimeout(150);

      if (typeof optionTextOrIndex === 'number') {
        const items = await page.locator('.el-select-dropdown__item').all();
        await items[optionTextOrIndex].click();
      } else {
        await page.click(`.el-select-dropdown__item:has-text("${optionTextOrIndex}")`);
      }
    },

    elTreeSelect: async (selectorOrIndex: string | number, nodeText?: string) => {
      const selects = await page.locator('.el-select, .el-tree-select').all();
      const selectEl = typeof selectorOrIndex === 'number' ? selects[selectorOrIndex] : page.locator(selectorOrIndex);

      await (page as any).smart.openElementPlusTrigger(selectEl);
      await page.waitForSelector('.el-tree-node__content', { timeout: 3000 });
      await page.waitForTimeout(150);

      if (nodeText) await page.click(`.el-tree-node__content:has-text("${nodeText}")`);
      else await page.locator('.el-tree-node__content').first().click();
    },

    elDatePicker: async (selectorOrIndex: string | number, date?: string) => {
      const pickers = await page.locator('.el-date-editor').all();
      const picker = typeof selectorOrIndex === 'number' ? pickers[selectorOrIndex] : page.locator(selectorOrIndex);

      const input = picker.locator('input').first();
      await input.click();
      await page.waitForTimeout(200);

      if (date) {
        await input.fill(date);
        await page.keyboard.press('Enter');
      } else {
        const todayBtn = page.locator('button:has-text("\u4eca\u5929"), .is-today');
        const count = await todayBtn.count();
        if (count > 0) await todayBtn.first().click();
        else await page.keyboard.press('Escape');
      }
    },

    diagnose: async () => {
      return page.evaluate(() => {
        return (window as any).__playwrightEnhanced?.diagnose?.() || {
          url: location.href,
          title: document.title,
        };
      });
    },

    screenshot: async (name?: string) => {
      const p = `/tmp/${name || 'screenshot'}-${Date.now()}.png`;
      await page.screenshot({ path: p, fullPage: true });
      return p;
    },

    waitForAny: async (
      conditions: { url?: string; notUrl?: string; selector?: string; text?: string },
      timeout = 10000,
    ) => {
      try {
        await page.waitForFunction((payload: any) => {
          const href = window.location.href;
          const urlMatched = payload.url
            ? href.includes(payload.url) && (!payload.notUrl || !href.includes(payload.notUrl))
            : false;
          const selectorMatched = payload.selector
            ? Boolean(document.querySelector(payload.selector))
            : false;
          const bodyText = document.body?.innerText ?? '';
          const textMatched = payload.text
            ? bodyText.includes(payload.text)
            : false;
          return urlMatched || selectorMatched || textMatched;
        }, {
          url: conditions.url,
          notUrl: conditions.notUrl,
          selector: conditions.selector,
          text: conditions.text,
        }, { timeout });

        if (conditions.url) {
          const currentUrl = page.url();
          if (currentUrl.includes(conditions.url)) {
            if (!conditions.notUrl || !currentUrl.includes(conditions.notUrl))
              return { matched: 'url', value: currentUrl };
          }
        }

        if (conditions.selector) {
          const count = await page.locator(conditions.selector).count().catch(() => 0);
          if (count > 0)
            return { matched: 'selector', value: conditions.selector };
        }

        if (conditions.text) {
          const hasText = await page.getByText(conditions.text).count().catch(() => 0);
          if (hasText > 0)
            return { matched: 'text', value: conditions.text };
        }

        return { matched: null, timeout: true, error: 'Condition matched during wait, but final state could not be resolved.' };
      } catch (error: any) {
        const message = error?.message || String(error);
        if (message.includes('Timeout') || message.includes('timeout'))
          return { matched: null, timeout: true, error: message };
        throw error;
      }
    },

    waitForAPI: (urlPattern: string, options: { timeout?: number; method?: string } = {}) => {
      const { timeout = 15000, method } = options;

      return new Promise<{ success: boolean; status?: number; body?: any; url?: string; method?: string | null; timeout?: boolean; urlPattern?: string }>((resolve) => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
          page.off('response', handler);
          if (timeoutId)
            clearTimeout(timeoutId);
        };
        const handler = async (resp: any) => {
          if (!resp.url().includes(urlPattern)) return;
          if (method && resp.request().method() !== method) return;

          let body: any = null;
          try {
            body = await resp.json();
          } catch {
            try {
              body = await resp.text();
            } catch {
            }
          }

          cleanup();
          resolve({ success: true, status: resp.status(), body, url: resp.url(), method: resp.request().method() });
        };

        page.on('response', handler);
        timeoutId = setTimeout(() => {
          cleanup();
          resolve({ success: false, timeout: true, urlPattern, method: method ?? null });
        }, timeout);
      });
    },

    jsClick: async (selector: string) => {
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as any;
        if (el) el.click();
        else throw new Error(`Element not found: ${sel}`);
      }, selector);
    },

    jsFill: async (selector: string, value: string) => {
      await page.evaluate(({ sel, val }: { sel: string; val: string }) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          throw new Error(`Element not found: ${sel}`);
        }
      }, { sel: selector, val: value });
    },
  };
};
