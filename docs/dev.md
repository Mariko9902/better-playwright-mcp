# Development Guide

This guide is for maintainers and contributors.

## 0. Prerequisites

- Node.js >= 18
- Chrome or Chromium installed locally

## 1. Install dependencies

In the repository directory:

```bash
npm install
```

## 2. Build and run

Build and check TypeScript:

```bash
npm run build
```

Start MCP over stdio:

```bash
node ./bin/cli.js mcp
```

Call a single tool without a separate service:

```bash
node ./bin/cli.js call browser_navigate '{"url":"https://example.com","mode":"PC"}'
```

Start the HTTP server:

```bash
node ./bin/cli.js server
```

Start development mode with watch:

```bash
npm run dev
```

## 3. Project structure

- `lib/`: authoritative built runtime
- `bin/cli.js`: CLI entry point
- `lib/enhanced/init-page-enhanced.js`: default enhanced module; injects `page.smart.*` and `window.__playwrightEnhanced.*` for `browser_framework_action`
- `src/`: source code; `npm run build` compiles it into `lib/`

After editing `src/`, run `npm run build` and restart the MCP process. Both `bin/cli.js mcp` and `bin/cli.js server` use `lib/program.js`; the server command selects HTTP MCP transport. `bin/cli.js call` uses the in-process client without starting a separate MCP service.

The built-in enhanced module loads automatically. Set `BETTER_PLAYWRIGHT_INIT_PAGE` only to replace it. Page tools wait for init-page injection; when diagnosing failures, check gateway and environment configuration before attributing the first enhanced tool failure to a slow page.

## 4. Troubleshooting

- Port already in use: `node ./bin/cli.js server -p 3103`
- Enable verbose logging: `DEBUG=* node ./bin/cli.js mcp`
- Default HTTP MCP endpoint: `http://localhost:3102/mcp`
- Custom enhanced module: `BETTER_PLAYWRIGHT_INIT_PAGE=/abs/path/to/custom-init-page.js node ./bin/cli.js mcp`
