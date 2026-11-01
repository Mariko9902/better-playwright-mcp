import { z } from 'zod';
import { defineTabTool } from './tool.js';

const consoleTool = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_console_messages',
    title: 'Get console messages',
    description: 'Returns all console messages',
    inputSchema: z.object({}),
    type: 'readOnly',
  },
  handle: async (tab: any, _params: any, response: any) => {
    tab.consoleMessages().map((message: any) => response.addResult(message.toString()));
  },
});

export default [consoleTool];
