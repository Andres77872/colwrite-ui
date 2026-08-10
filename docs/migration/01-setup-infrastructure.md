# Phase 1: Setup & Infrastructure

## Overview

This phase covers the installation and configuration of Tailwind CSS 4 and shadcn/ui in the existing Vite + React project.

---

## 1.1 Install Tailwind CSS 4

### Dependencies

```bash
npm install -D tailwindcss @tailwindcss/vite
```

### Vite Configuration

Update `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
```

### CSS Entry Point

Create/update `src/styles/globals.css`:

```css
@import "tailwindcss";

/* Custom theme configuration using Tailwind CSS 4 @theme directive */
@theme {
  /* Colors - mapped from existing tokens.css */
  --color-background: #f7f8fa;
  --color-foreground: #0f172a;
  --color-card: #ffffff;
  --color-card-foreground: #0f172a;
  --color-popover: #ffffff;
  --color-popover-foreground: #0f172a;
  --color-primary: #3b82f6;
  --color-primary-foreground: #ffffff;
  --color-secondary: #f1f5f9;
  --color-secondary-foreground: #0f172a;
  --color-muted: #f1f5f9;
  --color-muted-foreground: #6b7280;
  --color-accent: #f1f5f9;
  --color-accent-foreground: #0f172a;
  --color-destructive: #ef4444;
  --color-destructive-foreground: #ffffff;
  --color-border: #e5e7eb;
  --color-input: #e5e7eb;
  --color-ring: #3b82f6;

  /* Spacing - 4px base grid */
  --spacing-0: 0px;
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
  --spacing-10: 40px;

  /* Border radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.1);

  /* Font sizes */
  --font-size-xs: 12px;
  --font-size-sm: 13px;
  --font-size-base: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 28px;
  --font-size-3xl: 36px;

  /* Font families */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

  /* Animation */
  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-accordion-up: accordion-up 0.2s ease-out;
}

/* Keyframes for animations */
@keyframes accordion-down {
  from { height: 0; }
  to { height: var(--radix-accordion-content-height); }
}

@keyframes accordion-up {
  from { height: var(--radix-accordion-content-height); }
  to { height: 0; }
}

/* Base layer customizations */
@layer base {
  * {
    @apply border-border;
  }
  
  body {
    @apply bg-background text-foreground font-sans antialiased;
  }
  
  /* Selection styling */
  ::selection {
    @apply bg-primary/25;
  }
}
```

### Update Main Entry

Update `src/main.tsx`:

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './components/auth/AuthContext.tsx'
import './styles/globals.css'  // Changed from index.css
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
```

---

## 1.2 Install shadcn/ui Dependencies

### Core Dependencies

```bash
npm install clsx tailwind-merge class-variance-authority
npm install @radix-ui/react-slot
```

### Create Utility Function

Create `src/lib/utils.ts`:

```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## 1.3 Configure Path Aliases

### Update tsconfig.json

Update `tsconfig.app.json` (or `tsconfig.json`):

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Update Vite Config

Update `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
```

---

## 1.4 Create shadcn/ui Components Directory

```bash
mkdir -p src/components/ui
```

---

## 1.5 Install First shadcn/ui Component (Button)

Create `src/components/ui/button.tsx`:

```typescript
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
```

---

## 1.6 Verification Checklist

After completing this phase, verify:

- [ ] `npm run dev` starts without errors
- [ ] Tailwind CSS classes work (test with `<div className="bg-red-500">Test</div>`)
- [ ] Path aliases work (`import { cn } from "@/lib/utils"`)
- [ ] Button component imports without TypeScript errors
- [ ] Existing components still render (CSS files still loaded)

---

## 1.7 Project File Changes Summary

| File | Action |
|------|--------|
| `package.json` | Add dependencies |
| `vite.config.ts` | Add Tailwind plugin + path alias |
| `tsconfig.app.json` | Add path alias |
| `src/styles/globals.css` | Create with Tailwind + theme |
| `src/main.tsx` | Update CSS import |
| `src/lib/utils.ts` | Create cn() helper |
| `src/components/ui/button.tsx` | Create Button component |

---

## Next Phase

Continue to **[Phase 2: Design Tokens Migration](./02-design-tokens.md)** to map existing CSS variables to Tailwind's theme system.
