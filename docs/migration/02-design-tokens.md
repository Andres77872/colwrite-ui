# Phase 2: Design Tokens Migration

## Overview

This phase maps the existing CSS custom properties from `tokens.css` to Tailwind CSS 4's theme system, ensuring visual consistency during and after migration.

---

## 2.1 Current Token Inventory

### Colors (from `src/styles/tokens.css`)

| Current Variable | Value | Purpose |
|-----------------|-------|---------|
| `--color-bg` | `#f7f8fa` | App background |
| `--color-panel` | `#ffffff` | Card/panel background |
| `--color-elev` | `#fbfbfc` | Elevated surfaces, hover states |
| `--color-border` | `#e5e7eb` | Borders, dividers |
| `--color-muted` | `#6b7280` | Secondary text, placeholders |
| `--color-text` | `#0f172a` | Primary text |
| `--color-accent` | `#3b82f6` | Primary brand color |
| `--color-accent-ink` | `#0b56c2` | Darker accent for hover |
| `--color-danger` | `#ef4444` | Error/destructive actions |

### Spacing (4px grid)

| Current Variable | Value | Tailwind Equivalent |
|-----------------|-------|---------------------|
| `--sp-1` | `4px` | `spacing-1` or `p-1` |
| `--sp-2` | `8px` | `spacing-2` or `p-2` |
| `--sp-3` | `12px` | `spacing-3` or `p-3` |
| `--sp-4` | `16px` | `spacing-4` or `p-4` |
| `--sp-5` | `20px` | `spacing-5` or `p-5` |
| `--sp-6` | `24px` | `spacing-6` or `p-6` |
| `--sp-8` | `32px` | `spacing-8` or `p-8` |
| `--sp-10` | `40px` | `spacing-10` or `p-10` |

### Border Radius

| Current Variable | Value | Tailwind Equivalent |
|-----------------|-------|---------------------|
| `--radius-sm` | `6px` | `rounded-sm` |
| `--radius-md` | `10px` | `rounded-md` |
| `--radius-lg` | `12px` | `rounded-lg` |

### Shadows

| Current Variable | Value | Tailwind Equivalent |
|-----------------|-------|---------------------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | `shadow-sm` |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.06)` | `shadow-md` |

### Typography

| Current Variable | Value | Tailwind Equivalent |
|-----------------|-------|---------------------|
| `--font-sans` | System fonts stack | `font-sans` |
| `--fs-xs` | `12px` | `text-xs` |
| `--fs-sm` | `13px` | `text-sm` |
| `--fs-md` | `14px` | `text-base` |
| `--fs-lg` | `16px` | `text-lg` |
| `--fs-xl` | `20px` | `text-xl` |
| `--fs-2xl` | `28px` | `text-2xl` |
| `--fs-3xl` | `36px` | `text-3xl` |

---

## 2.2 Tailwind CSS 4 Theme Configuration

### Complete Theme File

Update `src/styles/globals.css`:

```css
@import "tailwindcss";

/* ============================================
   COLWRITE DESIGN SYSTEM - TAILWIND CSS 4
   ============================================ */

