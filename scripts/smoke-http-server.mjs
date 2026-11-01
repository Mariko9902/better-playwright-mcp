import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(path.resolve(repoRoot, 'package.json'));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(error => {
        if (error)
          reject(error);
        else
          resolve(port);
      });
    });
  });
}

const fixtureHtml = fs.readFileSync(path.resolve(repoRoot, 'scripts/fixtures/compare-playground.html'), 'utf8');
const fixturePort = Number(process.env.SMOKE_FIXTURE_PORT || await findFreePort());
const serverPort = Number(process.env.SMOKE_SERVER_PORT || await findFreePort());
const fixtureBaseUrl = `http://127.0.0.1:${fixturePort}`;
const mcpBaseUrl = `http://127.0.0.1:${serverPort}/mcp`;

function responseText(result) {
  return (result?.content || []).map(item => item?.text || '').join('\n');
}

function parseEvaluateJson(result) {
  const text = responseText(result);
  const match = text.match(/### Result\n([\s\S]*?)\n(?:###|$)/);
  return JSON.parse((match ? match[1] : text).trim());
}

function parseResultJson(result) {
  const text = responseText(result);
  const match = text.match(/### Result\n([\s\S]*?)\n(?:###|$)/);
  return JSON.parse((match ? match[1] : text).trim());
}

function createFixtureServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fixtureHtml);
      return;
    }
    if (req.method === 'GET' && req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && (req.url === '/api/login' || req.url === '/api/submit')) {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8') || '{}';
        const body = JSON.parse(bodyText);
        const message = req.url === '/api/login' ? 'Login successful' : 'Submission successful';
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, code: 0, message, data: body, source: req.url }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, code: 404 }));
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected)
    throw new Error(`Smoke assertion failed for ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function waitForServerReady(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let stderrBuffer = '';
    let stdoutBuffer = '';
    const onStdout = chunk => {
      stdoutBuffer += chunk.toString('utf8');
      if (stdoutBuffer.includes('Listening on http://'))
        cleanupAndResolve();
    };
    const onStderr = chunk => {
      stderrBuffer += chunk.toString('utf8');
      if (stderrBuffer.includes('Listening on http://'))
        cleanupAndResolve();
    };
    const onExit = code => {
      cleanup();
      reject(new Error(`HTTP MCP server exited early with code=${code}\nSTDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for HTTP MCP server readiness\nSTDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('exit', onExit);
    };
    const cleanupAndResolve = () => {
      cleanup();
      resolve({ stdoutBuffer, stderrBuffer });
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.on('exit', onExit);
  });
}

