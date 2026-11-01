import { fileURLToPath } from 'url';
import { Context } from './context.js';
import { logUnhandledError } from './utils/log.js';
import { Response } from './response.js';
import { SessionLog } from './sessionLog.js';
import { filteredTools } from './tools.js';
import { toMcpTool } from './mcp/tool.js';

export class BrowserServerBackend {
  _tools: any[];
  _context: any;
  _sessionLog: any;
  _config: any;
  _browserContextFactory: any;

  _deviceModeAllowlist = new Set([
    'browser_set_device_mode',
    'browser_batch',
    'browser_close',
    'browser_restart',
    'browser_snapshot',
    'browser_tabs',
  ]);

  constructor(config: any, factory: any) {
    this._config = config;
    this._browserContextFactory = factory;
    this._tools = filteredTools(config);
  }

  async initialize(_server: any, clientVersion: any, roots: any[]) {
    let rootPath;
    if (roots.length > 0) {
      const firstRootUri = roots[0]?.uri;
      const url = firstRootUri ? new URL(firstRootUri) : undefined;
      rootPath = url ? fileURLToPath(url) : undefined;
    }
    this._sessionLog = this._config.saveSession ? await SessionLog.create(this._config, rootPath) : undefined;
    this._context = new Context({
      tools: this._tools,
      config: this._config,
      browserContextFactory: this._browserContextFactory,
      sessionLog: this._sessionLog,
      clientInfo: { ...clientVersion, rootPath },
    });
  }

  async listTools() {
    return this._tools.map(tool => toMcpTool(tool.schema));
  }

  async callTool(name: string, rawArguments: any) {
    const tool = this._tools.find(tool => tool.schema.name === name);
    if (!tool)
      throw new Error(`Tool "${name}" not found`);
    const parsedArguments = tool.schema.inputSchema.parse(rawArguments ?? {});
    const context = this._context;

    if (context?.deviceModeRequired?.() && !context?.deviceMode?.()) {
      const isTabs = name === 'browser_tabs';
      const tabsAction = isTabs ? parsedArguments?.action : undefined;
      const tabsAllowed = isTabs && ['list', 'new', 'close', 'select'].includes(String(tabsAction));
      const navigateAllowed = name === 'browser_navigate';
      if (!this._deviceModeAllowlist.has(name) && !tabsAllowed && !navigateAllowed) {
        throw new Error(
          'Device mode is required before using browser tools. '
          + 'Call "browser_set_device_mode" with mode="H5" or mode="PC" first.'
        );
      }
    }

    const response = new Response(context, name, parsedArguments);
    context.setRunningTool(name);
    try {
      await tool.handle(context, parsedArguments, response);
      await response.finish();
      this._sessionLog?.logResponse(response);
    } catch (error) {
      const debugOnError = process.env.BETTER_PLAYWRIGHT_DEBUG_ON_ERROR === '1';
      const errorText = String(error);
      const isTimeout = errorText.includes('TimeoutError');
      const explicitUserError = Boolean((error as any)?.mcpIsUserError);

      const looksLikeZodIssueArray = Array.isArray(error)
        && error.length > 0
        && typeof error[0] === 'object'
        && (typeof (error[0] as any)?.message === 'string' || Array.isArray((error[0] as any)?.path));
      const looksLikeZodError =
        (error as any)?.name === 'ZodError'
        || Array.isArray((error as any)?.issues)
        || errorText.includes('ZodError')
        || looksLikeZodIssueArray;

      const isUserError =
        explicitUserError
        || looksLikeZodError
        || errorText.includes('required')
        || errorText.includes('Invalid')
        || errorText.includes('No open pages available')
        || errorText.includes('Use the "browser_navigate" tool')
        || errorText.includes('does not handle the modal state')
        || errorText.includes('can only be used when there is related modal state present')
        || (errorText.includes('Tool "') && errorText.includes('not found'));

      response.addError(errorText);

      if (!isUserError && debugOnError) {
        try {
          const tab = context.currentTab();
          if (tab) {
            response.setIncludeSnapshot();

            if (!isTimeout) {
              const fileName = await tab.context.outputFile(`failure-${Date.now()}.png`);
              await tab.page.screenshot({ path: fileName, fullPage: true }).catch(logUnhandledError);
              response.addResult(`failure_screenshot: ${fileName}`);

              const consoleTail = tab.debugConsoleTail(5);
              if (consoleTail.length) {
                response.addResult('console_tail:');
                for (const m of consoleTail)
                  response.addResult(`- ${m.toString()}`);
              }
              const netTail = tab.debugNetworkTail(10, false);
              if (netTail.length) {
                response.addResult('network_tail:');
                for (const [req, res] of netTail) {
                  const line = res
                    ? `[${req.method()}] ${req.url()} => [${res.status()}] ${res.statusText()}`
                    : `[${req.method()}] ${req.url()} => (pending)`;
                  response.addResult(`- ${line}`);
                }
              }
            }

            await response.finish();
          }
        } catch (error) {
          logUnhandledError(error);
        }
      }
      this._sessionLog?.logResponse(response);
    } finally {
      context.setRunningTool(undefined);
    }
    return response.serialize();
  }

  serverClosed() {
    void (async () => {
      await this._context?.dispose().catch(logUnhandledError);
      await this._sessionLog?.flush?.().catch(logUnhandledError);
    })();
  }
}
