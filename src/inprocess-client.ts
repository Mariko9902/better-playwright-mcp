import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { contextFactory } from './browserContextFactory.js';
import { BrowserServerBackend } from './browserServerBackend.js';
import { Context as BrowserContext } from './context.js';
import { InProcessTransport } from './mcp/inProcessTransport.js';
import * as mcpServer from './mcp/server.js';
import { packageJSON } from './utils/package.js';
import { configFromCLIOptions, resolveConfig } from './config.js';

function isRuntimeConfigLike(configOverrides: any) {
  return Boolean(
    configOverrides
    && typeof configOverrides === 'object'
    && (
      'browser' in configOverrides
      || 'server' in configOverrides
      || 'network' in configOverrides
      || 'saveTrace' in configOverrides
      || 'outputDir' in configOverrides
    )
  );
}

function normalizeInProcessOverrides(configOverrides: any) {
  if (!configOverrides || typeof configOverrides !== 'object')
    return {};
  if (isRuntimeConfigLike(configOverrides))
    return configOverrides;

  const cliLikeOptions: Record<string, any> = { ...configOverrides };
  if (configOverrides.chromium === true && !cliLikeOptions.browser)
    cliLikeOptions.browser = 'chromium';
  if (configOverrides.chromium === false && !cliLikeOptions.browser)
    cliLikeOptions.browser = 'chrome';
  if (configOverrides.headless !== undefined)
    cliLikeOptions.headless = configOverrides.headless;
  if (configOverrides.initPage !== undefined)
    cliLikeOptions.initPage = configOverrides.initPage;
  return configFromCLIOptions(cliLikeOptions);
}

export async function createInProcessClient(configOverrides: any = {}) {
  const config = await resolveConfig(normalizeInProcessOverrides(configOverrides));

  const client = new Client({
    name: 'better-playwright in-process client',
    version: packageJSON.version,
  });

  const browserContextFactory = contextFactory(config);

  const server = mcpServer.createServer(
    'better-playwright in-process',
    packageJSON.version,
    new BrowserServerBackend(config, browserContextFactory),
    false,
  );

  const transport = new InProcessTransport(server);
  await client.connect(transport);
  await client.ping();

  const close = async () => {
    await transport.close().catch(() => {});
    await BrowserContext.disposeAll().catch(() => {});
  };

  return { client, config, close };
}
