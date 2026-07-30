---
category: Brand
keywords: [brand, lockup, logo with wordmark, tagline, identity, product name]
---

# BrandLockup

The mark plus the wordmark, optionally with the product tagline — the product's
signature. Use it anywhere the app introduces itself: the landing header and
footer, a sign-in surface, an about panel.

It composes `BrandMark` with `APP_NAME` and `APP_TAGLINE` so those three never
drift apart. Use `BrandMark` on its own only when the name is already on screen.

## Usage

```jsx
// Landing header
<BrandLockup size="sm" />

// Landing footer — the tagline earns its place where there is room
<BrandLockup size="sm" showTagline />
```

## Props

- `size` — `sm` · `md` (default) · `lg` · `xl`, passed straight to the inner
  `BrandMark` (24 / 28 / 40 / 48px). The wordmark tracks it in two steps: `sm` and
  `md` render `text-base`, `lg` and `xl` render `text-xl`. The tagline is
  `text-xs text-muted-foreground` at every size.
- `showTagline` — `false` by default. `true` adds
  "Assistant writer for arXiv papers" on a second line under the name.
- `className` — merged onto the outer `inline-flex` row. Use it for placement
  only.

## Choosing a size

| size | Use for |
| --- | --- |
| `sm` | In a bar or a row beside other controls — the landing header and footer. |
| `md` | A standalone card or a narrow panel. |
| `lg` / `xl` | A hero, a splash, or an empty first-run canvas. Both jump the wordmark to `text-xl`. |

Show the tagline where the product needs introducing (a first-run screen, a
footer, a sign-in card) and hide it in dense chrome, where it is noise.

## Layout

The lockup is a `flex items-center gap-2.5` row: mark on the left, a `min-w-0`
text column on the right. The mark is `shrink-0` and the tagline is `truncate`,
so in a narrow container the tagline clips and **the lockup never wraps to two
lines or squashes the mark**. It sizes to its content — give it a width only if
you want the tagline to clip earlier.

## Accessibility

The mark inside is `aria-hidden`; the name and tagline are real text, so the
lockup announces as "ColWrite" (plus the tagline when shown). That makes it safe
as the content of a home link:

```jsx
<a href="/" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring">
  <BrandLockup size="sm" />
</a>
```

It renders as a `<span>`, not a heading — it is an identity, not a document
outline entry. If a screen needs an `<h1>`, write one.

## Composition

- `APP_NAME` and `APP_TAGLINE` are exported from the same module if you need the
  strings elsewhere (a document title, a meta description). Do not retype them.
- To build a variant this component does not cover — mark above name, or a
  right-aligned lockup — compose `BrandMark` with the exported constants rather
  than overriding this one's internals with `className`.
