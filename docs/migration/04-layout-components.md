# Phase 4: Layout Components Migration

## Overview

This phase covers migrating the core layout components: `AppShell`, `Sidebar`, and `Topbar`. These form the structural foundation of the application.

---

## 4.1 Component Inventory

### Current Layout Structure

```
src/components/layout/
├── AppShell/
│   ├── AppShell.css       (33 lines)
│   ├── AppShell.tsx       (37 lines)
│   └── index.ts
├── Sidebar/
│   ├── Sidebar.css        (31 lines)
│   ├── Sidebar.tsx        (75 lines)
│   └── index.ts
└── Topbar/
    ├── Topbar.css         (42 lines)
    ├── Topbar.tsx         (existing)
    └── index.ts
```

---

## 4.2 AppShell Migration

### Current Implementation Analysis

**CSS Classes Used:**
- `.app-shell` - Root container with dvh height, padding, flex column
- `.app-header` - Header region
- `.app-body` - Grid container with responsive columns
- `.app-left`, `.app-main`, `.app-aside`, `.app-right` - Grid regions
- Modifier classes: `.has-left`, `.has-right`, `.has-right-rail`, `.is-left-collapsed`

### Migrated Component

```typescript
// src/components/layout/AppShell/AppShell.tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AppShellProps {
  header?: ReactNode;
  main: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  aside?: ReactNode;
  leftCollapsed?: boolean;
}

export function AppShell({
  header,
  main,
  left,
  right,
  aside,
  leftCollapsed,
}: AppShellProps) {
  return (
    <div className="h-dvh p-3 flex flex-col gap-3">
      {header && (
        <header className="w-full z-20">
          {header}
        </header>
      )}
      
      <div
        className={cn(
          "grid gap-3 flex-1 min-h-0",
          // Base: single column
          "grid-cols-1",
          // With left sidebar
          left && !leftCollapsed && "md:grid-cols-[260px_1fr]",
          left && leftCollapsed && "md:grid-cols-[56px_1fr]",
          // With right aside panel
          aside && "md:grid-cols-[1fr_380px]",
          // With right rail
          right && !aside && "md:grid-cols-[1fr_52px]",
          // Combined layouts
          left && !leftCollapsed && aside && "md:grid-cols-[260px_1fr_380px]",
          left && !leftCollapsed && right && !aside && "md:grid-cols-[260px_1fr_52px]",
          left && !leftCollapsed && right && aside && "md:grid-cols-[260px_1fr_380px_52px]",
          left && leftCollapsed && aside && "md:grid-cols-[56px_1fr_380px]",
          left && leftCollapsed && right && !aside && "md:grid-cols-[56px_1fr_52px]",
          left && leftCollapsed && right && aside && "md:grid-cols-[56px_1fr_380px_52px]",
        )}
      >
        {left && (
          <nav
            className={cn(
              "bg-card border border-border rounded-lg overflow-hidden hidden md:block",
              leftCollapsed && "w-14"
            )}
          >
            {left}
          </nav>
        )}
        
        <main className="bg-card border border-border rounded-lg p-3 overflow-auto">
          {main}
        </main>
        
        {aside && (
          <aside className="bg-card border border-border rounded-lg p-3 overflow-auto hidden md:block">
            {aside}
          </aside>
        )}
        
        {right && (
          <nav className="bg-card border border-border rounded-lg p-2 overflow-auto hidden md:block">
            {right}
          </nav>
        )}
      </div>
    </div>
  );
}
```

### Delete CSS File

After migration, delete: `src/components/layout/AppShell/AppShell.css`

---

## 4.3 Sidebar Migration

### Current Implementation Analysis

**CSS Classes Used:**
- `.sidebar` - Root with flex column, full height
- `.sb-header` - Header with brand and toggle
- `.sb-brand`, `.sb-logo`, `.sb-title` - Brand elements
- `.sb-toggle` - Collapse toggle button
- `.sb-scroll` - Scrollable nav area
- `.sb-nav`, `.sb-item` - Navigation items
- `.sb-section`, `.sb-section-header`, `.sb-section-body` - Collapsible sections
- `.sb-footer` - Footer area
- `.collapsed` modifier - Collapsed state

### Migrated Component

```typescript
// src/components/layout/Sidebar/Sidebar.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DocumentsMenu } from '@/components/editor/DocumentsMenu';
import { ChevronLeft, ChevronDown, ChevronRight, Home, FileEdit, Settings } from 'lucide-react';

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const [active, setActive] = useState<string>('editor');
  const [docsOpen, setDocsOpen] = useState<boolean>(true);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'editor', label: 'Editor', icon: FileEdit },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className={cn("h-full flex flex-col", collapsed && "items-center")}>
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between gap-2 p-4 border-b border-border",
        collapsed && "justify-center"
      )}>
        <div className="flex items-center gap-3">
          <button
            className={cn(
              "w-7 h-7 rounded-md grid place-items-center bg-gradient-to-br from-primary to-primary/80 text-white font-bold text-sm",
              collapsed && "cursor-pointer"
            )}
            onClick={collapsed ? onToggle : undefined}
            aria-label={collapsed ? 'Expand sidebar' : undefined}
            title={collapsed ? 'Expand' : undefined}
          >
            CW
          </button>
          {!collapsed && (
            <span className="font-semibold tracking-wide">Colwrite</span>
          )}
        </div>
        {!collapsed && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
        <nav className="grid gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn(
                  "flex items-center gap-3 px-2.5 py-2 rounded-md border border-transparent text-left transition-colors",
                  "hover:bg-accent hover:border-border",
                  active === item.id && "bg-primary/10 border-primary",
                  collapsed && "justify-center px-2"
                )}
                onClick={() => setActive(item.id)}
                title={item.label}
                aria-label={item.label}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Documents Section */}
        {!collapsed && (
          <Collapsible open={docsOpen} onOpenChange={setDocsOpen}>
            <div className="border-t border-border pt-2">
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-2.5 py-2 rounded-md border border-transparent hover:bg-accent hover:border-border transition-colors">
                  <span>Documents</span>
                  {docsOpen ? (
                    <ChevronDown className="h-4 w-4 opacity-80" />
                  ) : (
                    <ChevronRight className="h-4 w-4 opacity-80" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 px-1">
                <DocumentsMenu />
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <p className="text-muted-foreground text-sm">
          {collapsed ? 'v0.1' : 'v0.1 • UI Preview'}
        </p>
      </div>
    </aside>
  );
}
```

