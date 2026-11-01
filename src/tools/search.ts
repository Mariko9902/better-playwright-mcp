import { z } from 'zod';
import { SmartOutlineSimple } from '../utils/smart-outline-simple.js';
import { searchSnapshot } from '../utils/search-snapshot.js';
import { defineTabTool } from './tool.js';

const outlineGenerator = new SmartOutlineSimple();

async function currentSnapshotText(tab: any) {
  const snapshot = await tab.captureSnapshot();
  return String(snapshot?.ariaSnapshot || '');
}

const outline = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_outline',
    title: 'Page outline',
    description: 'Generate a condensed page outline from the current accessibility snapshot.',
    inputSchema: z.object({}),
    type: 'readOnly',
  },
  handle: async (tab: any, _params: any, response: any) => {
    const snapshotText = await currentSnapshotText(tab);
    response.addResult(outlineGenerator.generate(snapshotText));
  },
});

const search = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_search_snapshot',
    title: 'Search snapshot',
    description: 'Search the current accessibility snapshot using regex-compatible ripgrep semantics.',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      ignoreCase: z.boolean().optional().describe('Whether to ignore case'),
      lineLimit: z.number().int().min(1).max(100).optional().describe('Maximum number of matching lines to return'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const snapshotText = await currentSnapshotText(tab);
    const result = searchSnapshot(snapshotText, {
      pattern: params.pattern,
      ignoreCase: params.ignoreCase ?? false,
      lineLimit: params.lineLimit ?? 100,
    });
    response.addResult(JSON.stringify(result, null, 2));
  },
});

export default [outline, search];
