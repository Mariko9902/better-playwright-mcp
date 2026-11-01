import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(path.resolve(repoRoot, 'package.json'));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));

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
const port = Number(process.env.SMOKE_PORT || await findFreePort());
const fixtureBaseUrl = `http://127.0.0.1:${port}`;

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

function assertIncludes(text, expected, label) {
  if (!text.includes(expected))
    throw new Error(`Smoke assertion failed for ${label}: expected to include ${JSON.stringify(expected)} in ${JSON.stringify(text)}`);
}

function extractRefForRole(snapshotText, role) {
  const lines = snapshotText.split('\n');
  for (const line of lines) {
    if (!line.includes(`[ref=`) || !line.includes(role))
      continue;
    const match = line.match(/\[ref=([^\]]+)\]/);
    if (match)
      return match[1];
  }
  throw new Error(`Unable to extract ref for role=${role} from snapshot`);
}

async function main() {
  const server = createFixtureServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(repoRoot, 'bin/cli.js'), 'mcp'],
    cwd: repoRoot,
    env: {
      ...process.env,
      BETTER_PLAYWRIGHT_INIT_PAGE: path.resolve(repoRoot, 'lib/enhanced/init-page-enhanced.js'),
      BETTER_PLAYWRIGHT_HEADLESS: 'true',
      BETTER_PLAYWRIGHT_ISOLATED: 'true',
      BETTER_PLAYWRIGHT_OUTPUT_DIR: path.resolve(repoRoot, '.tmp-batch-smoke'),
    },
    stderr: 'pipe',
  });

  const client = new Client({ name: 'batch-smoke', version: '1.0.0' });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    if (result?.isError)
      throw new Error(`tool ${name} failed:\n${responseText(result)}`);
    return result;
  };
  const callAllowError = async (name, args = {}) => {
    return await client.callTool({ name, arguments: args });
  };

  try {
    await client.connect(transport);
    await client.ping();

    const toolList = await client.listTools();
    const toolNames = toolList.tools.map(tool => tool.name);

    const batchResult = await call('browser_batch', {
      includeSnapshot: false,
      steps: [
        { id: 'nav', tool: 'functions.browser_navigate', args: { url: fixtureBaseUrl, mode: 'PC' } },
        { id: 'fillAccount', tool: 'browser_framework_action', dependsOn: ['nav'], args: { action: 'uni_fill_by_label', label: 'Account', value: 'demo-user' } },
        { id: 'fillPassword', tool: 'browser_framework_action', dependsOn: ['nav'], args: { action: 'uni_fill_by_label', label: 'Password', value: 'secret-123' } },
        { id: 'fillRemark', tool: 'browser_framework_action', dependsOn: ['nav'], args: { action: 'uni_textarea', value: 'batch note' } },
        { id: 'login', tool: 'browser_click_and_wait_for_api', dependsOn: ['fillAccount', 'fillPassword'], args: { element: 'Login button', selector: '#uni-login-button button', urlPattern: '/api/login', method: 'POST', timeoutMs: 6000 } },
        { id: 'loginDone', tool: 'functions.browser_wait_for_any', dependsOn: ['login'], args: { text: 'Login successful', timeoutMs: 4000 } },
        { id: 'picker', tool: 'browser_framework_action', dependsOn: ['loginDone'], args: { action: 'uni_select_field_option_by_label', label: 'Business type', optionText: 'Medical device company', confirmTexts: ['Confirm'] } },
        { id: 'region', tool: 'browser_framework_action', dependsOn: ['loginDone'], args: { action: 'el_select', selector: '#region-select', optionText: 'East' } },
        { id: 'team', tool: 'browser_framework_action', dependsOn: ['loginDone'], args: { action: 'el_tree_select', selector: '#team-select', optionText: 'Sales team 1' } },
        { id: 'date', tool: 'browser_framework_action', dependsOn: ['loginDone'], args: { action: 'el_date_picker', selector: '.el-date-editor', value: '2026-03-11' } },
        { id: 'submit', tool: 'browser_click_and_wait_for_api', dependsOn: ['picker', 'region', 'team', 'date'], args: { element: 'Submit button', selector: '#final-submit', urlPattern: '/api/submit', method: 'POST', timeoutMs: 6000 } },
        { id: 'submitDone', tool: 'browser_wait_for_any', dependsOn: ['submit'], args: { text: 'Submission successful', timeoutMs: 4000 } },
      ],
    });
    const batchText = responseText(batchResult);
    const outlineText = responseText(await call('browser_outline'));
    const searchResult = parseResultJson(await call('browser_search_snapshot', {
      pattern: 'Submission successful',
      lineLimit: 5,
    }));

    const snapshotText = responseText(await call('browser_snapshot'));
    const textboxRef = extractRefForRole(snapshotText, 'textbox');
    await call('browser_fill_ref', {
      element: 'Account input',
      ref: textboxRef,
      value: 'demo-user-ref',
    });

    const failureBatchResult = await callAllowError('browser_batch', {
      includeSnapshot: false,
      continueOnError: true,
      steps: [
        { id: 'badClick', tool: 'browser_click_selector', args: { selector: '#missing-button', timeoutMs: 50 } },
        { id: 'blockedWait', tool: 'browser_wait_for_any', dependsOn: ['badClick'], args: { text: 'Login successful', timeoutMs: 200 } },
        { id: 'goodWait', tool: 'functions.browser_wait_for_any', args: { text: 'Submission successful', timeoutMs: 1000 } },
      ],
    });
    const failureBatchText = responseText(failureBatchResult);

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
        date: document.querySelector('#date-input')?.value || '',
        submittedAccount: window.__compareLastSubmit?.data?.account || ''
      })`,
    }));

    const runCodeResult = responseText(await call('browser_run_code', {
      code: `async (page) => ({ title: await page.title(), url: page.url() })`,
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
      timeoutMs: 6000,
    }));

    assertEqual(toolNames.includes('browser_navigate'), true, 'tool browser_navigate');
    assertEqual(toolNames.includes('browser_type'), true, 'tool browser_type');
    assertEqual(toolNames.includes('browser_set_viewport_size'), true, 'tool browser_set_viewport_size');
    assertEqual(toolNames.includes('browser_run_code'), true, 'tool browser_run_code');
    assertEqual(toolNames.includes('browser_outline'), true, 'tool browser_outline');
    assertEqual(toolNames.includes('browser_search_snapshot'), true, 'tool browser_search_snapshot');

    assertEqual(state.loginStatus, 'Login successful', 'state.loginStatus');
    assertEqual(state.submitStatus, 'Submission successful', 'state.submitStatus');
    assertEqual(state.account, 'demo-user-ref', 'state.account');
    assertEqual(state.password, 'secret-123', 'state.password');
    assertEqual(state.remark, 'batch note', 'state.remark');
    assertEqual(state.pickerValue, 'Medical device company', 'state.pickerValue');
    assertEqual(state.region, 'East', 'state.region');
    assertEqual(state.team, 'Sales team 1', 'state.team');
    assertEqual(state.date, '2026-03-11', 'state.date');
    assertEqual(state.submittedAccount, 'demo-user', 'state.submittedAccount');
    assertIncludes(batchText, 'step[0] id=nav tool=browser_navigate status=ok', 'batch nav summary');
    assertIncludes(batchText, 'dependsOn=["fillAccount","fillPassword"]', 'batch dependsOn summary');
    assertIncludes(batchText, 'batch_step_summary:', 'batch summary header');
    assertIncludes(outlineText, 'Page Outline', 'outline header');
    assertIncludes(outlineText, 'Complex Controls', 'outline content');
    assertEqual(searchResult.matchCount > 0, true, 'searchResult.matchCount > 0');
    assertIncludes(searchResult.result, 'Submission successful', 'searchResult.result');
    assertEqual(failureBatchResult?.isError, true, 'failureBatchResult.isError');
    assertIncludes(failureBatchText, 'step[0] id=badClick tool=browser_click_selector status=failed', 'failure batch failed summary');
    assertIncludes(failureBatchText, 'step[1] id=blockedWait tool=browser_wait_for_any status=skipped', 'failure batch skipped summary');
    assertIncludes(failureBatchText, 'step[2] id=goodWait tool=browser_wait_for_any status=ok', 'failure batch ok summary');
    if (!runCodeResult.includes('Better Playwright Compare Playground'))
      throw new Error(`Smoke assertion failed for runCodeResult title: ${runCodeResult}`);
    if (!runCodeResult.includes(fixtureBaseUrl))
      throw new Error(`Smoke assertion failed for runCodeResult url: ${runCodeResult}`);
    if (runCodeResult.includes('[error]') || runCodeResult.includes('[ERROR]'))
      throw new Error(`Smoke assertion failed for runCodeResult console errors: ${runCodeResult}`);
    assertIncludes(runCodeAsyncListenerResult, '/api/login', 'runCodeAsyncListenerResult login api');
    assertIncludes(runCodeAsyncListenerResult, 'POST', 'runCodeAsyncListenerResult method');

    const summary = {
      fixtureBaseUrl,
      tools: {
        browser_navigate: toolNames.includes('browser_navigate'),
        browser_type: toolNames.includes('browser_type'),
        browser_set_viewport_size: toolNames.includes('browser_set_viewport_size'),
        browser_run_code: toolNames.includes('browser_run_code'),
        browser_outline: toolNames.includes('browser_outline'),
        browser_search_snapshot: toolNames.includes('browser_search_snapshot'),
      },
      outlineText,
      searchResult,
      state,
      batchText,
      failureBatchText,
      runCodeResult,
      runCodeAsyncListenerResult,
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await new Promise(resolve => server.close(() => resolve()));
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
