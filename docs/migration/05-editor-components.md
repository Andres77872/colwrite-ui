# Phase 5: Editor Components Migration

## Overview

This phase covers migrating the core editor components including Canvas, BlockControls, FloatingToolbar, SlashMenu, ChatAssistant, and related components. These are the most complex components with significant CSS.

---

## 5.1 Component Inventory

### Current Editor Structure

```
src/components/editor/
├── Canvas/
│   ├── Canvas.css          (168 lines)
│   ├── Canvas.tsx
│   └── index.ts
├── BlockControls/
│   ├── BlockControls.css   (412 lines)
│   ├── BlockControls.tsx
│   └── index.ts
├── FloatingToolbar/
│   ├── FloatingToolbar.css (61 lines)
│   ├── FloatingToolbar.tsx
│   ├── AIActionMenu/
│   │   ├── AIActionMenu.css (13 lines)
│   │   └── AIActionMenu.tsx
│   └── index.ts
├── SlashMenu/
│   ├── SlashMenu.css       (40 lines)
│   ├── SlashMenu.tsx
│   └── index.ts
├── ChatAssistant/
│   ├── ChatAssistant.css   (40 lines)
│   ├── ChatAssistant.tsx
│   ├── ChatRefPicker/      (67 lines CSS)
│   ├── ChatRefTags/        (14 lines CSS)
│   ├── ChatTaggedInput/    (217 lines CSS)
│   └── index.ts
├── Toolbar/
│   ├── Toolbar.css         (4 lines)
│   ├── Toolbar.tsx
│   └── index.ts
├── DocumentsMenu/
│   ├── DocumentsMenu.css   (9 lines)
│   ├── DocumentsMenu.tsx
│   └── index.ts
└── DocumentChrome/
    ├── DocumentHeader.css  (8 lines)
    ├── DocumentFooter.css  (6 lines)
    └── index.ts
```

---

## 5.2 Canvas Migration

### Current CSS Analysis

The Canvas component handles:
- Block rows with hover/active states
- Drag and drop indicators
- AI hidden/locked block states
- Empty document states
- Collapsed block previews

### Migrated Component (Tailwind Classes)

