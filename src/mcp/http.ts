import assert from 'assert';
import http from 'http';
import crypto from 'crypto';
import debug from 'debug';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as mcpServer from './server.js';

const testDebug = debug('pw:bp:test');

export async function startHttpServer(config: any, abortSignal?: AbortSignal) {
  const { host, port } = config;
  const httpServer = http.createServer();
  decorateServer(httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject);
    abortSignal?.addEventListener('abort', () => {
      httpServer.close();
      reject(new Error('Aborted'));
    });
    httpServer.listen(port, host, () => {
      resolve();
      httpServer.removeListener('error', reject);
    });
  });
  return httpServer;
}

export function httpAddressToString(address: any) {
  assert(address, 'Could not bind server socket');
  if (typeof address === 'string')
    return address;
  const resolvedPort = address.port;
  let resolvedHost = address.family === 'IPv4' ? address.address : `[${address.address}]`;
  if (resolvedHost === '0.0.0.0' || resolvedHost === '[::]')
    resolvedHost = 'localhost';
  return `http://${resolvedHost}:${resolvedPort}`;
}

export async function installHttpTransport(httpServer: http.Server, serverBackendFactory: any) {
  const sseSessions = new Map();
  const streamableSessions = new Map();
  httpServer.on('request', async (req, res) => {
    const url = new URL(`http://localhost${req.url}`);
    if (url.pathname.startsWith('/sse'))
      await handleSSE(serverBackendFactory, req, res, url, sseSessions);
    else
      await handleStreamable(serverBackendFactory, req, res, streamableSessions);
  });
}

async function handleSSE(serverBackendFactory: any, req: http.IncomingMessage, res: http.ServerResponse, url: URL, sessions: Map<any, any>) {
  if (req.method === 'POST') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      res.statusCode = 400;
      return res.end('Missing sessionId');
    }
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.statusCode = 404;
      return res.end('Session not found');
    }
    return await transport.handlePostMessage(req, res);
  } else if (req.method === 'GET') {
    const transport = new SSEServerTransport('/sse', res);
    sessions.set(transport.sessionId, transport);
    testDebug(`create SSE session: ${transport.sessionId}`);
    await mcpServer.connect(serverBackendFactory, transport, false);
    res.on('close', () => {
      testDebug(`delete SSE session: ${transport.sessionId}`);
      sessions.delete(transport.sessionId);
    });
    return;
  }
  res.statusCode = 405;
  res.end('Method not allowed');
}

async function handleStreamable(serverBackendFactory: any, req: http.IncomingMessage, res: http.ServerResponse, sessions: Map<any, any>) {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId) {
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.statusCode = 404;
      res.end('Session not found');
      return;
    }
    return await transport.handleRequest(req, res);
  }
  if (req.method === 'POST') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: async (createdSessionId: string) => {
        testDebug(`create http session: ${transport.sessionId}`);
        await mcpServer.connect(serverBackendFactory, transport, true);
        sessions.set(createdSessionId, transport);
      },
    });
    transport.onclose = () => {
      if (!transport.sessionId)
        return;
      sessions.delete(transport.sessionId);
      testDebug(`delete http session: ${transport.sessionId}`);
    };
    await transport.handleRequest(req, res);
    return;
  }
  res.statusCode = 400;
  res.end('Invalid request');
}

function decorateServer(server: http.Server) {
  const sockets = new Set<any>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const close = server.close;
  server.close = ((callback?: (err?: Error) => void) => {
    for (const socket of sockets)
      socket.destroy();
    sockets.clear();
    return close.call(server, callback);
  }) as typeof server.close;
}
