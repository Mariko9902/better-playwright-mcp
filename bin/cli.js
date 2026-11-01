#!/usr/bin/env node

import { program } from 'commander';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

function spawnRuntime(args) {
  const child = spawn('node', args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env }
  });

  child.on('error', (err) => {
    console.error('Failed to start better-playwright:', err);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

function normalizeBooleanOption(value) {
  if (value === undefined)
    return undefined;
  return Boolean(value);
}

function parseArgumentsJson(value) {
  if (!value)
    return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('arguments must be a JSON object');
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid tool arguments JSON: ${message}`);
  }
}

program
  .name('better-playwright')
  .description('Better Playwright - High-performance browser automation with MCP, HTTP, and in-process modes')
  .version(packageJson.version);

             
program
  .command('mcp', { isDefault: true })
  .description('Start MCP server (stdio mode)')
  .option('--snapshot-dir <path>', 'directory to save snapshots')
  .action((options) => {
    const args = ['lib/program.js'];
    if (options.snapshotDir)
      args.push('--output-dir', options.snapshotDir);
    spawnRuntime(args);
  });

program
  .command('server')
  .description('Start MCP server over HTTP')
  .option('-p, --port <number>', 'server port', '3102')
  .option('--host <string>', 'server host', 'localhost')
  .option('--headless', 'run browser in headless mode')
  .option('--chromium', 'use Chromium instead of Chrome')
  .option('--no-user-profile', 'do not use persistent user profile')
  .option('--user-data-dir <path>', 'user data directory')
  .option('--snapshot-dir <path>', 'directory to save snapshots')
  .action((options) => {
    const args = ['lib/program.js', '--port', String(options.port), '--host', String(options.host)];
    if (options.headless)
      args.push('--headless');
    if (options.chromium)
      args.push('--browser', 'chromium');
    if (!options.userProfile)
      args.push('--isolated');
    if (options.userDataDir)
      args.push('--user-data-dir', options.userDataDir);
    if (options.snapshotDir)
      args.push('--output-dir', options.snapshotDir);
    spawnRuntime(args);
  });

program
  .command('call <tool> [argumentsJson]')
  .description('Call one MCP tool directly in-process without starting a standalone MCP service')
  .option('--headless', 'run browser in headless mode')
  .option('--chromium', 'use Chromium instead of Chrome')
  .option('--no-user-profile', 'do not use persistent user profile')
  .option('--user-data-dir <path>', 'user data directory')
  .option('--snapshot-dir <path>', 'directory to save snapshots')
  .option('--pretty', 'pretty-print JSON output', true)
  .action(async (tool, argumentsJson, options) => {
    try {
      const { createInProcessClient } = await import(join(repoRoot, 'lib/index.js'));
      const toolArguments = parseArgumentsJson(argumentsJson);
      const configOverrides = {
        headless: normalizeBooleanOption(options.headless),
        browser: options.chromium ? 'chromium' : undefined,
        isolated: options.userProfile === false ? true : undefined,
        userDataDir: options.userDataDir,
        outputDir: options.snapshotDir,
      };
      const { client, close } = await createInProcessClient(configOverrides);
      try {
        const result = await client.callTool({ name: tool, arguments: toolArguments });
        const spacing = options.pretty === false ? 0 : 2;
        process.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
        process.exitCode = result?.isError ? 2 : 0;
      } finally {
        await close();
      }
    } catch (error) {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
