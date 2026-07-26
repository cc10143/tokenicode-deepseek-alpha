/**
 * KaTeX formula text fixer — applies common LaTeX syntax corrections
 * before rendering. Ported from vscode-cc-enhance/webview/enhance.js
 * (katexFix function, lines 204-226), adapted to:
 *  - Return the fixed formula string (no renderToString call — rehype-katex handles rendering)
 *  - Avoid lookbehind regex for Tauri WebView2/WebKit compatibility
 *  - Wrap in try/catch so a broken regex never crashes the render pipeline
 */

export function katexFixText(formula: string): string {
  try {
    let fixed = formula;

    // 1) Matrix newlines: single backslash + newline → double backslash
    fixed = fixed.replace(/\\\s*\n/g, '\\\\\n');

    // 2) Single backslash + space before LaTeX command → double backslash
    //    (markdown may eat the second backslash in \\ followed by space)
    //    Uses capturing group instead of (?<!\\) for WebKit compat
    fixed = fixed.replace(/(^|[^\\])\\ (?=[a-zA-Z0-9_{}\\])/g, '$1\\\\ ');

    // 3) Spacing commands: \[x] → \\[x]  (e.g. \[6pt], \[12pt])
    fixed = fixed.replace(/\\\[(\d+(?:\.\d+)?[a-z]*)]/gi, '\\\\[$1]');

    // 4) Cases environment spacing fix
    fixed = fixed.replace(/&\s*\\\[6pt]]/g, '& \\\\');

    // 5) \sum{...} → \sum_{...}  (and prod, int, lim, inf, sup, max, min)
    fixed = fixed.replace(
      /\\(sum|prod|int|lim|inf|sup|max|min)\{([^}]+)}/g,
      '\\$1_{$2}',
    );

    // 6) \operatorname{name}( → \operatorname{name}(
    fixed = fixed.replace(/\\operatorname\{(\w+)}(\(?)/g, '\\operatorname{$1}$2');

    // 7) \left{ → \left\{  (markdown-escaped brace)
    fixed = fixed.replace(/\\left\{/g, '\\left\\{');

    // 8) \right} → \right\}
    fixed = fixed.replace(/\\right\}/g, '\\right\\}');

    // 9) Trailing isolated \left / \right → append . as placeholder delimiter
    fixed = fixed.replace(/\\left(?=\s*$)/g, '\\left.');
    fixed = fixed.replace(/\\right(?=\s*$)/g, '\\right.');

    return fixed;
  } catch {
    // Regex error (extremely unlikely) — return unchanged
    return formula;
  }
}
