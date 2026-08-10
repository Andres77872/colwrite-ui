# Colwrite UI Migration Plan: shadcn/ui + Tailwind CSS 4

## Executive Summary

This document outlines the complete migration strategy for Colwrite UI from custom CSS to **shadcn/ui** components with **Tailwind CSS 4**. The migration aims to modernize the design system, improve developer experience, ensure accessibility, and enable rapid UI iteration.

---

## Current State Analysis

### Tech Stack
- **React**: 19.1.1
- **Vite**: 7.1.0
- **TypeScript**: 5.8.3
- **Styling**: Custom CSS with CSS variables (no framework)

### Current Architecture

```
src/
├── styles/
│   ├── tokens.css      # Design tokens (colors, spacing, typography)
│   ├── base.css        # CSS reset and global styles
│   └── utilities.css   # Utility classes (.btn, .card, .stack, etc.)
├── components/
│   ├── layout/         # AppShell, Sidebar, Topbar
│   ├── editor/         # Canvas, BlockControls, ChatAssistant, etc.
│   ├── panels/         # ArxivPanel, ChatsPanel, LibraryPanel, etc.
│   ├── common/         # Editable
│   ├── auth/           # AuthContext, LandingPage
│   └── chat/           # ChatSessionsContext
└── index.css           # Main entry styles
```

### Current Design Token System

| Category | Current Approach |
|----------|-----------------|
| Colors | CSS variables: `--color-bg`, `--color-panel`, `--color-accent`, etc. |
| Spacing | 4px grid: `--sp-1` to `--sp-10` |
| Typography | Font sizes: `--fs-xs` to `--fs-3xl` |
| Radius | `--radius-sm`, `--radius-md`, `--radius-lg` |
| Shadows | `--shadow-sm`, `--shadow-md` |

### CSS File Count
- **33 CSS files** across components
- **~3,500 lines** of custom CSS
- Heavy use of BEM-like naming patterns

---

## Target Architecture

### New Tech Stack
- **Tailwind CSS 4**: Latest version with CSS-first configuration
- **shadcn/ui**: Headless, accessible components built on Radix UI
- **Radix UI Primitives**: For complex interactive components
- **class-variance-authority (cva)**: Variant management
- **tailwind-merge**: Class name conflict resolution
- **clsx**: Conditional class composition

### Project Structure After Migration

```
src/
├── styles/
│   ├── globals.css     # Tailwind directives + custom properties
│   └── themes/         # Theme variants (if needed)
├── components/
│   ├── ui/             # shadcn/ui components (Button, Card, Dialog, etc.)
│   ├── layout/         # Migrated layout components
│   ├── editor/         # Migrated editor components
│   ├── panels/         # Migrated panel components
│   └── ...
├── lib/
│   └── utils.ts        # cn() helper and utilities
└── tailwind.config.ts  # Tailwind configuration (optional with v4)
```

---

## Migration Benefits

### Developer Experience
- ✅ Utility-first styling with Tailwind
- ✅ IntelliSense support for classes
- ✅ Consistent component API with shadcn/ui
- ✅ Reduced custom CSS maintenance

### Accessibility
- ✅ ARIA-compliant Radix UI primitives
- ✅ Keyboard navigation out-of-the-box
- ✅ Focus management handled automatically
- ✅ Screen reader optimizations

### Performance
- ✅ Smaller CSS bundle (unused styles purged)
- ✅ CSS-in-JS eliminated
- ✅ Optimized animations with Tailwind

### Design System
- ✅ Consistent design tokens across all components
- ✅ Easy theming and dark mode support
- ✅ Variant system for component states

---

## Migration Phases

| Phase | Focus | Duration | Documents |
|-------|-------|----------|-----------|
| **Phase 1** | Setup & Infrastructure | 1-2 days | [01-setup-infrastructure.md](./01-setup-infrastructure.md) |
| **Phase 2** | Design Tokens Migration | 1 day | [02-design-tokens.md](./02-design-tokens.md) |
| **Phase 3** | shadcn/ui Core Components | 2-3 days | [03-shadcn-components.md](./03-shadcn-components.md) |
| **Phase 4** | Layout Components | 2-3 days | [04-layout-components.md](./04-layout-components.md) |
| **Phase 5** | Editor Components | 3-4 days | [05-editor-components.md](./05-editor-components.md) |
| **Phase 6** | Panel Components | 2-3 days | [06-panel-components.md](./06-panel-components.md) |
| **Phase 7** | Inline Components | 2-3 days | [07-inline-components.md](./07-inline-components.md) |
| **Phase 8** | Cleanup & Polish | 1-2 days | [08-cleanup-polish.md](./08-cleanup-polish.md) |

**Total Estimated Duration**: 14-21 days

---

## Component Mapping Summary

### shadcn/ui Components to Install

| Component | Use Cases in Colwrite |
|-----------|----------------------|
| `Button` | All buttons, icon buttons, toggle buttons |
| `Card` | Panels, menus, popovers |
| `Input` | Text inputs, search fields |
| `Textarea` | Chat input, AI beat input |
| `Select` | Dropdowns, selects |
| `Dialog` | Modals, auth modal |
| `Popover` | Block menus, inline editors |
| `Dropdown Menu` | Context menus, AI action menus |
| `Command` | Slash menu, reference picker |
| `Tabs` | Auth tabs, panel sections |
| `Tooltip` | Icon button tooltips |
| `Separator` | Dividers |
| `Avatar` | User avatar |
| `Badge` | Tags, labels |
| `Scroll Area` | Scrollable panels |
| `Sheet` | Mobile sidebar |
| `Collapsible` | Sidebar sections |
| `Toggle` | Toggle buttons |
| `Toggle Group` | Segmented controls |

### Custom Components (Keep/Refactor)

| Component | Action |
|-----------|--------|
| `Editable` | Keep - custom contenteditable |
| `Canvas` | Refactor with Tailwind |
| `BlockControls` | Refactor with shadcn primitives |
| `ChatAssistant` | Refactor with Tailwind |
| `FloatingToolbar` | Refactor with Popover |
| `SlashMenu` | Replace with Command |
| `DocumentsMenu` | Refactor with Tailwind |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Component behavior changes | Medium | Comprehensive testing per component |
| Styling inconsistencies | Low | Design token mapping verification |
| Build size increase | Low | Tailwind purging handles this |
| Learning curve | Low | Team familiar with Tailwind |
| Migration conflicts | Medium | Feature branch per phase |

---

## Success Criteria

- [ ] All 33 CSS files replaced or deleted
- [ ] All components render identically (visual regression)
- [ ] Accessibility audit passes (keyboard nav, ARIA)
- [ ] Bundle size ≤ current size
- [ ] No TypeScript errors
- [ ] All existing functionality preserved

---

## Next Steps

1. **Read Phase 1**: [01-setup-infrastructure.md](./01-setup-infrastructure.md)
2. **Review design tokens**: [02-design-tokens.md](./02-design-tokens.md)
3. **Component inventory**: [03-shadcn-components.md](./03-shadcn-components.md)

---

## References

- [Tailwind CSS 4 Documentation](https://tailwindcss.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Radix UI Primitives](https://www.radix-ui.com/primitives)
- [class-variance-authority](https://cva.style/docs)
