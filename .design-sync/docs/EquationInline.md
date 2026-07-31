---
category: Inline widgets
keywords: [equation, math, latex, katex, formula, display math]
---

# EquationInline

The maths widget embedded in a paragraph — inline in the run of text, or on its
own centred line when `child.display` is set.

```ts
EquationInline(props: InlineWidgetProps)
```

A type guard on `child.type === 'equation'`. `child.latex` is LaTeX without `$`
delimiters; `display`, `numbered` and `labelId` control presentation and
cross-referencing.

## Typesetting

KaTeX ships **inside the bundle** — `src/lib/katex.ts` imports the npm package
and its stylesheet, and reports `'ready'` synchronously. Equations typeset
without any network access, so nothing extra has to be loaded on the page.

Two details worth knowing:

- Invalid LaTeX renders the source in a `<code>` with the parser's error message
  under it, rather than failing silently.
- The bundled stylesheet has KaTeX's legacy `.ttf` `@font-face` sources removed
  (woff2 is kept, which is what every current browser uses). This is done by
  `.design-sync/build-ds-pkg.mjs`, because the converter's bundler has no `.ttf`
  loader.
