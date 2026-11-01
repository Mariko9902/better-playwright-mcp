import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(path.resolve(repoRoot, 'package.json'));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));

const loginUrl = process.env.SMOKE_LOGIN_URL || 'http://localhost:15323/h5/#/';
const addUrl = process.env.SMOKE_ADD_URL || 'http://localhost:15323/h5/#/subPackages/customer/add';
const account = process.env.SMOKE_LOGIN_ACCOUNT || '13128718331';
const password = process.env.SMOKE_LOGIN_PASSWORD || '123456';
const businessType = process.env.SMOKE_BUSINESS_TYPE || '\u533b\u7597\u5668\u68b0\u4f01\u4e1a';
const companyPrefix = process.env.SMOKE_COMPANY_PREFIX || '\u81ea\u52a8\u5316\u6d4b\u8bd5\u5ba2\u6237';
const contactName = process.env.SMOKE_CONTACT_NAME || '\u5f20\u4e09';
const contactTitle = process.env.SMOKE_CONTACT_TITLE || '\u9500\u552e\u7ecf\u7406';
const registerAddress = process.env.SMOKE_REGISTER_ADDRESS || '\u5317\u4eac\u5e02\u671d\u9633\u533a\u6d4b\u8bd5\u8857\u9053123\u53f7';
const detailAddress = process.env.SMOKE_DETAIL_ADDRESS || '\u6d4b\u8bd5\u5927\u53a6A\u5ea715\u5c421501\u5ba4';
const requireDeviceMode = process.env.BETTER_PLAYWRIGHT_REQUIRE_DEVICE_MODE || 'true';

function responseText(result) {
  return (result?.content || []).map(item => item?.text || '').join('\n');
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected))
    throw new Error(`Smoke assertion failed for ${label}: expected to include ${JSON.stringify(expected)} in ${JSON.stringify(text)}`);
}

function uniquePhone() {
  return `13${String(Date.now()).slice(-9)}`;
}

async function main() {
  const phone = uniquePhone();
  const companyName = `${companyPrefix}${Date.now()}`;
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(repoRoot, 'bin/cli.js'), 'mcp'],
    cwd: repoRoot,
    env: {
      ...process.env,
      BETTER_PLAYWRIGHT_INIT_PAGE: path.resolve(repoRoot, 'lib/enhanced/init-page-enhanced.js'),
      BETTER_PLAYWRIGHT_HEADLESS: process.env.BETTER_PLAYWRIGHT_HEADLESS || 'true',
      BETTER_PLAYWRIGHT_ISOLATED: process.env.BETTER_PLAYWRIGHT_ISOLATED || 'true',
      BETTER_PLAYWRIGHT_OUTPUT_DIR: process.env.BETTER_PLAYWRIGHT_OUTPUT_DIR || path.resolve(repoRoot, '.tmp-live-smoke'),
      BETTER_PLAYWRIGHT_REQUIRE_DEVICE_MODE: requireDeviceMode,
    },
    stderr: 'pipe',
  });

  const client = new Client({ name: 'live-login-add-customer-smoke', version: '1.0.0' });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    if (result?.isError)
      throw new Error(`tool ${name} failed:\n${responseText(result)}`);
    return result;
  };

  try {
    await client.connect(transport);
    await client.ping();

    await call('browser_navigate', { url: loginUrl });
    const loginSnapshot = responseText(await call('browser_snapshot'));
    assertIncludes(loginSnapshot, 'checkbox', 'login snapshot checkbox role');
    assertIncludes(loginSnapshot, '\u9605\u8bfb\u5e76\u540c\u610f', 'login snapshot agreement text');

    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u8d26\u53f7', value: account });
    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u5bc6\u7801', value: password });
    await call('browser_fill_label', { label: '\u9605\u8bfb\u5e76\u540c\u610f', value: 'true' });
    await call('browser_click_selector', { selector: '[data-testid="login-submit-btn"]', timeoutMs: 8000 });
    await call('browser_wait_for_any', { text: '\u767b\u5f55\u6210\u529f', timeoutMs: 8000 });
    await call('browser_wait_for_any', { url: 'pages/workbench/index', timeoutMs: 10000 });

    await call('browser_navigate', { url: addUrl });
    await call('browser_wait_for_selector', { selector: '[data-testid="customer-add-input-name"] input', timeoutMs: 8000 });
    await call('browser_fill_selector', { selector: '[data-testid="customer-add-input-name"] input', value: companyName, timeoutMs: 8000 });
    await call('browser_framework_action', {
      action: 'uni_select_field_option_by_label',
      label: '\u7ecf\u8425\u7c7b\u578b',
      optionText: businessType,
      confirmTexts: ['\u786e\u5b9a'],
    });
    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u8054\u7cfb\u4eba', value: contactName });
    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u8054\u7cfb\u4eba\u804c\u52a1', value: contactTitle });
    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u5ba2\u6237\u624b\u673a\u53f7', value: phone });
    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u786e\u8ba4\u624b\u673a\u53f7', value: phone });
    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u6ce8\u518c\u5730\u5740', value: registerAddress });
    await call('browser_framework_action', { action: 'uni_fill_by_label', label: '\u8be6\u7ec6\u5730\u5740', value: detailAddress });
    if (process.env.SMOKE_DEBUG === '1') {
      console.error('PRE_SUBMIT_URL', responseText(await call('browser_get_url')));
      console.error('PRE_SUBMIT_SNAPSHOT', responseText(await call('browser_snapshot')));
    }
    await call('browser_wait_for_selector', { selector: '[data-testid="customer-add-btn-submit"]', state: 'attached', timeoutMs: 8000 });
    await call('browser_click_selector', { selector: '[data-testid="customer-add-btn-submit"]', force: true, timeoutMs: 8000 });
    await call('browser_wait_for_any', { text: '\u6dfb\u52a0\u6210\u529f', timeoutMs: 10000 });
    if (process.env.SMOKE_DEBUG === '1') {
      console.error('POST_SUBMIT_URL', responseText(await call('browser_get_url')));
      console.error('POST_SUBMIT_SNAPSHOT', responseText(await call('browser_snapshot')));
    }
    await call('browser_wait_for_url_contains', { contains: 'add-success', timeoutMs: 10000 });

    const finalUrl = responseText(await call('browser_get_url'));
    assertIncludes(finalUrl, 'add-success', 'final url add-success');

    console.log(JSON.stringify({
      loginUrl,
      addUrl,
      phone,
      companyName,
      finalUrl,
      assertions: {
        loginSnapshotHasCheckbox: true,
        loginSnapshotHasAgreementText: true,
        addCustomerSucceeded: true,
      },
    }, null, 2));
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
