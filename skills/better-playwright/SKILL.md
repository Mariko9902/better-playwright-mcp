---
name: better-playwright
description: Use better-playwright browser automation safely for complex web, H5, Uni-app, Element Plus, login flows, dynamic pages, screenshots, API waits, batch actions, and CLI or long-running service calls.
compatibility: Requires the better-playwright CLI or service runtime and a Playwright-compatible browser environment.
metadata:
  version: "1.0"
---

# Better Playwright

Use this skill when automating browser work with better-playwright tools, especially on dynamic pages, mobile H5 apps, framework controls, multi-step forms, login flows, screenshots, and API-driven state transitions.

This skill covers tool choice and execution strategy across long-running services, HTTP / stdio transport, in-process clients, and `bin/cli.js call ...`.

## Core Workflow

1. Set the device mode first when viewport or H5 behavior matters: `browser_set_device_mode`.
2. Navigate before mutating browser context: `browser_navigate`.
3. When using cookies for login, reach the target origin before calling `browser_set_cookies`.
4. Wait for a stable condition before interacting: `browser_wait_for_any`, `browser_wait_for_text`, `browser_wait_for_selector`, or `browser_wait_for_url_contains`.
5. Inspect the page when unsure: `browser_snapshot` or `browser_outline`.
6. Prefer stable actions: `browser_fill_form`, `browser_click_text`, `browser_click`, `browser_click_and_wait_for_api`.
7. Escalate only when needed: `browser_framework_action`, `browser_batch`, `browser_resilient_action`, then `browser_run_code`.

## Enhanced Runtime

The bundled enhanced runtime is enabled by default. It injects `page.smart.*` and `window.__playwrightEnhanced.*`, then exposes higher-level browser tools for retry, waiting, framework controls, diagnostics, and screenshots.

Only override `BETTER_PLAYWRIGHT_INIT_PAGE` when replacing the bundled enhanced runtime with a custom init script.

## Choosing Tools

- Use `browser_click_text` as a primary path for mobile text-click areas, agreement text, tabs, action sheets, and bottom-sheet options.
- Use `browser_click_and_wait_for_api` when clicking starts an API request; it installs the listener before the click.
- Use `browser_wait_for_any` when any one of text, selector, URL, or text disappearance can prove readiness.
- Use `browser_framework_action` for Uni-app, Element Plus, picker, tree, date, and custom overlay controls.
- Use `browser_batch` for short, well-understood flows where dependencies are explicit.
- Use `browser_debug_summary` first after failures; it summarizes console, network, and common route / asset issues.

## References

- Read [workflow.md](references/workflow.md) for detailed selector rules, waiting rules, batch semantics, diagnostics, and failure recovery.
- Read [cli.md](references/cli.md) when invoking tools directly from a shell instead of through an agent tool surface.