@theme {
  /* ----------------------------------------
   * COLORS
   * Mapped from tokens.css with shadcn/ui naming
   * ---------------------------------------- */
  
  /* Background colors */
  --color-background: #f7f8fa;
  --color-foreground: #0f172a;
  
  /* Card/Panel colors */
  --color-card: #ffffff;
  --color-card-foreground: #0f172a;
  
  /* Popover colors */
  --color-popover: #ffffff;
  --color-popover-foreground: #0f172a;
  
  /* Primary (accent) colors */
  --color-primary: #3b82f6;
  --color-primary-foreground: #ffffff;
  
  /* Secondary colors */
  --color-secondary: #f1f5f9;
  --color-secondary-foreground: #0f172a;
  
  /* Muted colors */
  --color-muted: #f1f5f9;
  --color-muted-foreground: #6b7280;
  
  /* Accent hover colors */
  --color-accent: #fbfbfc;
  --color-accent-foreground: #0f172a;
  
  /* Destructive (danger) colors */
  --color-destructive: #ef4444;
  --color-destructive-foreground: #ffffff;
  
  /* Border and input */
  --color-border: #e5e7eb;
  --color-input: #e5e7eb;
  --color-ring: #3b82f6;
  
  /* Additional semantic colors */
  --color-success: #10b981;
  --color-success-foreground: #ffffff;
  --color-warning: #f59e0b;
  --color-warning-foreground: #ffffff;
  --color-info: #0ea5e9;
  --color-info-foreground: #ffffff;
  
  /* Extended palette for specific use cases */
  --color-elevated: #fbfbfc;
  --color-accent-dark: #0b56c2;
  
  /* ----------------------------------------
   * SPACING (4px base grid)
   * ---------------------------------------- */
  --spacing-0: 0px;
  --spacing-0-5: 2px;
  --spacing-1: 4px;
  --spacing-1-5: 6px;
  --spacing-2: 8px;
  --spacing-2-5: 10px;
  --spacing-3: 12px;
  --spacing-3-5: 14px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-7: 28px;
  --spacing-8: 32px;
  --spacing-9: 36px;
  --spacing-10: 40px;
  --spacing-12: 48px;
  --spacing-16: 64px;
  
  /* ----------------------------------------
   * BORDER RADIUS
   * ---------------------------------------- */
  --radius-none: 0px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 24px;
  --radius-full: 9999px;
  
  /* ----------------------------------------
   * SHADOWS
   * ---------------------------------------- */
  --shadow-xs: 0 1px 0 rgba(0, 0, 0, 0.02);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12);
  
  /* ----------------------------------------
   * TYPOGRAPHY
   * ---------------------------------------- */
  
  /* Font families */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  
  /* Font sizes with line heights */
  --font-size-xs: 12px;
  --line-height-xs: 16px;
  
  --font-size-sm: 13px;
  --line-height-sm: 18px;
  
  --font-size-base: 14px;
  --line-height-base: 20px;
  
  --font-size-lg: 16px;
  --line-height-lg: 24px;
  
  --font-size-xl: 20px;
  --line-height-xl: 28px;
  
  --font-size-2xl: 28px;
  --line-height-2xl: 36px;
  
  --font-size-3xl: 36px;
  --line-height-3xl: 44px;
  
  /* ----------------------------------------
   * ANIMATIONS
   * ---------------------------------------- */
  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-accordion-up: accordion-up 0.2s ease-out;
  --animate-fade-in: fade-in 0.15s ease-out;
  --animate-fade-out: fade-out 0.15s ease-out;
  --animate-slide-in-up: slide-in-up 0.15s ease-out;
  --animate-slide-in-down: slide-in-down 0.15s ease-out;
  --animate-scale-in: scale-in 0.12s ease-out;
  --animate-spin: spin 1s linear infinite;
  --animate-pulse: pulse 1.1s ease-in-out infinite;
  
  /* ----------------------------------------
   * Z-INDEX SCALE
   * ---------------------------------------- */
  --z-dropdown: 50;
  --z-sticky: 100;
  --z-fixed: 150;
  --z-modal-backdrop: 200;
  --z-modal: 250;
  --z-popover: 300;
  --z-tooltip: 400;
}

/* ============================================
   KEYFRAME ANIMATIONS
   ============================================ */

@keyframes accordion-down {
  from { height: 0; opacity: 0; }
  to { height: var(--radix-accordion-content-height); opacity: 1; }
}

