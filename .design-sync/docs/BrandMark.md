---
category: Brand
keywords: [brand, logo, logomark, app icon, CW, avatar tile, identity]
---

# BrandMark

The "CW" tile — the product's logomark on its own. A gradient square with the
monogram, at one of four sizes.

It was previously re-implemented in five places with three different fills and two
different foreground colours. One definition means the topbar, the sidebar, the
auth dialog and the landing screens stay in step.

## Usage

```jsx
// Topbar — mark beside the wordmark
<BrandMark size="md" />
<span className="text-base font-semibold">ColWrite</span>

// Sign-in dialog and the empty canvas
<BrandMark size="lg" />
```

Use `BrandLockup` instead whenever the mark appears **with** the product name —
it pairs the two at the right size and gap, and handles the optional tagline.
Reach for `BrandMark` alone when the name is already on screen, or when space
only allows a glyph (a collapsed rail, a favicon-like slot).

## Props

- `size` — `sm` · `md` (default) · `lg` · `xl`.

| size | box | radius | monogram |
| --- | --- | --- | --- |
| `sm` | 24px | `rounded-md` | `text-2xs` |
| `md` | 28px | `rounded-md` | `text-xs` |
| `lg` | 40px | `rounded-lg` | `text-base` |
| `xl` | 48px | `rounded-lg` | `text-xl` |

The type scale and the radius move with the box, so the mark stays optically the
same shape at every size. There is no arbitrary size — pick the nearest of the
four rather than overriding the height.

- `className` — merged. Use it for layout (margins, `shadow-lg`), not to change
  the fill: the gradient is the brand.

## Appearance

`bg-gradient-to-br from-primary to-accent-dark` with `text-primary-foreground`,
`font-bold tracking-tight`, centred with `grid place-items-center`, and
`shrink-0` so it never squashes in a flex row. The gradient runs indigo →
deeper indigo, which is legible on every app surface; do not place it on a
`primary` fill.

## Accessibility

The mark is `aria-hidden="true"`. It is decorative in every context the app uses:
the product name is always present as text beside it, or as the dialog's own
title. Two consequences:

- **Never use it as the only content of a link or button.** A logo home-link needs
  its own `aria-label`, or visible text.
- Do not add `role="img"` or an `alt`-style label to it. If the name is not on
  screen, use `BrandLockup`, which renders it as real text.

## Composition

- Beside a wordmark, use `gap-2.5` and `items-center` — or just use
  `BrandLockup`, which is exactly that.
- The exported `APP_NAME` (`ColWrite`) and `APP_TAGLINE`
  (`Assistant writer for arXiv papers`) are the strings to render next to it.
  Never retype them — they ship from the same module for exactly that reason.
