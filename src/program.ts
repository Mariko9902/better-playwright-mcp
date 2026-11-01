#!/usr/bin/env node

import { start } from './mcp/server.js';
import { contextFactory } from './browserContextFactory.js';
import { BrowserServerBackend } from './browserServerBackend.js';
import { resolveCLIConfig } from './config.js';
import { packageJSON } from './utils/package.js';

const args = process.argv.slice(2);
const options: Record<string, any> = {};

function toOptionKey(arg: string) {
  return arg.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--no-')) {
    const key = toOptionKey(arg.slice(5));
    options[key] = false;
    continue;
  }
  if (arg.startsWith('--')) {
    const key = toOptionKey(arg.slice(2));
    const nextArg = args[i + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      options[key] = nextArg;
      i++;
    } else {
      options[key] = true;
    }
  }
}

const config = await resolveCLIConfig(options);
const browserContextFactory = contextFactory(config);

const serverBackendFactory = {
  name: 'better-playwright',
  version: packageJSON.version,
  nameInConfig: 'better-playwright',
  create: () => new BrowserServerBackend(config, browserContextFactory),
};

await start(serverBackendFactory, options);
