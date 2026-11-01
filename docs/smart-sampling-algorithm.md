# Smart Sampling Algorithm

## Core idea

Recursively detect and fold lists, compressing repeated structures into a sample and count while retaining semantic information.

## Three compression levels

### Text

Keep a meaningful prefix of long content:

```text
Original: "INFINITIPRO Tourmaline 1 1/2-Inch Ceramic Curling Iron, 1 ½ inch barrel produces soft waves – for use on medium and long hair"
Compressed: "INFINITIPRO Tourmaline 1 1/2-Inch Ceramic..."
```

### Lists

Show the first complete sample and fold the rest. A title is kept separately:

```text
- list
  - listitem "Popular products"
  - listitem [ref=e1234]
    - link: "Curling iron 1"
    - text: "$29.99"
    - button: "Add to cart"
  - listitem (... and 49 more similar) [refs=e1235,e1236,...]
```

### Recursion

Apply the same compression to lists inside the sample:

```text
- listitem [ref=e1234]
  - heading: "Curling iron 1"
  - generic
    - img
    - img (... and 4 more images)
  - generic
    - text: "Works well..."
    - text (... and 99 more reviews)
```

## Identifying lists

A list consists of at least three adjacent sibling nodes with similar DOM subtrees. It need not begin with the first sibling: find the largest similar subsequence. Compare node type distribution, tree shape, depth, and width using SimHash or tree edit distance. Base detection on actual DOM elements such as list items, buttons, and links.

## Benefits

- Folding represents repeated structures compactly while retaining the count.
- The output preserves meaningful groupings such as a product list rather than a large collection of generic elements.
- References still allow individual elements to be located, and the first sample provides a complete interaction template.

## Procedure

1. Traverse the snapshot and identify list patterns. Prefer semantic lists of consecutive list items, then use SimHash for structurally similar sibling groups. Find the largest similar subsequence, which may start after the first element.
2. Keep the first similar element in full, fold the others into a count and references, and preserve special elements such as headings separately.
3. Apply the same process recursively to retained elements.
4. Limit text length and return the folded result.

## Expected results

An original snapshot of 5,546 lines can contain 497 expanded generic elements, repeated product cards, and redundant text. The compressed result preserves the page skeleton, a complete product sample plus a count of the remaining 49, a complete filter sample plus a count of the remaining 15, and truncated long text.

## Challenges

- List boundaries: preserve headings and trailing controls such as a view-more button while finding the largest contiguous similar subsequence.
- Nested lists: decide and compress each level independently while maintaining readable structure.
- Heterogeneous lists: tolerate a small number of outliers using the SimHash Hamming distance threshold.
- Performance: cache SimHash values, limit recursion depth, and compare sibling nodes only.
