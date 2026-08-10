# ColWrite design system reference

A single self-contained page documenting every design token, UI primitive and
application view in ColWrite. No build step, no dependencies, no server.

```sh
xdg-open docs/design-system/index.html
```

## Files

| File | Contents | Reusable? |
| --- | --- | --- |
| `tokens.css` | Every design token from `src/styles/globals.css` as plain custom properties, plus the base layer (reset, focus, scrollbars, reduced-motion). | Yes — drop-in |
| `components.css` | The `src/components/ui` primitives and the editor-specific classes from the app's `@layer components` block, written without Tailwind. | Yes — drop-in |
| `views.css` | Layout for the full-screen view mockups (app shell, canvas, chat window, landing, panels, profile). | Reference only |
| `reference.css` | Chrome for the documentation page itself — nav, section headings, swatch grids, responsive overrides. | Reference only |
| `index.html` | The page. Icons are an inline SVG sprite, so there are no external requests. | — |

Load order matters: `tokens → components → views → reference`. `reference.css`
carries the responsive overrides for `.hero-grid` and `.profile-split`, which
have to cascade after the rules they override.

## Contents

- **Foundations** — color, typography, radius, shadow, motion, z-index, chart series
- **Components** — buttons, badges, alerts, cards, forms, overlays, feedback, navigation
- **Editor primitives** — blocks, inline widgets, diffs and proposal cards
- **Views** — landing, workspace, chat assistant, review, slash menu, tool panels, profile, dialogs

## Source of truth

The tokens and component styles are a **reproduction** of the app, not its
source. When they diverge, the app wins:

- tokens — `src/styles/globals.css`
- primitives — `src/components/ui/*`
- views — the components under `src/components/{layout,editor,panels,profile,landing}`
