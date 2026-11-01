import { z } from 'zod';
import { defineTabTool } from './tool.js';

const fetchTool = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_request_fetch',
    title: 'Request fetch',
    description: 'Perform an HTTP request using Playwright APIRequestContext via the current page',
    inputSchema: z.object({
      url: z.string().describe('Request URL'),
      method: z.string().optional().describe('HTTP method, default GET'),
      headers: z.record(z.string()).optional().describe('Headers'),
      json: z.any().optional().describe('JSON body'),
      form: z.any().optional().describe('Form body'),
      data: z.any().optional().describe('Raw data body'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const method = (params.method || 'GET').toUpperCase();
    const res = await tab.page.request.fetch(params.url, {
      method,
      headers: params.headers,
      data: params.json !== undefined ? params.json : params.data,
      form: params.form,
      timeout: params.timeoutMs,
    });

    const status = res.status();
    const headers = res.headers();

    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }

    response.addResult(JSON.stringify({
      ok: res.ok(),
      status,
      url: res.url(),
      headers,
      body: text.length > 2000 ? text.slice(0, 2000) : text,
      body_truncated: text.length > 2000,
    }, null, 2));
  },
});

export default [fetchTool];
