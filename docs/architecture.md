# Better Playwright Architecture

## Overview

Better Playwright compresses the DOM into page context that an AI can understand.

## Workflow

```text
Page DOM (5,000+ lines)
    ↓
Outline generation
    ↓
Compressed structure (< 500 lines)
    ↓
Search
    ↓
Precise element location
```

## Outline generation

### 1. Unwrap unnecessary nesting

Implementation: `src/utils/remove-useless-wrappers.ts`.

1. Remove empty generic nodes where `type === 'generic' && children.length === 0 && !content`.
2. Replace generic nodes with their only child when `type === 'generic' && children.length === 1`.

This removes approximately 2,300 generic nodes and reduces nesting by more than 50%.

### 2. Truncate text

Implementation: `SmartOutlineSimple.formatNode()`.

Keep at most 50 characters per text node, append `...` when truncated, and retain the complete ref and interaction markers.

### 3. Detect and fold lists

Implementation: `src/utils/list-detector.ts`.

Semantic lists consist of consecutive `listitem` elements. Structural lists use SimHash with a Hamming distance threshold of 3 and require at least three similar elements.

```text
- listitem "First sample"
- listitem (... and 37 more similar) [refs: e123, e456, ...]
```

## SimHash

Implementation: `src/utils/dom-simhash.ts`.

A 64-bit fingerprint represents each DOM node. Fingerprints are compared to determine structural similarity using node type, role, child count, the first 10 characters of text, nesting depth, and whether the node is interactive. A Hamming distance of at most 3 indicates similarity.

1. Calculate a SimHash for each node.
2. Find similar sequences.
3. Merge adjacent similar nodes.
4. Return the list patterns.

## Search

Implementation: `src/utils/search-snapshot.ts`.

Search the current snapshot, optionally alongside the outline. Search uses ripgrep, supports regular expressions, and returns matching lines and context. The MCP tools are `browser_outline` and `browser_search_snapshot`.

## Compression results

| Stage | Lines | Reduction |
|-------|------:|----------:|
| Original DOM | 5546 | - |
| After unwrap | 2554 | 54% |
| After list folding | 471 | 91.5% |

## Data structures

### ElementNode

```typescript
interface ElementNode {
  type: string;
  ref?: string;
  content?: string;
  children: ElementNode[];
  indent: number;
  hasInteraction?: boolean;
}
```

`type` identifies the node type, `ref` is its reference, `content` is its text, and `indent` is its indentation level.

### ListPattern

```typescript
interface ListPattern {
  type: 'semantic' | 'structural';
  start: number;
  end: number;
  count: number;
  sample: ElementNode;
  items: ElementNode[];
  refs: string[];
}
```

`start` and `end` are the bounds, `count` is the number of elements, `sample` is a sample, and `items` and `refs` contain all elements and references.

## Files

```text
src/utils/
├── smart-outline-simple.ts    # Coordinates outline generation
├── remove-useless-wrappers.ts # Removes unnecessary nesting
├── list-detector.ts           # Detects list patterns
├── dom-simhash.ts             # Calculates SimHash
└── search-snapshot.ts         # Searches snapshots
```

## Benefits

1. High compression: 5,000+ lines reduced to fewer than 500, a 91.5% reduction in the example.
2. Preserved semantics: folding retains references to every element.
3. Precise interaction: elements have refs for locating and operating on them.
4. Readability: the output structure is easy to interpret.

## Example

```typescript
const generator = new SmartOutlineSimple();
const outline = generator.generate(snapshot);
```

Output:

```text
Page Outline (471/5546 lines):
- generic [ref=e2]
  - navigation "Shortcuts menu" [ref=e3]
    - listitem (... and 37 more similar) [refs: e4, e5, ...]
```