@keyframes accordion-up {
  from { height: var(--radix-accordion-content-height); opacity: 1; }
  to { height: 0; opacity: 0; }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes slide-in-up {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slide-in-down {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes scale-in {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(240, 195, 109, 0.6); }
  70% { box-shadow: 0 0 0 6px rgba(240, 195, 109, 0); }
  100% { box-shadow: 0 0 0 0 rgba(240, 195, 109, 0); }
}

/* ============================================
   BASE LAYER
   ============================================ */

@layer base {
  *,
  *::before,
  *::after {
    @apply border-border;
  }
  
  html {
    @apply h-full;
    -webkit-text-size-adjust: 100%;
  }
  
  body {
    @apply h-full bg-background text-foreground font-sans antialiased;
  }
  
  #root {
    @apply h-full;
  }
  
  img, svg, video {
    @apply block max-w-full;
  }
  
  button, input, select, textarea {
    @apply font-inherit text-inherit;
  }
  
  button {
    @apply cursor-pointer;
  }
  
  ::selection {
    @apply bg-primary/25;
  }
  
  /* Scrollbar styling (WebKit) */
  ::-webkit-scrollbar {
    @apply w-3 h-3;
  }
  
  ::-webkit-scrollbar-thumb {
    @apply bg-border rounded-lg;
    border: 3px solid transparent;
    background-clip: content-box;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    @apply bg-muted-foreground/30;
  }
}

/* ============================================
   UTILITY COMPONENTS
   ============================================ */

@layer components {
  /* Card utility (can remove once all components migrated) */
  .card {
    @apply bg-card border border-border rounded-lg shadow-sm;
  }
  
  /* Stack layouts */
  .stack {
    @apply flex flex-col gap-3;
  }
  
  .row {
    @apply flex items-center gap-3;
  }
  
  /* Divider */
  .divider {
    @apply h-px bg-border my-3;
  }
  
  /* ContentEditable placeholder */
  [contenteditable][data-placeholder]:empty::before {
    content: attr(data-placeholder);
    @apply text-muted-foreground pointer-events-none;
  }
}
```

---

## 2.3 Token Migration Reference Card

### Quick Lookup: CSS Variable → Tailwind Class

| Old CSS | New Tailwind |
|---------|--------------|
| `var(--color-bg)` | `bg-background` |
| `var(--color-panel)` | `bg-card` |
| `var(--color-elev)` | `bg-accent` / `bg-elevated` |
| `var(--color-border)` | `border-border` |
| `var(--color-muted)` | `text-muted-foreground` |
| `var(--color-text)` | `text-foreground` |
| `var(--color-accent)` | `bg-primary` / `text-primary` |
| `var(--color-accent-ink)` | `bg-primary/90` / `hover:bg-primary/90` |
| `var(--color-danger)` | `bg-destructive` / `text-destructive` |
| `var(--sp-1)` | `p-1` / `m-1` / `gap-1` |
| `var(--sp-2)` | `p-2` / `m-2` / `gap-2` |
| `var(--sp-3)` | `p-3` / `m-3` / `gap-3` |
| `var(--sp-4)` | `p-4` / `m-4` / `gap-4` |
| `var(--sp-6)` | `p-6` / `m-6` / `gap-6` |
| `var(--sp-8)` | `p-8` / `m-8` / `gap-8` |
| `var(--radius-sm)` | `rounded-sm` |
| `var(--radius-md)` | `rounded-md` |
| `var(--radius-lg)` | `rounded-lg` |
| `var(--shadow-sm)` | `shadow-sm` |
| `var(--shadow-md)` | `shadow-md` |
| `var(--fs-xs)` | `text-xs` |
| `var(--fs-sm)` | `text-sm` |
| `var(--fs-md)` | `text-base` |
| `var(--fs-lg)` | `text-lg` |
| `var(--fs-xl)` | `text-xl` |

---

## 2.4 Common Pattern Translations

### Buttons

**Before (CSS):**
```css
.btn {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: #fff;
}
.btn:hover { background: var(--color-elev); }
.btn.primary { background: var(--color-accent); color: #fff; }
```

**After (Tailwind):**
```tsx
// Use shadcn Button component instead
<Button variant="outline">Default</Button>
<Button variant="default">Primary</Button>
```

### Cards/Panels

**Before:**
```css
.card {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
```

**After:**
```tsx
<div className="bg-card border border-border rounded-lg shadow-sm">
  {/* or use shadcn Card */}
</div>
```

### Flexbox Layouts

**Before:**
```css
.stack { display: flex; flex-direction: column; gap: var(--sp-3); }
.row { display: flex; align-items: center; gap: var(--sp-3); }
```

**After:**
```tsx
<div className="flex flex-col gap-3">{/* stack */}</div>
<div className="flex items-center gap-3">{/* row */}</div>
```

### Typography

**Before:**
```css
.title { font-weight: 600; font-size: var(--fs-lg); }
.muted { color: var(--color-muted); font-size: var(--fs-sm); }
```

**After:**
```tsx
<h2 className="font-semibold text-lg">Title</h2>
<span className="text-muted-foreground text-sm">Muted text</span>
```

---

## 2.5 Verification Checklist

- [ ] All colors render correctly in theme
- [ ] Spacing values match original (4px grid)
- [ ] Border radius values match
- [ ] Shadow values match visually
- [ ] Font sizes and families match
- [ ] Animation keyframes work
- [ ] Base layer styles apply correctly

---

## Next Phase

Continue to **[Phase 3: shadcn/ui Core Components](./03-shadcn-components.md)** to install and configure the component library.