```typescript
// src/components/editor/Canvas/Canvas.tsx
import { cn } from '@/lib/utils';
import { Block, Document } from '@/editor/types';
// ... other imports

interface BlockRowProps {
  block: Block;
  isActive?: boolean;
  isCollapsed?: boolean;
  isAiHidden?: boolean;
  isLocked?: boolean;
  dragOverPosition?: 'top' | 'bottom' | null;
}

function BlockRow({
  block,
  isActive,
  isCollapsed,
  isAiHidden,
  isLocked,
  dragOverPosition,
}: BlockRowProps) {
  return (
    <div
      className={cn(
        // Base styles
        "relative isolate mx-auto my-1.5 px-14 pt-[18px] pb-1.5 rounded-md",
        "transition-[background,box-shadow] duration-120",
        // Hover state
        "hover:bg-[#fafbff] hover:z-[2]",
        // Active state
        isActive && "bg-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)] z-[2]",
        // Collapsed state
        isCollapsed && "bg-[#fbfbfb] pt-[18px]",
        // AI hidden state
        isAiHidden && "bg-pink-50 border border-dashed border-pink-500",
        // Locked state
        isLocked && !isAiHidden && "bg-amber-50 border border-dashed border-amber-500",
        // Combined AI hidden + locked
        isAiHidden && isLocked && "bg-red-50 border border-dashed border-red-600",
        // Drag indicators
        dragOverPosition === 'top' && "before:content-[''] before:absolute before:left-0 before:right-0 before:top-[-1px] before:h-0.5 before:bg-primary",
        dragOverPosition === 'bottom' && "after:content-[''] after:absolute after:left-0 after:right-0 after:bottom-[-1px] after:h-0.5 after:bg-primary",
      )}
    >
      {/* Block state badges */}
      {isAiHidden && (
        <span className="absolute -top-2 left-3 bg-pink-500 text-white text-[10px] px-1.5 py-0.5 rounded-sm font-medium z-[1]">
          🙈 {isLocked ? 'Hidden & Locked' : 'Hidden from AI'}
        </span>
      )}
      {isLocked && !isAiHidden && (
        <span className="absolute -top-2 left-3 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-sm font-medium z-[1]">
          🔒 Locked
        </span>
      )}
      
      {/* Block content */}
      {/* ... rest of block rendering */}
    </div>
  );
}

// Collapsed block preview component
function CollapsedPreview({ block }: { block: Block }) {
  return (
    <div className={cn(
      "inline-flex items-center gap-2 text-gray-500 text-sm",
      "px-3 py-2 rounded-md bg-white/80 border border-black/[0.08]",
      "ml-2 min-h-8 hover:bg-white/95 hover:border-black/[0.12]"
    )}>
      <span className="opacity-80 text-xs text-gray-400">▸</span>
      <span className="font-medium text-gray-700 text-[13px]">{block.type}</span>
      <span className="ml-2 opacity-75 max-w-[520px] truncate text-[13px]">
        {/* Preview text */}
      </span>
    </div>
  );
}

// Empty document state
function EmptyDocState({ onAddBlock }: { onAddBlock: () => void }) {
  return (
    <div className="flex justify-center pt-12 px-4 pb-4">
      <div className="max-w-[720px] w-full border border-dashed border-border rounded-lg bg-[#fafafa] p-6 text-center">
        <h3 className="font-bold text-lg text-gray-900 mb-1.5">Start Writing</h3>
        <p className="text-gray-500 text-sm mb-4">
          Add your first block to get started
        </p>
        <div className="flex gap-2 justify-center flex-wrap mb-2">
          <Button onClick={onAddBlock}>Add Block</Button>
        </div>
        <p className="text-gray-400 text-xs">
          Press / for slash commands
        </p>
      </div>
    </div>
  );
}

// DnD tail dropzone
function DndTail({ isActive }: { isActive?: boolean }) {
  return (
    <div className={cn(
      "relative h-4 my-2",
      isActive && "before:content-[''] before:absolute before:left-0 before:right-0 before:top-1/2 before:-translate-y-1/2 before:h-0.5 before:bg-primary"
    )} />
  );
}

// Main Canvas component
export function Canvas() {
  return (
    <div className="min-h-full flex flex-col gap-3 pb-[calc(32px+48px)]">
      {/* Block rows rendered here */}
    </div>
  );
}
```

---

## 5.3 BlockControls Migration

### Current CSS Analysis

BlockControls includes:
- Icon buttons with hover/active states
- Dropdown menus with arrows
- Inline add button (Jupyter-style)
- Top-right action buttons
- Center editor (floating pill)
- Drag handle
- Segmented controls

### Key Tailwind Patterns

