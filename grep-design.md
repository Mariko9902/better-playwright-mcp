# Raw grep Guide for LLMs

## Tool interface
```typescript
grepSnapshot(pattern: string, flags?: string): string
```

Example: grepSnapshot("button:", "-i -C 2")

## Basic grep usage

### Common flags
- `-i` Ignore case
- `-n` Show line numbers
- `-C N` Show N lines of context before and after
- `-B N` Show N preceding lines
- `-A N` Show N following lines
- `-E` Use extended regular expressions
- `-m N` Return at most N matches

## Search pattern examples

### Find elements

Search box
```bash
grepSnapshot("searchbox")
grepSnapshot("textbox.*search", "-i -E")
```

Button
```bash
grepSnapshot("button:")
grepSnapshot("button:.*login", "-E")
```

Links
```bash
grepSnapshot("link:")
```

Form
```bash
grepSnapshot("form:")
grepSnapshot("textbox.*required", "-E")
```

### Find attributes

Disabled elements
```bash
grepSnapshot("\\[disabled\\]")
```

Required fields
```bash
grepSnapshot("\\[required\\]")
```

Expanded elements
```bash
grepSnapshot("\\[expanded\\]")
```

### Using context

Get buttons and two lines of context
```bash
grepSnapshot("button:", "-C 2")
```

Get the form and the following 10 lines
```bash
grepSnapshot("form:", "-A 10")
```

Include line numbers
```bash
grepSnapshot("navigation:", "-n")
```

## Task examples

### Task: "Search for a curling iron"

1. Find the search box
```bash
grepSnapshot("searchbox", "-n")
```

Or
```bash
grepSnapshot("textbox.*search", "-i -E -n")
```

2. Find the search button
```bash
grepSnapshot("button:.*search", "-i -E")
```

### Task: "Find the product with the most reviews"

1. Find review counts
```bash
grepSnapshot("[0-9]+ review", "-E")
```

2. Find product links or headings
```bash
grepSnapshot("link:", "-C 2")
grepSnapshot("heading:", "-C 2")
```

### Task: "Log in"

1. Find the username input
```bash
grepSnapshot("textbox.*user|email", "-i -E")
```

2. Find the password input
```bash
grepSnapshot("textbox.*password", "-i -E")
```

3. Find the login button
```bash
grepSnapshot("button.*login|sign in", "-i -E")
```

## Practical tips

1. **Use a pipeline**：Filter broadly, then narrow the results

   First find the form

   ```bash
   grepSnapshot("form:", "-A 20")
   ```

   Search within the result for the desired element

2. **Use indentation to understand hierarchy**

   Top-level elements

   ```bash
   grepSnapshot("^- navigation", "-E")
   ```

   Second-level elements (two spaces)

   ```bash
   grepSnapshot("^  - list", "-E")
   ```

3. **Multiple keywords**

   OR relationship

   ```bash
   grepSnapshot("login\\|login\\|sign in", "-i -E")
   ```

   Match multiple words

   ```bash
   grepSnapshot("button.*submit", "-E")
   ```

## Choose a grep strategy

| Task | grep pattern | flags |
|---------|-----------|-------|
| Find a role | `"role:"` | `-n` |
| Find text | `".*text.*"` | `-i -E` |
| Find an attribute | `"\\[attr\\]"` | |
| Get context | Any | `-C 3` |
| Find the first match | Any | `-m 1` |
| Search within a region | Find the region first | `-A 10` |

These patterns can be combined as needed.
