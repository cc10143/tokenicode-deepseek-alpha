/**
 * Custom rehype plugin that applies katexFixText() to math node content
 * BEFORE rehype-katex renders it.
 *
 * remark-math produces HAST nodes with className ['math', 'math-inline']
 * for inline math and ['math', 'math-display'] for display math. This plugin
 * walks the tree, finds those nodes, and fixes their text content in-place.
 */

import { katexFixText } from './katex-fix';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HastNode = any;

function walk(node: HastNode): void {
  if (!node || typeof node !== 'object') return;

  // Check if this node is a math node from remark-math
  if (
    node.type === 'element' &&
    Array.isArray(node.properties?.className) &&
    node.properties.className.includes('math') &&
    (node.properties.className.includes('math-inline') ||
      node.properties.className.includes('math-display'))
  ) {
    // Fix text content of all children
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child.type === 'text' && typeof child.value === 'string') {
          child.value = katexFixText(child.value);
        }
      }
    }
    // Don't recurse into math nodes — let rehype-katex handle their children
    return;
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child);
    }
  }
}

export function rehypeKatexFix() {
  return (tree: HastNode) => {
    walk(tree);
  };
}
