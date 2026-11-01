import fs from 'fs';
import path from 'path';
import http from 'http';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const officialRoot = path.resolve(repoRoot, '../playwright-mcp');
const fixturePath = path.resolve(repoRoot, 'scripts/fixtures/compare-playground.html');
const initPagePath = path.resolve(repoRoot, 'lib/enhanced/init-page-enhanced.js');
const officialInitPagePath = path.resolve(officialRoot, 'init-page-enhanced.ts');
const betterOutputDir = path.resolve(repoRoot, '.tmp-compare-better');
const officialOutputDir = path.resolve(repoRoot, '.tmp-compare-official');
const fixtureHtml = fs.readFileSync(fixturePath, 'utf8');
const comparePort = Number(process.env.COMPARE_PORT || 16327);
const fixtureBaseUrl = `http://127.0.0.1:${comparePort}`;

if (!fs.existsSync(officialRoot)) {
  console.log(JSON.stringify({
    skipped: true,
    reason: `official playwright-mcp repo not found at ${officialRoot}`,
  }, null, 2));
  process.exit(0);
}

fs.mkdirSync(betterOutputDir, { recursive: true });
fs.mkdirSync(officialOutputDir, { recursive: true });

function responseText(result) {
  return (result?.content || []).map(item => item?.text || '').join('\n');
}

function ensureNoToolError(label, toolName, result) {
  const text = responseText(result);
  if (result?.isError)
    throw new Error(`[${label}] ${toolName} failed: ${text}`);
  if (/^### Result\nError:/m.test(text) || /Tool ".*" not found/.test(text))
    throw new Error(`[${label}] ${toolName} failed: ${text}`);
}

function parseEvaluateJson(result) {
  const text = responseText(result);
  const match = text.match(/### Result\n([\s\S]*?)\n(?:###|$)/);
  const payload = match ? match[1].trim() : text.trim();
  return JSON.parse(payload);
}

function createFixtureServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fixtureHtml);
      return;
    }
    if (req.method === 'POST' && (req.url === '/api/login' || req.url === '/api/submit')) {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8') || '{}';
        const body = JSON.parse(bodyText);
        const message = req.url === '/api/login' ? 'Login successful' : 'Submission successful';
        const responseBody = {
          ok: true,
          code: 0,
          message,
          data: body,
          source: req.url,
        };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(responseBody));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, code: 404 }));
  });
}

async function startServer() {
  const server = createFixtureServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(comparePort, '127.0.0.1', resolve);
  });
  return server;
}

async function connectClient(label, command, args, cwd, env) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: `${label}-compare`, version: '1.0.0' });
  await client.connect(transport);
  await client.ping();
  return { client, transport };
}

async function safeClose(connection) {
  if (!connection)
    return;
  await connection.client?.close?.().catch(() => {});
  await connection.transport?.close?.().catch(() => {});
}

async function runTool(label, client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  ensureNoToolError(label, name, result);
  return result;
}

async function collectState(label, client) {
  const result = await runTool(label, client, 'browser_evaluate', {
    function: `() => ({
      account: document.querySelector('[data-testid="login-account"]')?.value || '',
      password: document.querySelector('[data-testid="login-password"]')?.value || '',
      remark: document.querySelector('[data-testid="login-remark"]')?.value || '',
      loginStatus: document.querySelector('#login-status')?.textContent?.trim() || '',
      pickerValue: document.querySelector('#biz-type-field .picker-row')?.textContent?.trim() || '',
      region: document.querySelector('#region-select')?.textContent?.trim() || '',
      team: document.querySelector('#team-select')?.textContent?.trim() || '',
      date: document.querySelector('#date-input')?.value || '',
      submitStatus: document.querySelector('#submit-status')?.textContent?.trim() || '',
      lastLogin: window.__compareLastLogin || null,
      lastSubmit: window.__compareLastSubmit || null,
    })`,
  });
  return parseEvaluateJson(result);
}

async function runBetterFlow(client) {
  const label = 'better';
  const startedAt = performance.now();
  await runTool(label, client, 'browser_navigate', { url: fixtureBaseUrl });
  await runTool(label, client, 'browser_snapshot', {});
  await runTool(label, client, 'browser_framework_action', { action: 'uni_fill_by_label', label: 'Account', value: 'demo-user' });
  await runTool(label, client, 'browser_framework_action', { action: 'uni_fill_by_label', label: 'Password', value: 'secret-123' });
  await runTool(label, client, 'browser_framework_action', { action: 'uni_textarea', value: 'better note' });
  await runTool(label, client, 'browser_resilient_action', { action: 'js_click', selector: '#uni-login-button button' });
  await runTool(label, client, 'browser_wait_for_api', { urlPattern: '/api/login', method: 'POST', timeoutMs: 6000 });
  await runTool(label, client, 'browser_wait_for_any', { text: 'Login successful', timeoutMs: 4000 });
  await runTool(label, client, 'browser_framework_action', {
    action: 'uni_select_field_option_by_label',
    label: 'Business type',
    optionText: 'Medical device company',
    confirmTexts: ['Confirm'],
  });
  await runTool(label, client, 'browser_framework_action', { action: 'el_select', selector: '#region-select', text: 'East' });
  await runTool(label, client, 'browser_framework_action', { action: 'el_tree_select', selector: '#team-select', text: 'Sales team 1' });
  await runTool(label, client, 'browser_framework_action', { action: 'el_date_picker', selector: '.el-date-editor', value: '2026-03-11' });
  await runTool(label, client, 'browser_resilient_action', { action: 'click_with_retry', selector: '#final-submit', retries: 2, timeoutMs: 3000 });
  await runTool(label, client, 'browser_wait_for_api', { urlPattern: '/api/submit', method: 'POST', timeoutMs: 6000 });
  await runTool(label, client, 'browser_wait_for_any', { text: 'Submission successful', timeoutMs: 4000 });
  const diagnose = responseText(await runTool(label, client, 'browser_resilient_action', { action: 'diagnose' }));
  const state = await collectState(label, client);
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    state,
    diagnose,
  };
}