```typescript
// Block control icon button
const IconButton = ({ className, variant, ...props }) => (
  <button
    className={cn(
      "w-[30px] h-[30px] grid place-items-center rounded-md",
      "border border-border bg-white shadow-sm",
      "transition-all duration-120",
      "hover:bg-accent hover:shadow-md",
      "active:translate-y-px active:scale-[0.98]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
      variant === 'danger' && "text-destructive border-destructive hover:bg-red-50",
      className
    )}
    {...props}
  />
);

// Block menu dropdown
const BlockMenu = ({ children }: { children: React.ReactNode }) => (
  <div className={cn(
    "absolute top-[calc(30px+6px)] left-0 z-50",
    "bg-white border border-border rounded-md shadow-md",
    "p-2 min-w-[180px]",
    "animate-in fade-in-0 zoom-in-95 duration-120",
    // Arrow
    "before:content-[''] before:absolute before:-top-1.5 before:left-3.5",
    "before:border-l-[6px] before:border-l-transparent",
    "before:border-r-[6px] before:border-r-transparent",
    "before:border-b-[6px] before:border-b-border",
    "after:content-[''] after:absolute after:-top-[5px] after:left-[15px]",
    "after:border-l-[5px] after:border-l-transparent",
    "after:border-r-[5px] after:border-r-transparent",
    "after:border-b-[5px] after:border-b-white",
  )}>
    {children}
  </div>
);

// Block menu item
const BlockMenuItem = ({ icon, children, ...props }) => (
  <button
    className={cn(
      "w-full flex items-center gap-2 min-h-8 px-2 py-1.5 rounded-sm",
      "text-left transition-colors duration-120",
      "hover:bg-accent",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25"
    )}
    {...props}
  >
    {icon && <span className="w-5 text-center opacity-80">{icon}</span>}
    {children}
  </button>
);

// Inline add button (Jupyter-style)
const InlineAddButton = ({ isOpen }: { isOpen?: boolean }) => (
  <div className={cn(
    "absolute left-1/2 -bottom-3.5 -translate-x-1/2",
    "grid place-items-center z-20",
    "opacity-0 pointer-events-none",
    "group-hover:opacity-100 group-hover:pointer-events-auto",
    isOpen && "opacity-100 pointer-events-auto"
  )}>
    <Button
      variant="outline"
      size="icon-sm"
      className="rounded-full shadow-sm hover:shadow-md"
    >
      +
    </Button>
  </div>
);

// Top-right control bar
const TopRightControls = () => (
  <div className={cn(
    "absolute right-2 -top-6 flex gap-1 px-1.5 py-1",
    "bg-white/95 rounded-md shadow-sm backdrop-blur-sm border border-black/[0.06]",
    "opacity-0 invisible z-[1002]",
    "group-hover:opacity-100 group-hover:visible",
    "transition-opacity duration-120"
  )}>
    {/* Toggle buttons */}
  </div>
);

// Center editor pill
const CenterEditor = () => (
  <div className={cn(
    "absolute left-0 right-0 -top-6 grid place-items-center",
    "opacity-0 pointer-events-none z-[1000]",
    "group-hover:opacity-100",
  )}>
    <div className={cn(
      "bg-white border border-border rounded-full shadow-md",
      "px-1.5 py-1.5 inline-flex items-center gap-2",
      "animate-in fade-in-0 slide-in-from-bottom-1.5 duration-120",
      "pointer-events-auto"
    )}>
      {/* Editor buttons */}
    </div>
  </div>
);

// Segmented control
const SegmentedControl = ({ value, onChange, options }) => (
  <div className="inline-flex border border-slate-200 rounded-md overflow-hidden bg-slate-50 shadow-inner">
    {options.map((opt) => (
      <button
        key={opt.value}
        className={cn(
          "px-3 py-1.5 text-[13px] font-semibold min-w-9",
          "transition-all duration-120 text-slate-600",
          "border-l border-slate-200 first:border-l-0",
          "hover:bg-white hover:text-slate-800",
          value === opt.value && "bg-primary text-white shadow-sm shadow-primary/25"
        )}
        onClick={() => onChange(opt.value)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
```

---

## 5.4 FloatingToolbar Migration

### Migrated Using Popover

```typescript
// src/components/editor/FloatingToolbar/FloatingToolbar.tsx
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Bold, Italic, Underline, Link, Code } from 'lucide-react';

interface FloatingToolbarProps {
  position: { x: number; y: number };
  anchor?: 'center' | 'left';
  visible: boolean;
}

export function FloatingToolbar({ position, anchor = 'center', visible }: FloatingToolbarProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed z-[100] inline-flex gap-1.5 p-1.5",
        "bg-white border border-border rounded-md shadow-md",
        anchor === 'center' && "-translate-x-1/2 -translate-y-2",
        anchor === 'left' && "-translate-y-2"
      )}
      style={{ left: position.x, top: position.y }}
    >
      <Button variant="ghost" size="icon-xs" className="font-bold">
        <Bold className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-xs">
        <Italic className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-xs">
        <Underline className="h-4 w-4" />
      </Button>
      
      <Separator orientation="vertical" className="h-6 mx-1" />
      
      <Button variant="ghost" size="icon-xs">
        <Link className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-xs">
        <Code className="h-4 w-4" />
      </Button>
      
      <Separator orientation="vertical" className="h-6 mx-1" />
      
      {/* AI Actions */}
      <AIActionMenu />
    </div>
  );
}
```

