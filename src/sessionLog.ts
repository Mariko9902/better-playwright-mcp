import fs from 'fs';
import path from 'path';
import { logUnhandledError } from './utils/log.js';
import { outputFile } from './config.js';

export class SessionLog {
  _folder: string;
  _file: string;
  _ordinal = 0;
  _pendingEntries: any[] = [];
  _sessionFileQueue: Promise<any> = Promise.resolve();
  _flushEntriesTimeout: any;

  constructor(sessionFolder: string) {
    this._folder = sessionFolder;
    this._file = path.join(this._folder, 'session.md');
  }

  static async create(config: any, rootPath?: string) {
    const sessionFolder = await outputFile(config, rootPath, `session-${Date.now()}`);
    await fs.promises.mkdir(sessionFolder, { recursive: true });
    console.error(`Session: ${sessionFolder}`);
    return new SessionLog(sessionFolder);
  }

  logResponse(response: any) {
    const entry = {
      timestamp: performance.now(),
      toolCall: {
        toolName: response.toolName,
        toolArgs: response.toolArgs,
        result: response.result(),
        isError: response.isError(),
      },
      code: response.code(),
      tabSnapshot: response.tabSnapshot(),
    };
    this._appendEntry(entry);
  }

  logUserAction(action: any, tab: any, code: string, isUpdate: boolean) {
    code = code.trim();
    if (isUpdate) {
      const lastEntry = this._pendingEntries[this._pendingEntries.length - 1];
      if (lastEntry?.userAction?.name === action.name) {
        lastEntry.userAction = action;
        lastEntry.code = code;
        return;
      }
    }
    if (action.name === 'navigate') {
      const lastEntry = this._pendingEntries[this._pendingEntries.length - 1];
      if (lastEntry?.tabSnapshot?.url === action.url)
        return;
    }
    const entry = {
      timestamp: performance.now(),
      userAction: action,
      code,
      tabSnapshot: {
        url: tab.page.url(),
        title: '',
        ariaSnapshot: action.ariaSnapshot || '',
        modalStates: [],
        consoleMessages: [],
        downloads: [],
      },
    };
    this._appendEntry(entry);
  }

  _appendEntry(entry: any) {
    this._pendingEntries.push(entry);
    if (this._flushEntriesTimeout)
      clearTimeout(this._flushEntriesTimeout);
    this._flushEntriesTimeout = setTimeout(() => this._flushEntries(), 1000);
  }

  async flush() {
    if (this._flushEntriesTimeout) {
      clearTimeout(this._flushEntriesTimeout);
      this._flushEntriesTimeout = undefined;
    }
    if (this._pendingEntries.length)
      await this._flushEntries();
    await this._sessionFileQueue;
  }

  async _flushEntries() {
    if (this._flushEntriesTimeout) {
      clearTimeout(this._flushEntriesTimeout);
      this._flushEntriesTimeout = undefined;
    }
    const entries = this._pendingEntries;
    this._pendingEntries = [];
    if (!entries.length)
      return;
    const lines = [''];
    const snapshotWrites: Promise<any>[] = [];
    for (const entry of entries) {
      const ordinal = (++this._ordinal).toString().padStart(3, '0');
      if (entry.toolCall) {
        lines.push(`### Tool call: ${entry.toolCall.toolName}`, '- Args', '```json', JSON.stringify(entry.toolCall.toolArgs, null, 2), '```');
        if (entry.toolCall.result) {
          lines.push(entry.toolCall.isError ? '- Error' : '- Result', '```', entry.toolCall.result, '```');
        }
      }
      if (entry.userAction) {
        const actionData = { ...entry.userAction };
        delete actionData.ariaSnapshot;
        delete actionData.selector;
        delete actionData.signals;
        lines.push(`### User action: ${entry.userAction.name}`, '- Args', '```json', JSON.stringify(actionData, null, 2), '```');
      }
      if (entry.code) {
        lines.push('- Code', '```js', entry.code, '```');
      }
      if (entry.tabSnapshot) {
        const fileName = `${ordinal}.snapshot.yml`;
        snapshotWrites.push(fs.promises.writeFile(path.join(this._folder, fileName), entry.tabSnapshot.ariaSnapshot).catch(logUnhandledError));
        lines.push(`- Snapshot: ${fileName}`);
      }
      lines.push('', '');
    }
    this._sessionFileQueue = this._sessionFileQueue.then(async () => {
      await Promise.all(snapshotWrites);
      await fs.promises.appendFile(this._file, lines.join('\n'));
    });
    await this._sessionFileQueue;
  }
}
