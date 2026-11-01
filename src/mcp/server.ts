import debug from 'debug';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { httpAddressToString, installHttpTransport, startHttpServer } from './http.js';
import { InProcessTransport } from './inProcessTransport.js';

const serverDebug = debug('pw:bp:server');
const errorsDebug = debug('pw:bp:errors');

export async function connect(factory: any, transport: any, runHeartbeat: boolean) {
  const server = createServer(factory.name, factory.version, factory.create(), runHeartbeat);
  await server.connect(transport);
}

export async function wrapInProcess(backend: any) {
  const server = createServer('Internal', '0.0.0', backend, false);
  return new InProcessTransport(server);
}

export function createServer(name: string, version: string, backend: any, runHeartbeat: boolean) {
  let initializedPromiseResolve = () => {};
  const initializedPromise = new Promise<void>(resolve => initializedPromiseResolve = resolve);
  const server = new Server({ name, version }, {
    capabilities: {
      tools: {},
    },
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    serverDebug('listTools');
    await initializedPromise;
    const tools = await backend.listTools();
    return { tools };
  });
  let heartbeatRunning = false;
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    serverDebug('callTool', request);
    await initializedPromise;
    if (runHeartbeat && !heartbeatRunning) {
      heartbeatRunning = true;
      startHeartbeat(server);
    }
    try {
      return await backend.callTool(request.params.name, request.params.arguments ?? {});
    } catch (error) {
      return {
        content: [{ type: 'text', text: '### Result\n' + String(error) }],
        isError: true,
      };
    }
  });
  addServerListener(server as any, 'initialized', async () => {
    try {
      const capabilities = (server as any).getClientCapabilities();
      let clientRoots: any[] = [];
      if (capabilities?.roots) {
        const { roots } = await (server as any).listRoots(undefined, { timeout: 2_000 }).catch(() => ({ roots: [] }));
        clientRoots = roots;
      }
      const clientVersion = (server as any).getClientVersion() ?? { name: 'unknown', version: 'unknown' };
      await backend.initialize?.(server, clientVersion, clientRoots);
      initializedPromiseResolve();
    } catch (e) {
      errorsDebug(e);
    }
  });
  addServerListener(server as any, 'close', () => backend.serverClosed?.(server));
  return server;
}

const startHeartbeat = (server: any) => {
  const beat = () => {
    Promise.race([
      server.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 5000)),
    ]).then(() => {
      setTimeout(beat, 3000);
    }).catch(() => {
      void server.close();
    });
  };
  beat();
};

function addServerListener(server: any, event: string, listener: () => void) {
  const oldListener = server[`on${event}`];
  server[`on${event}`] = () => {
    oldListener?.();
    listener();
  };
}

export async function start(serverBackendFactory: any, options: any) {
  if (options.port === undefined) {
    await connect(serverBackendFactory, new StdioServerTransport(), false);
    return;
  }
  const httpServer = await startHttpServer(options);
  await installHttpTransport(httpServer, serverBackendFactory);
  const url = httpAddressToString(httpServer.address());
  const mcpConfig: any = { mcpServers: {} };
  mcpConfig.mcpServers[serverBackendFactory.nameInConfig] = {
    url: `${url}/mcp`,
  };
  const message = [
    `Listening on ${url}`,
    'Put this in your client config:',
    JSON.stringify(mcpConfig, undefined, 2),
    'For legacy SSE transport support, you can use the /sse endpoint instead.',
  ].join('\n');
  console.error(message);
}
