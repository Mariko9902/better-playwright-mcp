import { z } from 'zod';
import { defineTabTool } from './tool.js';

const requests = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_network_requests',
    title: 'List network requests',
    description: 'Returns all network requests since loading the page',
    inputSchema: z.object({}),
    type: 'readOnly',
  },
  handle: async (tab: any, _params: any, response: any) => {
    const requests = tab.requests();
    [...requests.entries()].forEach(([req, res]) => response.addResult(renderRequest(req, res)));
  },
});

const waitForResponse = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for_response',
    title: 'Wait for response',
    description: 'Wait for a network response whose URL contains a given substring',
    inputSchema: z.object({
      urlContains: z.string().describe('Substring that should appear in response URL'),
      method: z.string().optional().describe('Expected HTTP method (optional)'),
      requestJson: z.record(z.any()).optional().describe('Expected exact request JSON fields (optional)'),
      requestJsonPath: z.record(z.any()).optional().describe('Expected request JSONPath values (optional)'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
      status: z.number().optional().describe('Expected HTTP status (optional)'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const timeout = params.timeoutMs ?? 30000;
    const result = await tab.waitForCompletion(async () => {
      const entries = [...tab.requests().entries()];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const [req, res] = entries[i];
        const matched = await buildMatchedResponse(req, res, params);
        if (matched)
          return matched;
      }

      return await new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout | undefined;
        const cleanup = () => {
          tab.page.off('response', handler);
          if (timeoutId)
            clearTimeout(timeoutId);
        };
        const handler = async (res: any) => {
          try {
            const req = res.request();
            const matched = await buildMatchedResponse(req, res, params);
            if (!matched)
              return;
            cleanup();
            resolve(matched);
          } catch (error) {
            cleanup();
            reject(error);
          }
        };

        tab.page.on('response', handler);
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`timeout waiting for response: urlContains=${params.urlContains}`));
        }, timeout);
      });
    });

    response.addResult(JSON.stringify(result, null, 2));
  },
});

function renderRequest(request: any, response: any) {
  const result = [];
  result.push(`[${request.method().toUpperCase()}] ${request.url()}`);
  if (response)
    result.push(`=> [${response.status()}] ${response.statusText()}`);
  return result.join(' ');
}

async function buildMatchedResponse(req: any, res: any, params: any) {
  if (!res)
    return null;
  const url = res.url();
  if (!url.includes(params.urlContains))
    return null;
  if (params.method !== undefined && req.method().toUpperCase() !== String(params.method).toUpperCase())
    return null;
  if (params.status !== undefined && res.status() !== params.status)
    return null;

  let bodyText = '';
  let bodyJson = null;
  let requestPostData = null;
  let requestBodyJson = null;
  try {
    requestPostData = req.postData?.() ?? null;
    if (requestPostData) {
      try {
        requestBodyJson = JSON.parse(requestPostData);
      } catch {
        requestBodyJson = null;
      }
    }
  } catch {
    requestPostData = null;
    requestBodyJson = null;
  }

  if (params.requestJson && (!requestBodyJson || typeof requestBodyJson !== 'object'))
    return null;
  if (params.requestJson && requestBodyJson) {
    for (const [key, expected] of Object.entries(params.requestJson)) {
      if (String((requestBodyJson as any)?.[key]) !== String(expected))
        return null;
    }
  }
  if (params.requestJsonPath && (!requestBodyJson || typeof requestBodyJson !== 'object'))
    return null;
  if (params.requestJsonPath && requestBodyJson) {
    for (const [jp, expected] of Object.entries(params.requestJsonPath)) {
      const value = getJsonPathValue(requestBodyJson as any, String(jp));
      if (String(value) !== String(expected))
        return null;
    }
  }

  try {
    bodyText = await res.text();
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = null;
    }
  } catch {
    bodyText = '';
    bodyJson = null;
  }

  return {
    url,
    method: req.method(),
    status: res.status(),
    statusText: res.statusText(),
    requestPostData,
    requestBodyJson,
    bodyText,
    bodyJson,
  };
}

function getJsonPathValue(json: any, path: string) {
  if (!path || path === '$')
    return json;
  if (!path.startsWith('$.'))
    return undefined;
  const segments = path.slice(2).split('.').filter(Boolean);
  let current = json;
  for (const segment of segments) {
    if (current === null || current === undefined)
      return undefined;
    current = current[segment];
  }
  return current;
}

export default [requests, waitForResponse];
