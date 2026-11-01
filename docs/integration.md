# Integration Guide

This guide covers runner and application integration and MCP use from IDEs such as Windsurf, Cursor, and VS Code.

## Runtime

`lib/` is the authoritative runtime. Both `mcp` and `server` start `lib/program.js` through `bin/cli.js`. The built-in init-page supplies page enhancements by default; set `BETTER_PLAYWRIGHT_INIT_PAGE` to replace it. Page tools wait for injection before execution, including after opening a tab or navigating.

## Enhanced init-page

`lib/enhanced/init-page-enhanced.js` injects:

- `page.smart.*` for `browser_resilient_action` and fallback operations such as retry, JavaScript clicks and fills, diagnostics, and screenshots.
- `window.__playwrightEnhanced.*` for Uni label actions such as `uni_fill_by_label` in `browser_framework_action`.

The CLI and in-process client load it automatically. To specify a custom module:

```bash
export BETTER_PLAYWRIGHT_INIT_PAGE="/abs/path/to/better-playwright/lib/enhanced/init-page-enhanced.js"
```

When using `mcp-gateway`, set this variable in the route only when replacing the default module.

## Windsurf MCP over stdio

Start from the repository:

```bash
node ./bin/cli.js mcp
```

Windsurf configuration:

```json
{
  "mcpServers": {
    "better-playwright": {
      "command": "node",
      "args": ["/abs/path/to/better-playwright/bin/cli.js", "mcp"],
      "env": {"BETTER_PLAYWRIGHT_HEADLESS": "true"}
    }
  }
}
```

## HTTP server

The `server` command exposes HTTP MCP with the same tools, configuration, and browser startup as stdio mode:

```bash
node ./bin/cli.js server
node ./bin/cli.js server -p 3103
node ./bin/cli.js server --host 127.0.0.1 --port 3103 --chromium --no-user-profile
```

Connect through Streamable HTTP at `http://127.0.0.1:3103/mcp` or compatible SSE at `http://127.0.0.1:3103/sse`.

## In-process client

```js
import { createInProcessClient } from 'better-playwright';

export async function run() {
  const { client, close } = await createInProcessClient({
    headless: false,
    chromium: false
  });

  // Call tools through client.callTool.
  await close();
}
```

`createInProcessClient()` accepts runtime configuration and common flat CLI-style options such as `headless`, `chromium`, and `initPage`.

## Environment

```bash
export BETTER_PLAYWRIGHT_HEADLESS=true
```

`BETTER_PLAYWRIGHT_HEADLESS` controls the initial state. Restart the MCP subprocess after changing it; a later `browser_restart` overrides the startup setting in the current process. The built-in enhanced module loads automatically unless `BETTER_PLAYWRIGHT_INIT_PAGE` specifies a replacement.

For one direct call without a stdio or HTTP service:

```bash
node ./bin/cli.js call browser_navigate '{"url":"https://example.com","mode":"PC"}'
```

This invokes the in-process client and prints JSON.

### Device mode

To require `H5` or `PC` mode before navigation, clicks, fills, or waits:

```bash
export BETTER_PLAYWRIGHT_REQUIRE_DEVICE_MODE=true
```

Start each session with `browser_set_device_mode` and `mode=H5|PC`. Optional default sizes:

```bash
export BETTER_PLAYWRIGHT_DEFAULT_MOBILE_VIEWPORT_SIZE="430,932"
export BETTER_PLAYWRIGHT_DEFAULT_PC_VIEWPORT_SIZE="1440,900"
```

When device mode is required, `BETTER_PLAYWRIGHT_DEFAULT_DEVICE_MODE` is not used as a fallback. Override sizes at runtime with `defaultMobileViewportSize` and `defaultPcViewportSize` in `browser_set_device_mode`.

### Batch operations

`browser_batch` combines steps in one request and reports per-step timing. A typical sequence sets the device mode, navigates, fills with `browser_fill_form` or `browser_framework_action`, checks with `browser_evaluate`, then clicks and waits for the API. Tools requiring init-page injection wait for it after navigation. Snapshot-only tools do not refresh all tab titles unless returning a tab list. Pass `browser_batch.steps[].args` as an object or valid JSON string.

- Navigate to the target origin before using `browser_set_local_storage` or `browser_set_session_storage` to set tokens, permissions, or feature flags.
- `browser_run_code` runs in the Node/Playwright context. Access page objects through `await page.evaluate(() => { ... })`.
- `browser_debug_summary` accepts `consoleLevels=["warning","error"]` and `diagnosticsOnly=true` to reduce noise.
- `browser_take_screenshot(filename=...)` accepts absolute paths. Relative paths preserve subdirectories under the default output directory.
- `browser_outline` compresses a page into an outline; `browser_search_snapshot` searches the current accessibility snapshot with a regular expression.

When the control is known, standard tools accept hints to reduce ambiguous matches:

- `withinTestId`: restrict search to a container's data-testid.
- `containerSelector`: restrict search to a container selector.
- `nearText`: anchor to nearby text in the same row or card.
- `controlType`: button, input, select, checkbox, and similar controls.
- `preferRole`: textbox, combobox, button, spinbutton, and similar roles.

For concurrent instances without profile conflicts:

```bash
export BETTER_PLAYWRIGHT_ISOLATED=true
export BETTER_PLAYWRIGHT_OUTPUT_DIR="/tmp/better-playwright-output"
```

## Local comparison

The repository includes `scripts/fixtures/compare-playground.html` and `scripts/compare-with-official.mjs`:

```bash
node ./scripts/compare-with-official.mjs
```