async function main() {
  const fixtureServer = createFixtureServer();
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(fixturePort, '127.0.0.1', resolve);
  });

  const child = spawn('node', [
    path.resolve(repoRoot, 'bin/cli.js'),
    'server',
    '--host', '127.0.0.1',
    '--port', String(serverPort),
    '--headless',
    '--no-user-profile',
    '--snapshot-dir', path.resolve(repoRoot, '.tmp-http-smoke')
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BETTER_PLAYWRIGHT_INIT_PAGE: path.resolve(repoRoot, 'lib/enhanced/init-page-enhanced.js'),
      BETTER_PLAYWRIGHT_REQUIRE_DEVICE_MODE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const client = new Client({ name: 'http-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpBaseUrl));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    if (result?.isError)
      throw new Error(`tool ${name} failed:\n${responseText(result)}`);
    return result;
  };

  try {
    await waitForServerReady(child);
    await client.connect(transport);
    await client.ping();

    const toolList = await client.listTools();
    const toolNames = toolList.tools.map(tool => tool.name);

    await call('browser_batch', {
      includeSnapshot: false,
      steps: [
        { tool: 'browser_set_device_mode', args: { mode: 'PC' } },
        { tool: 'browser_navigate', args: { url: fixtureBaseUrl } },
        { tool: 'browser_framework_action', args: { action: 'uni_fill_by_label', label: 'Account', value: 'demo-user' } },
        { tool: 'browser_framework_action', args: { action: 'uni_fill_by_label', label: 'Password', value: 'secret-123' } },
        { tool: 'browser_framework_action', args: { action: 'uni_textarea', value: 'http smoke note' } },
        { tool: 'browser_click_and_wait_for_api', args: { element: 'Login button', selector: '#uni-login-button button', urlPattern: '/api/login', method: 'POST', timeoutMs: 6000 } },
        { tool: 'browser_wait_for_any', args: { text: 'Login successful', timeoutMs: 4000 } },
        { tool: 'browser_framework_action', args: { action: 'uni_select_field_option_by_label', label: 'Business type', optionText: 'Medical device company', confirmTexts: ['Confirm'] } },
        { tool: 'browser_framework_action', args: { action: 'el_select', selector: '#region-select', text: 'East' } },
        { tool: 'browser_framework_action', args: { action: 'el_tree_select', selector: '#team-select', text: 'Sales team 1' } },
        { tool: 'browser_framework_action', args: { action: 'el_date_picker', selector: '.el-date-editor', value: '2026-03-11' } },
        { tool: 'browser_click_and_wait_for_api', args: { element: 'Submit button', selector: '#final-submit', urlPattern: '/api/submit', method: 'POST', timeoutMs: 6000 } },
        { tool: 'browser_wait_for_any', args: { text: 'Submission successful', timeoutMs: 4000 } }
      ]
    });
    const outlineText = responseText(await call('browser_outline'));
    const searchResult = parseResultJson(await call('browser_search_snapshot', {
      pattern: 'Login successful',
      lineLimit: 5,
    }));

    const state = parseEvaluateJson(await call('browser_evaluate', {
      function: `() => ({
        loginStatus: document.querySelector('#login-status')?.textContent?.trim() || '',
        submitStatus: document.querySelector('#submit-status')?.textContent?.trim() || '',
        account: document.querySelector("[data-testid='login-account']")?.value || '',
        password: document.querySelector("[data-testid='login-password']")?.value || '',
        remark: document.querySelector("[data-testid='login-remark']")?.value || '',
        pickerValue: document.querySelector('#biz-type-field .picker-row')?.textContent?.trim() || '',
        region: document.querySelector('#region-select')?.textContent?.trim() || '',
        team: document.querySelector('#team-select')?.textContent?.trim() || '',
        date: document.querySelector('#date-input')?.value || ''
      })`
    }));

    const runCodeResult = responseText(await call('browser_run_code', {
      code: `async (page) => ({ title: await page.title(), url: page.url() })`
    }));
    const runCodeAsyncListenerResult = responseText(await call('browser_run_code', {
      code: `async (page) => {
        const captured = [];
        page.on('response', async (response) => {
          const url = new URL(response.url());
          if (!url.pathname.startsWith('/api/'))
            return;
          captured.push({ pathname: url.pathname, method: response.request().method(), status: response.status() });
        });
        await page.locator('#uni-login-button button').click();
        await page.waitForTimeout(400);
        return captured;
      }`,
      timeoutMs: 6000
    }));

    assertEqual(toolNames.includes('browser_navigate'), true, 'tool browser_navigate');
    assertEqual(toolNames.includes('browser_batch'), true, 'tool browser_batch');
    assertEqual(toolNames.includes('browser_framework_action'), true, 'tool browser_framework_action');
    assertEqual(toolNames.includes('browser_outline'), true, 'tool browser_outline');
    assertEqual(toolNames.includes('browser_search_snapshot'), true, 'tool browser_search_snapshot');
    assertEqual(state.loginStatus, 'Login successful', 'state.loginStatus');
    assertEqual(state.submitStatus, 'Submission successful', 'state.submitStatus');
    assertEqual(state.account, 'demo-user', 'state.account');
    assertEqual(state.password, 'secret-123', 'state.password');
    assertEqual(state.remark, 'http smoke note', 'state.remark');
    assertEqual(state.pickerValue, 'Medical device company', 'state.pickerValue');
    assertEqual(state.region, 'East', 'state.region');
    assertEqual(state.team, 'Sales team 1', 'state.team');
    assertEqual(state.date, '2026-03-11', 'state.date');
    if (!outlineText.includes('Page Outline') || !outlineText.includes('Complex Controls'))
      throw new Error(`Smoke assertion failed for outlineText: ${outlineText}`);
    if (!searchResult.result.includes('Login successful') || searchResult.matchCount < 1)
      throw new Error(`Smoke assertion failed for searchResult: ${JSON.stringify(searchResult)}`);
    if (!runCodeResult.includes('Better Playwright Compare Playground'))
      throw new Error(`Smoke assertion failed for runCodeResult title: ${runCodeResult}`);
    if (!runCodeResult.includes(fixtureBaseUrl))
      throw new Error(`Smoke assertion failed for runCodeResult url: ${runCodeResult}`);
    if (!runCodeAsyncListenerResult.includes('/api/login') || !runCodeAsyncListenerResult.includes('POST'))
      throw new Error(`Smoke assertion failed for runCodeAsyncListenerResult: ${runCodeAsyncListenerResult}`);

    console.log(JSON.stringify({
      fixtureBaseUrl,
      mcpBaseUrl,
      tools: {
        browser_navigate: toolNames.includes('browser_navigate'),
        browser_batch: toolNames.includes('browser_batch'),
        browser_framework_action: toolNames.includes('browser_framework_action'),
        browser_outline: toolNames.includes('browser_outline'),
        browser_search_snapshot: toolNames.includes('browser_search_snapshot'),
      },
      outlineText,
      searchResult,
      state,
      runCodeResult,
      runCodeAsyncListenerResult
    }, null, 2));
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGINT');
    if (child.exitCode === null && child.signalCode === null)
      await new Promise(resolve => child.once('exit', () => resolve(undefined)));
    await new Promise(resolve => fixtureServer.close(() => resolve(undefined)));
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
