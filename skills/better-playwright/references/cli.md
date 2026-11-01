# CLI Reference

Use the CLI to invoke a single tool directly without starting a separately managed service.

## Single Tool Call

Run from the repository root:

```bash
node ./bin/cli.js call browser_navigate '{"url":"https://example.com","mode":"PC"}'
```

For local mobile / H5 pages, set device mode explicitly:

```bash
node ./bin/cli.js call browser_batch '{
  "steps": [
    {
      "id": "mode",
      "tool": "browser_set_device_mode",
      "args": { "mode": "H5" }
    },
    {
      "id": "nav",
      "tool": "browser_navigate",
      "dependsOn": ["mode"],
      "args": { "url": "http://127.0.0.1:15324/gjk-h5/mobile/account/login#/pages/login/index", "mode": "H5" }
    },
    {
      "id": "wait",
      "tool": "browser_wait_for_any",
      "dependsOn": ["nav"],
      "args": { "text": "Enter phone number" }
    }
  ]
}'
```

## Headed Browser

Use a headed browser to watch the automation:

```bash
node ./bin/cli.js call browser_navigate '{"url":"https://example.com","mode":"PC"}' --headed
```

Use `--no-user-profile` for a clean browser profile when stored state would interfere with the test.

## Parameter Visibility

This skill guides tool selection and common argument formats, but does not define the protocol schema. For exact, machine-readable parameters, use a CLI schema or describe command if available, or inspect tool source before generating large batches.

## Quoting Rules

- Pass the tool arguments as one JSON object.
- Use single quotes around JSON in `zsh` / `bash`.
- Escape inner quotes when the command is embedded in another JSON string.
- Use `browser_batch` for larger flows only when each step has a clear success condition.