### AIActionMenu with DropdownMenu

```typescript
// src/components/editor/FloatingToolbar/AIActionMenu/AIActionMenu.tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Sparkles, Wand2, CheckCircle, ArrowRight, RefreshCw } from 'lucide-react';

export function AIActionMenu() {
  const actions = [
    { icon: Wand2, label: 'Improve writing', action: 'improve' },
    { icon: CheckCircle, label: 'Fix grammar', action: 'grammar' },
    { icon: ArrowRight, label: 'Continue writing', action: 'continue' },
    { icon: RefreshCw, label: 'Rephrase', action: 'rephrase' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 font-semibold">
          <Sparkles className="h-4 w-4" />
          AI
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        {actions.map((action) => (
          <DropdownMenuItem key={action.action} className="gap-2">
            <action.icon className="h-4 w-4" />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

## 5.5 SlashMenu Migration (Command Component)

### Replace with Command

```typescript
// src/components/editor/SlashMenu/SlashMenu.tsx
import { useState, useEffect } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { 
  Type, Heading1, Heading2, Heading3, 
  Minus, Quote, List, ListOrdered,
  Code, Table, Image, Sparkles,
  Calculator, BarChart, FileText
} from 'lucide-react';

interface SlashMenuProps {
  position: { x: number; y: number };
  visible: boolean;
  onSelect: (item: string) => void;
  onClose: () => void;
}

const menuItems = {
  basic: [
    { id: 'paragraph', icon: Type, label: 'Text', description: 'Plain text block' },
    { id: 'h1', icon: Heading1, label: 'Heading 1', description: 'Large heading' },
    { id: 'h2', icon: Heading2, label: 'Heading 2', description: 'Medium heading' },
    { id: 'h3', icon: Heading3, label: 'Heading 3', description: 'Small heading' },
    { id: 'divider', icon: Minus, label: 'Divider', description: 'Horizontal rule' },
  ],
  media: [
    { id: 'table', icon: Table, label: 'Table', description: 'Insert a table' },
    { id: 'graph', icon: BarChart, label: 'Graph', description: 'Insert a chart' },
    { id: 'image', icon: Image, label: 'Image', description: 'Upload an image' },
  ],
  ai: [
    { id: 'aibeat', icon: Sparkles, label: 'AI Beat', description: 'AI-powered writing' },
    { id: 'equation', icon: Calculator, label: 'Equation', description: 'Math formula' },
    { id: 'citation', icon: FileText, label: 'Citation', description: 'Add a citation' },
  ],
};

