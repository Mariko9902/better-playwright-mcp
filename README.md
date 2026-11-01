# better-playwright

A high-performance Playwright browser automation tool supporting MCP, HTTP, and in-process clients.

## Features

- Playwright browser automation over stdio MCP, HTTP MCP, and in-process transports.
- Multiple locator strategies: refs, test IDs, selectors, role and name, and semantic fallback.
- Optional hints such as `withinTestId`, `containerSelector`, `nearText`, `controlType`, and `preferRole` for known controls.
- Ripgrep-based search with `browser_search_snapshot` and legacy HTTP `searchSnapshot()`.
- Persistent browser profiles, intelligent list folding, compressed outlines with `browser_outline`, and semantic HTML snapshots.
- Batch execution to reduce round trips in multi-step flows.

## Installation

This repository is a substantially modified fork. Installation from an npm registry is neither provided nor recommended. The following commands use the local repository.

### Global link

In the repository directory:

```bash
npm link
```

Then run:

```bash
better-playwright
better-playwright server -p 3102
```

### Install by path

For a runner or application, add a file dependency to the project's `package.json`:

```json
{
  "dependencies": {
    "better-playwright": "file:/abs/path/to/better-playwright"
  }
}
```

Install dependencies in that project:

```bash
npm install
```

## Quick start

### Start MCP over stdio

```bash
node ./bin/cli.js mcp
```

The bundled enhanced init-page loads automatically. Set `BETTER_PLAYWRIGHT_INIT_PAGE` only to replace it with a custom module.

### Start the HTTP MCP server

The `server` command uses the same backend as stdio `mcp` with HTTP transport at `/mcp` and compatibility with `/sse`:

```bash
node ./bin/cli.js server -p 3102 --host localhost
```

### Call a single tool

Call a tool directly without a separate service:

```bash
node ./bin/cli.js call browser_navigate '{"url":"https://example.com","mode":"PC"}'
```

Batch calls are also supported:

```bash
node ./bin/cli.js call browser_batch '{"steps":[{"tool":"browser_set_device_mode","args":{"mode":"PC"}},{"tool":"browser_navigate","args":{"url":"https://example.com"}},{"tool":"browser_outline","args":{}}],"includeSnapshot":true}'
```

`call` uses the in-process client, loads the built-in enhanced init-page by default, and prints JSON to stdout.

### Windsurf configuration

Use a single MCP entry and switch between headed and headless modes at runtime with `browser_restart`:

```json
{
  "mcpServers": {
    "better-playwright": {
      "command": "node",
      "args": [
        "/abs/path/to/better-playwright/bin/cli.js",
        "mcp"
      ],
      "env": {
        "BETTER_PLAYWRIGHT_HEADLESS": "true"
      }
    }
  }
}
```

The built-in enhanced module injects `page.smart.*` for retries, JavaScript fallback, and diagnostics, and `window.__playwrightEnhanced.*` for Uni label operations in `browser_framework_action`. Page tools wait for injection before execution. `BETTER_PLAYWRIGHT_HEADLESS` sets the initial value; restart the MCP process after changing it.

### Connect through mcp-gateway

For an IDE or platform using `mcp-gateway`, connect Windsurf to the gateway and let it start `better-playwright`. Specify the command, arguments, working directory, and environment rather than relying on fallback discovery:

```yaml
routes:
  better-playwright:
    type: local
    command: /abs/path/to/node
    working_dir: /abs/path/to/better-playwright
    args:
      - /abs/path/to/better-playwright/bin/cli.js
      - mcp
    env:
      BETTER_PLAYWRIGHT_HEADLESS: "true"
```

Use the repository root as `working_dir` to keep relative paths stable. The gateway URL is typically `http://<gateway-host>:<port>/mcps/better-playwright`. If the enhanced runtime is missing, check whether the route fell back to automatic discovery. Set `BETTER_PLAYWRIGHT_INIT_PAGE` only for a custom replacement.

### Device mode

Set `BETTER_PLAYWRIGHT_REQUIRE_DEVICE_MODE=true` to require `browser_set_device_mode` before navigation, clicks, fills, waits, and other browser tools. Begin the session with `browser_set_device_mode` using `mode=H5` or `mode=PC`.

Optional default viewports:

- `BETTER_PLAYWRIGHT_DEFAULT_MOBILE_VIEWPORT_SIZE="430,932"`
- `BETTER_PLAYWRIGHT_DEFAULT_PC_VIEWPORT_SIZE="1440,900"`

To change modes at runtime, call `browser_restart` with `headless=false` for a visible browser or `headless=true` for a headless browser. This overrides the startup default for the current process. After switching to headless mode, call `browser_restart(headless=false)` or restart the process to show the browser again.

### Workflow

See `.windsurf/workflows/better-playwright.md` and `skills/better-playwright/SKILL.md` for tool selection and execution guidance.

### Batch operations

Use `browser_batch` for flows such as setting the device mode, navigating, filling, validating, and submitting. Destructive steps run serially to avoid focus conflicts and races; read-only steps may run concurrently after their dependencies, subject to `maxConcurrency`. Results include per-step timing.

- Prefer fewer round trips, validation after writes, and local fallback over concurrent input actions.
- Usually start the batch with `browser_set_device_mode`.
- Snapshot-only operations do not refresh all tab titles unless the tab list is requested.
- Pass `browser_batch.steps[].args` as an object or a valid JSON string.

### Diagnostics and evidence

- On failure, start with `browser_resilient_action(action=diagnose)`.
- Use `browser_resilient_action(action=smart_screenshot)` or `browser_take_screenshot` for screenshots.
- A failed `browser_batch` can include a snapshot and diagnostics.
- `browser_debug_summary(consoleLevels=["warning","error"])` filters console messages; `diagnosticsOnly=true` limits output to the URL and inferred diagnostics.
- `browser_take_screenshot(filename=...)` accepts absolute paths. Relative paths retain their directory structure under the default output directory.

`browser_set_local_storage` and `browser_set_session_storage` write to the current origin and can set local login state. `browser_run_code` runs in the Node/Playwright context; access `window`, `document`, `localStorage`, or `sessionStorage` through `page.evaluate(...)`.

## Documentation

- Integration, runtime modes, and environment: `docs/integration.md`
- Development and maintenance: `docs/dev.md`