async function runOfficialFlow(client) {
  const label = 'official';
  const startedAt = performance.now();
  await runTool(label, client, 'browser_navigate', { url: fixtureBaseUrl });
  await runTool(label, client, 'browser_snapshot', {});
  await runTool(label, client, 'browser_run_code', {
    code: `async (page) => {
      await page.evaluate(() => {
        if (!page.smart)
          return;
      }).catch(() => {});
      await page.locator('[data-testid="login-account"]').fill('demo-user');
      await page.locator('[data-testid="login-password"]').fill('secret-123');
      await page.smart.uniTextarea('official note');
      await Promise.all([
        page.smart.waitForAPI('/api/login', { method: 'POST', timeout: 6000 }),
        page.smart.uniClick('Log in'),
      ]);
      await page.smart.waitForAny({ text: 'Login successful' }, 4000);
      await page.locator('#biz-type-field .picker-row').click();
      await page.locator('.uni-picker-item', { hasText: 'Medical device company' }).click();
      await page.getByRole('button', { name: 'Confirm' }).click();
      await page.smart.elSelect('#region-select', 'East');
      await page.smart.elTreeSelect('#team-select', 'Sales team 1');
      await page.smart.elDatePicker('.el-date-editor', '2026-03-11');
      await Promise.all([
        page.smart.waitForAPI('/api/submit', { method: 'POST', timeout: 6000 }),
        page.smart.clickWithRetry('#final-submit', { retries: 2, timeout: 3000 }),
      ]);
      await page.smart.waitForAny({ text: 'Submission successful' }, 4000);
      return await page.smart.diagnose();
    }`,
  });
  const state = await collectState(label, client);
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    state,
  };
}

function summarizeComparison(betterResult, officialResult) {
  return {
    fixtureBaseUrl,
    better: {
      elapsedMs: betterResult.elapsedMs,
      loginStatus: betterResult.state.loginStatus,
      submitStatus: betterResult.state.submitStatus,
      pickerValue: betterResult.state.pickerValue,
      region: betterResult.state.region,
      team: betterResult.state.team,
      date: betterResult.state.date,
    },
    official: {
      elapsedMs: officialResult.elapsedMs,
      loginStatus: officialResult.state.loginStatus,
      submitStatus: officialResult.state.submitStatus,
      pickerValue: officialResult.state.pickerValue,
      region: officialResult.state.region,
      team: officialResult.state.team,
      date: officialResult.state.date,
    },
    conclusions: [
      'better-playwright exposes complex controls and recovery paths through discoverable tools, without requiring handwritten browser_run_code.',
      'The original playwright-mcp can complete the same workflow with the same init-page, but relies mainly on browser_run_code and offers less discoverability and composability.',
      'The timings measure end-to-end tool orchestration, not browser engine performance.',
    ],
  };
}

async function main() {
  const server = await startServer();
  let betterConnection;
  let officialConnection;

  try {
    betterConnection = await connectClient(
      'better',
      'node',
      [path.resolve(repoRoot, 'bin/cli.js'), 'mcp'],
      repoRoot,
      {
        ...process.env,
        BETTER_PLAYWRIGHT_INIT_PAGE: initPagePath,
        BETTER_PLAYWRIGHT_HEADLESS: 'true',
        BETTER_PLAYWRIGHT_ISOLATED: 'true',
        BETTER_PLAYWRIGHT_OUTPUT_DIR: betterOutputDir,
      },
    );

    officialConnection = await connectClient(
      'official',
      'node',
      [path.resolve(officialRoot, 'cli.js'), '--init-page', officialInitPagePath],
      officialRoot,
      {
        ...process.env,
        PLAYWRIGHT_MCP_INIT_PAGE: officialInitPagePath,
        PLAYWRIGHT_MCP_HEADLESS: 'true',
        PLAYWRIGHT_MCP_ISOLATED: 'true',
        PLAYWRIGHT_MCP_OUTPUT_DIR: officialOutputDir,
      },
    );

    const betterTools = await betterConnection.client.listTools();
    const officialTools = await officialConnection.client.listTools();

    const betterResult = await runBetterFlow(betterConnection.client);
    const officialResult = await runOfficialFlow(officialConnection.client);

    const output = {
      toolCounts: {
        better: betterTools.tools.length,
        official: officialTools.tools.length,
      },
      comparison: summarizeComparison(betterResult, officialResult),
      betterDiagnose: betterResult.diagnose,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await safeClose(betterConnection);
    await safeClose(officialConnection);
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
