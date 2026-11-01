import { renderModalStates } from './tab.js';

export class Response {
  _result: string[] = [];
  _code: string[] = [];
  _images: any[] = [];
  _context: any;
  _includeSnapshot = false;
  _includeTabs = false;
  _tabSnapshot: any;
  toolName: string;
  toolArgs: any;
  _isError: boolean | undefined;

  constructor(context: any, toolName: string, toolArgs: any) {
    this._context = context;
    this.toolName = toolName;
    this.toolArgs = toolArgs;
  }

  addResult(result: string) {
    this._result.push(result);
  }

  addError(error: string) {
    this._result.push(trimError(error));
    this._isError = true;
  }

  isError() {
    return this._isError;
  }

  result() {
    return this._result.join('\n');
  }

  addCode(code: string) {
    this._code.push(code);
  }

  code() {
    return this._code.join('\n');
  }

  addImage(image: any) {
    this._images.push(image);
  }

  images() {
    return this._images;
  }

  setIncludeSnapshot() {
    this._includeSnapshot = true;
  }

  setIncludeTabs() {
    this._includeTabs = true;
  }

  async finish() {
    if (this._includeSnapshot && this._context.currentTab())
      this._tabSnapshot = await this._context.currentTabOrDie().captureSnapshot();
    if (this._includeTabs) {
      for (const tab of this._context.tabs())
        await tab.updateTitle();
    }
  }

  tabSnapshot() {
    return this._tabSnapshot;
  }

  serialize() {
    const response: string[] = [];
    if (this._result.length) {
      response.push('### Result');
      response.push(this._result.join('\n'));
      response.push('');
    }
    if (this._code.length) {
      response.push(`### Ran Playwright code\n\
\`\`\`js\n${this._code.join('\n')}\n\`\`\``);
      response.push('');
    }
    if (this._includeSnapshot || this._includeTabs)
      response.push(...renderTabsMarkdown(this._context.tabs(), this._includeTabs));
    if (this._tabSnapshot?.modalStates.length) {
      response.push(...renderModalStates(this._context, this._tabSnapshot.modalStates));
      response.push('');
    } else if (this._tabSnapshot) {
      response.push(renderTabSnapshot(this._tabSnapshot));
      response.push('');
    }
    const content: any[] = [
      { type: 'text', text: response.join('\n') },
    ];
    if (this._context.config.imageResponses !== 'omit') {
      for (const image of this._images)
        content.push({ type: 'image', data: image.data.toString('base64'), mimeType: image.contentType });
    }
    return { content, isError: this._isError };
  }
}

function renderTabSnapshot(tabSnapshot: any) {
  const lines: string[] = [];
  if (tabSnapshot.consoleMessages.length) {
    lines.push('### New console messages');
    for (const message of tabSnapshot.consoleMessages) {
      const str = message.toString();
      const level = typeof message.type === 'function' ? (message.type() || 'log') : (message.type || 'log');
      const isImportant = ['error', 'warning', 'assert'].includes(level);
      const limit = isImportant ? 800 : 300;
      lines.push(`- [${level}] ${trim(str, limit)}`);
    }
    lines.push('');
  }
  if (tabSnapshot.downloads.length) {
    lines.push('### Downloads');
    for (const entry of tabSnapshot.downloads) {
      if (entry.finished)
        lines.push(`- Downloaded file ${entry.download.suggestedFilename()} to ${entry.outputFile}`);
      else
        lines.push(`- Downloading file ${entry.download.suggestedFilename()} ...`);
    }
    lines.push('');
  }
  lines.push('### Page state');
  lines.push(`- Page URL: ${tabSnapshot.url}`);
  lines.push(`- Page Title: ${tabSnapshot.title}`);
  lines.push('- Page Snapshot:');
  lines.push('```yaml');
  lines.push(tabSnapshot.ariaSnapshot);
  lines.push('```');
  return lines.join('\n');
}

function renderTabsMarkdown(tabs: any[], force = false) {
  if (tabs.length === 1 && !force)
    return [];
  if (!tabs.length) {
    return [
      '### Open tabs',
      'No open tabs. Use the "browser_navigate" tool to navigate to a page first.',
      '',
    ];
  }
  const lines = ['### Open tabs'];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const current = tab.isCurrentTab() ? ' (current)' : '';
    lines.push(`- ${i}:${current} [${tab.lastTitle()}] (${tab.page.url()})`);
  }
  lines.push('');
  return lines;
}

function trim(text: string, maxLength: number) {
  if (text.length <= maxLength)
    return text;
  return text.slice(0, maxLength) + '...';
}
function trimError(text: string): string {
  const MAX_LENGTH = 2000;
  const MIN_SENTENCES = 3;

  if (text.length <= MAX_LENGTH) {
    return text;
  }

                    
  const sentences = text
      .split('. ')
      .map(s => s.trim())
      .filter(Boolean);

                       
  if (sentences.length < MIN_SENTENCES) {
    return text.slice(0, MAX_LENGTH - 3) + '...';
  }

           
  let result = sentences.slice(0, 3).join('. ') + '.';

                    
  if (result.length > MAX_LENGTH) {
                          
    let prefix = sentences.slice(0, 2).join('. ') + '. ';
    let remaining = MAX_LENGTH - prefix.length - 3;            

    if (remaining < 10) {
                       
      return sentences[0].slice(0, MAX_LENGTH - 3) + '...';
    }

    let third = sentences[2];
    if (third.length > remaining) {
      third = third.slice(0, remaining) + '...';
    }

    result = prefix + third;
  }

                         
  if (result.length > MAX_LENGTH) {
    result = result.slice(0, MAX_LENGTH - 3) + '...';
  }

  return result;
}