### Create Collapsible Component

```typescript
// src/components/ui/collapsible.tsx
import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.Trigger
const CollapsibleContent = CollapsiblePrimitive.Content

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
```

### Delete CSS File

After migration, delete: `src/components/layout/Sidebar/Sidebar.css`

---

## 4.4 Topbar Migration

### Current Implementation Analysis

**CSS Classes Used:**
- `.topbar` - Grid container with branding, nav, actions
- `.brand`, `.brand-logo`, `.brand-title`, `.brand-sub` - Branding elements
- `.actions`, `.user`, `.user-btn`, `.avatar` - User actions
- `.menu`, `.menu-section`, `.menu-item` - Dropdown menu
- `.auth-*` - Authentication modal styles
- `.alpha-notice` - Alpha disclaimer

### Migrated Component

```typescript
// src/components/layout/Topbar/Topbar.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/auth/AuthContext';
import { ChevronDown, LogOut, User } from 'lucide-react';

export function Topbar() {
  const { user, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');

  const initials = user?.email?.charAt(0).toUpperCase() || 'U';

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 bg-card border border-border rounded-lg shadow-sm">
      {/* Brand */}
      <a href="/" className="flex items-center gap-3 text-inherit no-underline">
        <div className="w-7 h-7 rounded-md grid place-items-center bg-gradient-to-br from-primary to-primary/80 text-white font-bold text-sm">
          CW
        </div>
        <div>
          <div className="font-bold">Colwrite</div>
          <div className="text-sm text-muted-foreground">AI Writing</div>
        </div>
      </a>

      {/* Center - empty or future nav */}
      <div />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 shadow-sm">
                <div className="w-6 h-6 rounded-full bg-primary text-white grid place-items-center font-bold text-sm">
                  {initials}
                </div>
                <span className="font-semibold hidden sm:inline">{user.email?.split('@')[0]}</span>
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Signed in as</span>
                  <span className="font-semibold truncate">{user.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button onClick={() => setAuthOpen(true)}>
            Sign In
          </Button>
        )}
      </div>

      {/* Auth Dialog */}
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md grid place-items-center bg-gradient-to-br from-primary to-primary/80 text-white font-bold text-sm">
                CW
              </div>
              Welcome to Colwrite
            </DialogTitle>
            <DialogDescription>
              Sign in to save your documents and access AI features.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={authTab} onValueChange={(v) => setAuthTab(v as 'login' | 'register')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            <TabsContent value="login" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" />
              </div>
              <Button className="w-full">Sign In</Button>
            </TabsContent>
            <TabsContent value="register" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="reg-email">Email</Label>
                <Input id="reg-email" type="email" placeholder="you@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Password</Label>
                <Input id="reg-password" type="password" />
              </div>
              <Button className="w-full">Create Account</Button>
            </TabsContent>
          </Tabs>

          {/* Alpha Notice */}
          <div className="mt-4 p-3 border border-dashed border-border bg-accent rounded-md">
            <div className="font-bold text-sm mb-1">Alpha Preview</div>
            <p className="text-sm text-muted-foreground">
              This is an early preview. Some features may be incomplete or unstable.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

### Create Dialog Component

```typescript
// src/components/ui/dialog.tsx
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
}
```

### Create Tabs Component

```typescript
// src/components/ui/tabs.tsx
import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

### Delete CSS File

After migration, delete: `src/components/layout/Topbar/Topbar.css`

---

## 4.5 Additional Dependencies

```bash
npm install @radix-ui/react-collapsible
npm install @radix-ui/react-dialog
npm install @radix-ui/react-tabs
```

---

## 4.6 Files to Delete After Migration

- [ ] `src/components/layout/AppShell/AppShell.css`
- [ ] `src/components/layout/Sidebar/Sidebar.css`
- [ ] `src/components/layout/Topbar/Topbar.css`

---

## 4.7 Verification Checklist

- [ ] AppShell renders with all layout combinations
- [ ] Sidebar expands/collapses correctly
- [ ] Sidebar navigation highlights active item
- [ ] Documents section collapses/expands
- [ ] Topbar user dropdown works
- [ ] Auth dialog opens and tabs switch
- [ ] Responsive behavior matches original
- [ ] All animations smooth

---

## Next Phase

Continue to **[Phase 5: Editor Components](./05-editor-components.md)** to migrate Canvas, BlockControls, and other editor components.