export function SlashMenu({ position, visible, onSelect, onClose }: SlashMenuProps) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed z-[150]"
      style={{ left: position.x, top: position.y }}
    >
      <Command className="w-80 max-h-80 border border-border rounded-md shadow-md bg-popover">
        <CommandInput
          placeholder="Search blocks..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No blocks found.</CommandEmpty>
          
          <CommandGroup heading="Basic">
            {menuItems.basic.map((item) => (
              <CommandItem
                key={item.id}
                onSelect={() => {
                  onSelect(item.id);
                  onClose();
                }}
                className="gap-2"
              >
                <item.icon className="h-4 w-4 opacity-70" />
                <div className="flex flex-col items-start">
                  <span className="font-semibold">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
          
          <CommandSeparator />
          
          <CommandGroup heading="Media">
            {menuItems.media.map((item) => (
              <CommandItem
                key={item.id}
                onSelect={() => {
                  onSelect(item.id);
                  onClose();
                }}
                className="gap-2"
              >
                <item.icon className="h-4 w-4 opacity-70" />
                <div className="flex flex-col items-start">
                  <span className="font-semibold">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
          
          <CommandSeparator />
          
          <CommandGroup heading="AI & Advanced">
            {menuItems.ai.map((item) => (
              <CommandItem
                key={item.id}
                onSelect={() => {
                  onSelect(item.id);
                  onClose();
                }}
                className="gap-2"
              >
                <item.icon className="h-4 w-4 opacity-70" />
                <div className="flex flex-col items-start">
                  <span className="font-semibold">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
```

---

## 5.6 ChatAssistant Migration

### Main Chat Panel

```typescript
// src/components/editor/ChatAssistant/ChatAssistant.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatTaggedInput } from './ChatTaggedInput';
import { ChevronUp, ChevronDown, MessageSquare } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function ChatAssistant() {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  return (
    <div
      className={cn(
        "sticky bottom-[45px] z-[1000] -mx-3 mt-3",
        "border-t border-border bg-card shadow-[0_-4px_12px_rgba(0,0,0,0.04)]",
        "rounded-b-lg",
        expanded ? "border border-border mt-3" : "px-3 py-2"
      )}
    >
      {/* Quick toggle button */}
      <Button
        variant="outline"
        size="sm"
        className="absolute -top-[22px] right-3 bg-white shadow-sm"
        onClick={() => setExpanded(!expanded)}
      >
        <MessageSquare className="h-4 w-4 mr-1.5" />
        Chat
        {expanded ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
      </Button>

      {expanded ? (
        <div className="flex flex-col h-[360px]">
          {/* Header */}
          <div className="px-3 py-2 border-b border-border">
            <h3 className="text-sm font-semibold">AI Chat</h3>
            <p className="text-xs text-muted-foreground">Ask questions about your document</p>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-3 bg-accent">
            {messages.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center mt-6">
                Start a conversation...
              </p>
            ) : (
              <div className="space-y-2">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex",
                      msg.role === 'user' ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[70%] px-3 py-2 rounded-xl border",
                        msg.role === 'user'
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-white border-border"
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-border p-3 bg-white">
            <ChatTaggedInput
              placeholder="Ask a question or type # to reference..."
              onSend={(text, refs) => {
                // Handle send
              }}
            />
          </div>
        </div>
      ) : (
        <button
          className="inline-flex items-center gap-2 text-sm"
          onClick={() => setExpanded(true)}
        >
          <span className="w-2 h-2 bg-primary rounded-full" />
          <span>AI Chat</span>
        </button>
      )}
    </div>
  );
}
```

---

## 5.7 DocumentsMenu Migration

```typescript
// src/components/editor/DocumentsMenu/DocumentsMenu.tsx
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';

export function DocumentsMenu() {
  const { documents, activeDocId, setActiveDoc } = useEditor();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        {documents.map((doc) => (
          <button
            key={doc.id}
            className={cn(
              "flex items-center justify-between gap-2 px-2 py-2 rounded-lg",
              "cursor-pointer border border-transparent transition-colors",
              "hover:bg-accent",
              doc.id === activeDocId && "border-border bg-primary/5"
            )}
            onClick={() => setActiveDoc(doc.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{doc.title || 'Untitled'}</div>
              <div className="text-xs text-muted-foreground truncate">
                {doc.blocks?.length || 0} blocks
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

---

## 5.8 DocumentHeader & Footer Migration

### DocumentHeader

```typescript
// src/components/editor/DocumentChrome/DocumentHeader.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEditor } from '@/editor';

export function DocumentHeader() {
  const { activeDoc, updateDoc } = useEditor();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(activeDoc?.title || 'Untitled');

  const handleSave = () => {
    updateDoc({ ...activeDoc, title });
    setEditing(false);
  };

  return (
    <div className={cn(
      "sticky top-0 z-[5] bg-card border-b border-border",
      "px-3 py-2 -mx-3 -mt-3 mb-3 rounded-t-lg",
      "flex items-center gap-2"
    )}>
      <div className="flex items-baseline gap-3">
        {editing ? (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            className="text-xl font-semibold h-auto py-0.5 px-1.5"
            autoFocus
          />
        ) : (
          <button
            className="text-xl font-semibold bg-transparent border-none p-0 cursor-text text-left"
            onClick={() => setEditing(true)}
          >
            {activeDoc?.title || 'Untitled'}
          </button>
        )}
        
        {activeDoc?.id && (
          <Badge variant="outline" className="text-xs">
            {activeDoc.id.slice(0, 8)}
          </Badge>
        )}
      </div>
    </div>
  );
}
```

### DocumentFooter

```typescript
// src/components/editor/DocumentChrome/DocumentFooter.tsx
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';

export function DocumentFooter() {
  const { activeDoc } = useEditor();
  const blockCount = activeDoc?.blocks?.length || 0;
  const wordCount = 0; // Calculate from blocks

  return (
    <div className={cn(
      "sticky bottom-0 z-[1000] flex flex-wrap gap-3",
      "border-t border-border -mx-3 -mb-3 mt-3 px-3 py-2",
      "bg-card rounded-b-lg shadow-[0_-4px_12px_rgba(0,0,0,0.04)]"
    )}>
      <div className="inline-flex gap-2 items-center px-2 py-1 border border-border rounded-md bg-white transition-colors hover:bg-slate-50">
        <span className="text-muted-foreground text-sm">Blocks</span>
        <span className="font-semibold">{blockCount}</span>
      </div>
      <div className="inline-flex gap-2 items-center px-2 py-1 border border-border rounded-md bg-white transition-colors hover:bg-slate-50">
        <span className="text-muted-foreground text-sm">Words</span>
        <span className="font-semibold">{wordCount}</span>
      </div>
    </div>
  );
}
```

---

## 5.9 Files to Delete After Migration

- [ ] `src/components/editor/Canvas/Canvas.css`
- [ ] `src/components/editor/BlockControls/BlockControls.css`
- [ ] `src/components/editor/FloatingToolbar/FloatingToolbar.css`
- [ ] `src/components/editor/FloatingToolbar/AIActionMenu/AIActionMenu.css`
- [ ] `src/components/editor/SlashMenu/SlashMenu.css`
- [ ] `src/components/editor/ChatAssistant/ChatAssistant.css`
- [ ] `src/components/editor/ChatAssistant/ChatRefPicker/ChatRefPicker.css`
- [ ] `src/components/editor/ChatAssistant/ChatRefTags/ChatRefTags.css`
- [ ] `src/components/editor/ChatAssistant/ChatTaggedInput/ChatTaggedInput.css`
- [ ] `src/components/editor/Toolbar/Toolbar.css`
- [ ] `src/components/editor/DocumentsMenu/DocumentsMenu.css`
- [ ] `src/components/editor/DocumentChrome/DocumentHeader.css`
- [ ] `src/components/editor/DocumentChrome/DocumentFooter.css`

---

## 5.10 Verification Checklist

- [ ] Canvas renders all block types correctly
- [ ] Block hover/active states work
- [ ] Drag and drop indicators appear
- [ ] AI hidden/locked badges display
- [ ] BlockControls menus open/close
- [ ] Inline add button appears on hover
- [ ] Segmented controls toggle correctly
- [ ] FloatingToolbar positions correctly
- [ ] SlashMenu filters items
- [ ] ChatAssistant expands/collapses
- [ ] Chat messages display correctly
- [ ] Document header title editing works
- [ ] Document footer stats display

---

## Next Phase

Continue to **[Phase 6: Panel Components](./06-panel-components.md)** to migrate ArxivPanel, ChatsPanel, LibraryPanel, and other panels.
