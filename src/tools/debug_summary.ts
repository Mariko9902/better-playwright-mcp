import { z } from 'zod';
import { defineTabTool } from './tool.js';

function renderReq(req: any, res: any) {
  const method = req.method();
  const url = req.url();
  if (!res)
    return `[${method}] ${url} => (pending)`;
  return `[${method}] ${url} => [${res.status()}] ${res.statusText()}`;
}

function parseLoopbackHost(urlOrLine: string) {
  try {
    const url = new URL(urlOrLine);
    if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname))
      return url.hostname.replace(/^\[(.*)\]$/, '$1');
  } catch {
  }
  const match = urlOrLine.match(/https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(?::\d+)?/i);
  return match ? match[1].replace(/^\[(.*)\]$/, '$1') : undefined;
}

function detectDiagnostics(url: string, consoleLines: string[], networkLines: string[]) {
  const diagnostics: string[] = [];
  const joinedConsole = consoleLines.join('\n');
  const joinedNetwork = networkLines.join('\n');
  const lowerUrl = url.toLowerCase();
  const lowerConsole = joinedConsole.toLowerCase();

  if (
    lowerUrl.includes('/oauth/')
    || (lowerUrl.includes('authorize') && lowerUrl.includes('redirect='))
    || (lowerUrl.includes('/login') && lowerUrl.includes('redirect='))
    || (lowerConsole.includes('oauth') && lowerConsole.includes('redirect'))
  ) {
    diagnostics.push('auth_redirect_detected: current page appears to be on an auth/login redirect route; app content may have redirected before rendering.');
  }

  if (joinedConsole.includes('basename') && joinedConsole.includes('won\'t render anything')) {
    diagnostics.push('router_basename_mismatch: React Router basename does not match the current URL.');
  }

  if (
    joinedConsole.includes('MIME type (\'text/plain\') is not a supported stylesheet MIME type')
    || /\\.(js|css).+=> \\[404\\]/.test(joinedNetwork)
  ) {
    diagnostics.push('asset_path_mismatch: JS/CSS asset requests are failing or resolving to non-asset content; check base path, proxy, or prefix stripping.');
  }

  const currentLoopback = parseLoopbackHost(url);
  const mentionedLoopbacks = new Set([
    ...consoleLines.map(parseLoopbackHost),
    ...networkLines.map(parseLoopbackHost),
  ].filter(Boolean));
  if (currentLoopback && mentionedLoopbacks.size) {
    const differentLoopback = [...mentionedLoopbacks].find(host => host && host !== currentLoopback);
    if (differentLoopback && joinedConsole.includes('ERR_CONNECTION_REFUSED')) {
      diagnostics.push(`loopback_host_mismatch: current page uses ${currentLoopback}, but failing requests mention ${differentLoopback}. If this is a local dev server, try the same URL with localhost, 127.0.0.1, or ::1.`);
    }
  }

  return diagnostics;
}

const debugSummary = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_debug_summary',
    title: 'Debug summary',
    description: 'Get a lightweight debug summary (console/network tail) for the current page',
    inputSchema: z.object({
      consoleLimit: z.number().optional().describe('Max console messages to return'),
      networkLimit: z.number().optional().describe('Max network requests to return'),
      includeStatic: z.boolean().optional().describe('Whether to include static assets in network tail'),
      consoleLevels: z.array(z.enum(['log', 'info', 'warning', 'error', 'debug', 'assert'])).optional().describe('Optional console levels to include. Useful for noise reduction, for example [\"warning\", \"error\"].'),
      diagnosticsOnly: z.boolean().optional().describe('When true, omit console/network tails and only return the current URL plus derived diagnostics.'),
    }),
    type: 'readOnly',
  },
  handle: async (tab: any, params: any, response: any) => {
    const consoleLimit = params.consoleLimit ?? 20;
    const networkLimit = params.networkLimit ?? 50;
    const includeStatic = Boolean(params.includeStatic);
    const diagnosticsOnly = Boolean(params.diagnosticsOnly);
    const consoleLevels = Array.isArray(params.consoleLevels) && params.consoleLevels.length
      ? new Set(params.consoleLevels)
      : null;

    response.addResult(`url: ${tab.page.url()}`);

    let cTail = tab.debugConsoleTail(consoleLimit * (consoleLevels ? 5 : 1));
    if (consoleLevels)
      cTail = cTail.filter((m: any) => consoleLevels.has(typeof m.type === 'function' ? (m.type() || 'log') : (m.type || 'log')));
    cTail = cTail.slice(-consoleLimit);
    const consoleLines = cTail.map((m: any) => m.toString());
    if (!diagnosticsOnly) {
      response.addResult('console_tail:');
      for (const line of consoleLines)
        response.addResult(`- ${line}`);
    }

    const nTail = tab.debugNetworkTail(networkLimit, includeStatic);
    const networkLines = nTail.map(([req, res]: any) => renderReq(req, res));
    if (!diagnosticsOnly) {
      response.addResult('network_tail:');
      for (const line of networkLines)
        response.addResult(`- ${line}`);
    }

    const diagnostics = detectDiagnostics(tab.page.url(), consoleLines, networkLines);
    if (diagnostics.length) {
      response.addResult('diagnostics:');
      for (const item of diagnostics)
        response.addResult(`- ${item}`);
    }
  },
});

export default [debugSummary];
