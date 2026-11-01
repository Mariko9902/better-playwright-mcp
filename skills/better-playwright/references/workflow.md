# Better Playwright Workflow Reference

## Scope and purpose

Use the enhanced tools for dynamic pages, framework controls, and multi-step flows. Avoid fragile locators and fallback code while page state is uncertain. These tool-selection rules apply to long-running services, HTTP and stdio, in-process clients, and single `bin/cli.js call ...` invocations.

The bundled init-page enables `page.smart.*` and `window.__playwrightEnhanced.*` by default. The enhanced tools add waiting, retries, framework controls, diagnostics, and screenshots on top of standard browser actions. Set `BETTER_PLAYWRIGHT_INIT_PAGE` only to replace the bundled module.

## Enhanced tools

- `browser_set_device_mode`: set `H5` or `PC` and the default viewport policy.
- `browser_set_cookies`: write cookies into the current context; navigate to the target origin first. Do not pass `path` together with `url`.
- `browser_batch`: combine steps with `id`, `dependsOn`, retries, and diagnostics. Prefer objects for `steps[].args`; valid JSON strings are supported.
- `browser_framework_action`: operate Uni-app, Element Plus, and custom controls.
- `browser_click_and_wait_for_api`: install the API listener before clicking.
- `browser_wait_for_any`: wait for text, text disappearance, selector, or URL. A timeout fails unless `allowTimeout: true` is set.
- `browser_resilient_action`: click, fill, JavaScript fallback, diagnose, and smart screenshots.
- `browser_debug_summary`: inspect console and network tails plus common routing and asset diagnostics.
- `browser_take_screenshot`: accepts absolute paths and preserves subdirectories in relative paths.

## Before each call

Assess page state (loading, stable, recently changed, or waiting after submission), locator confidence (test ID or selector, role and name with hints, ref, or natural-language guess), and the expected transition (API, text, URL, dialog, or local DOM change). Choose the tool based on all three.

## Default sequence

1. Set device mode with `browser_set_device_mode`.
2. Navigate to the target origin.
3. If a fixed login state is required, set cookies, then navigate again.
4. Wait with `browser_wait_for_any`, inspect with `browser_snapshot`, and act with `browser_fill_form`, `browser_click_text`, `browser_click`, or `browser_click_and_wait_for_api`.
5. If needed, escalate to `browser_framework_action`, `browser_batch`, `browser_resilient_action`, or `browser_run_code`.

## Locators and standard tools

On a stable page with a unique target, prefer test ID, selector, role and name, `browser_click_text`, ref, then natural-language `element` in that order. On mobile pages where text itself is clickable, `browser_click_text` is a primary tool. It searches open listbox, menu, or dialog overlays before falling back to the full page.

Use `browser_click_text` for agreement text, tabs, action sheets, bottom sheets, mobile card actions, and clickable blocks without stable roles or selectors. Do not assume these are standard checkboxes or buttons.

Role names accept regular-expression strings in `/pattern/flags` form. Use a regex when whitespace or line breaks may vary. For Chinese names without spaces, the implementation also tolerates whitespace between characters.

## Framework controls and forms

Use `browser_framework_action` for Uni-app, Element Plus selectors, trees and dates, and custom pickers or overlays. Common actions include `uni_fill`, `uni_fill_by_label`, `uni_click_field_by_label`, `uni_select_field_option_by_label`, `el_select`, `el_tree_select`, and `el_date_picker`.

Use `browser_select_option` for native selects and `browser_fill_form` for multiple fields. Verify critical values with `browser_evaluate` after filling. Use `browser_file_upload(paths=[...])` after a file chooser opens; do not fill file inputs as ordinary fields.

Example:

```json
{
  "action": "uni_select_field_option_by_label",
  "label": "Business type",
  "optionText": "Sole proprietor",
  "confirmTexts": ["Confirm", "OK", "Done"]
}
```

## Batches

Use `browser_batch` for short flows with explicit dependencies and understandable success conditions, to reduce round trips. Avoid large state transitions, flows needing frequent snapshots, or unstable pages.

1. Usually start with `browser_set_device_mode`.
2. Pass `steps[].args` as an object, or valid JSON if the bridge requires a string.
3. Parallelize only explicitly safe read-only steps. Keep the default stop-on-error behavior for dependent flows unless `continueOnError` is needed.
4. Inspect `batch_step_summary` first. Failed steps normally include snapshot and diagnostics for console, network, and screenshots.

Common mistakes include skipping device mode, setting cookies before opening the origin, incorrect `dependsOn` IDs, running state-changing steps in parallel, invalid `args`, and packing unrelated operations into one batch.

Result states: `ok` means success, `failed` means failure, `skipped` means a dependency failed, and `not_run` means scheduling stopped after an earlier failure. Inspect the failed step's diagnostics as well as the summary.

Minimal batch:

```json
{
  "steps": [
    {
      "id": "mode",
      "tool": "browser_set_device_mode",
      "args": { "mode": "PC" }
    },
    {
      "id": "nav",
      "tool": "browser_navigate",
      "dependsOn": ["mode"],
      "args": { "url": "http://127.0.0.1:5888/login", "mode": "PC" }
    },
    {
      "id": "wait",
      "tool": "browser_wait_for_any",
      "dependsOn": ["nav"],
      "args": { "text": "Username" }
    },
    {
      "id": "snap",
      "tool": "browser_snapshot",
      "dependsOn": ["wait"]
    }
  ]
}
```

A login and identity-switching flow can use explicit dependencies:

```json
{
  "steps": [
    {
      "id": "nav",
      "tool": "browser_navigate",
      "args": { "url": "http://127.0.0.1:5888/login", "mode": "H5" }
    },
    {
      "id": "waitLogin",
      "tool": "browser_wait_for_any",
      "dependsOn": ["nav"],
      "args": { "text": "Enter phone number" }
    },
    {
      "id": "fillPhone",
      "tool": "browser_fill_form",
      "dependsOn": ["waitLogin"],
      "args": {
        "fields": [
          { "name": "Phone number", "type": "spinbutton", "role": "spinbutton", "value": "18700001111" }
        ]
      }
    },
    {
      "id": "fillPassword",
      "tool": "browser_fill_form",
      "dependsOn": ["waitLogin"],
      "args": {
        "fields": [
          { "name": "Password", "type": "textbox", "role": "textbox", "value": "123456" }
        ]
      }
    },
    {
      "id": "agree",
      "tool": "browser_click_text",
      "dependsOn": ["fillPhone", "fillPassword"],
      "args": { "text": "I have read and agree" }
    },
    {
      "id": "login",
      "tool": "browser_click_text",
      "dependsOn": ["agree"],
      "args": { "text": "Log in", "exact": true }
    },
    {
      "id": "waitMine",
      "tool": "browser_wait_for_any",
      "dependsOn": ["login"],
      "args": { "text": "Switch identity · Current: user" }
    },
    {
      "id": "openSwitch",
      "tool": "browser_click_text",
      "dependsOn": ["waitMine"],
      "args": { "text": "Switch identity · Current: user" }
    },
    {
      "id": "pickManager",
      "tool": "browser_click_text",
      "dependsOn": ["openSwitch"],
      "args": { "text": "Account manager", "exact": true }
    }
  ]
}
```

## Drag and drop

`browser_drag` first tries Playwright's native `dragTo`. For pointer-event-driven controls such as `dnd-kit`, it falls back to mouse events. If complex drag operations remain unstable, use `browser_run_code` with `mouse.move`, `mouse.down`, and `mouse.up`.

## Waiting

Choose a wait based on the expected transition:

- API request: `browser_click_and_wait_for_api` or `browser_wait_for_api`.
- Any of text, selector, or URL: `browser_wait_for_any`.
- A single condition: `browser_wait_for_selector`, `browser_wait_for_text`, or `browser_wait_for_url_contains`.
- Fixed delays: use only when no better condition is available.

`browser_wait_for_any` and `browser_wait_for_api` fail on timeout by default. Set `allowTimeout: true` for a soft timeout; otherwise the step fails inside a batch. `browser_click_and_wait_for_api` also supports `allowTimeout`. To wait for text to disappear, pass `textGone` to `browser_wait_for_any`.

Avoid clicking first and then calling `browser_wait_for_api`: the response may arrive before the listener is installed. Prefer `browser_click_and_wait_for_api`, which starts listening before the click.

## Ref lifetime

Use a ref immediately after a snapshot. Opening a dialog, dropdown, picker, changing tabs, searching, paginating, submitting, or refreshing a list can invalidate old refs. If a ref is missing, the page has rerendered, or the DOM may have changed, wait with `browser_wait_for_any` and take a fresh `browser_snapshot` before continuing. Treat a failed ref after opening an overlay as potentially stale instead of repeatedly clicking it.

## Hints

Use `withinTestId`, `containerSelector`, `nearText`, `controlType`, and `preferRole` to narrow ambiguous targets. Add hints to `browser_click`, `browser_fill_form`, and `browser_fill_ref` on complex pages before escalating to a heavier tool.

## Recovery and evidence

1. Inspect `browser_debug_summary`.
2. Handle blocking alerts, confirms, or prompts with `browser_handle_dialog`.
3. Wait with `browser_wait_for_any` if the page is not ready.
4. Take a fresh `browser_snapshot` if refs may be stale.
5. Use `browser_framework_action` for framework controls, `browser_resilient_action` for failed ordinary clicks or fills, and finally `browser_run_code` if needed.

Use `browser_take_screenshot` for routine evidence and `browser_resilient_action(action=smart_screenshot)` or `diagnose` for failures. Absolute screenshot paths can be used for direct archival.

In addition to `console_tail` and `network_tail`, inspect `diagnostics` from `browser_debug_summary`:

- `auth_redirect_detected`: the page may have redirected to authentication before the application rendered.
- `router_basename_mismatch`: React Router basename does not match the current URL.
- `asset_path_mismatch`: a JS or CSS request returned 404, HTML, or plaintext.

Check the router basename, frontend base path, local proxy target, and whether the proxy strips or rewrites the application subpath.
