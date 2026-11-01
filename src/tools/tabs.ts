import { z } from 'zod';
import { defineTool } from './tool.js';

const browserTabs = defineTool({
  capability: 'core-tabs',
  schema: {
    name: 'browser_tabs',
    title: 'Manage tabs',
    description: 'List, create, close, or select a browser tab.',
    inputSchema: z.object({
      action: z.enum(['list', 'new', 'close', 'select']).describe('Operation to perform'),
      index: z.number().optional().describe('Tab index, used for close/select. If omitted for close, current tab is closed.'),
    }),
    type: 'destructive',
  },
  handle: async (context: any, params: any, response: any) => {
    switch (params.action) {
      case 'list': {
        await context.ensureTab();
        response.setIncludeTabs();
        return;
      }
      case 'new': {
        await context.newTab();
        response.setIncludeTabs();
        return;
      }
      case 'close': {
        await context.closeTab(params.index);
        response.setIncludeTabs();
        return;
      }
      case 'select': {
        if (params.index === undefined)
          throw new Error('Tab index is required');
        await context.selectTab(params.index);
        response.setIncludeTabs();
        return;
      }
    }
  },
});

export default [browserTabs];
