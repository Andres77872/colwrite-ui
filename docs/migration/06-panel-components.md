# Phase 6: Panel Components Migration

## Overview

This phase covers migrating the panel components: ArxivPanel, ChatsPanel, ColpaliPanel, JsonPanel, LibraryPanel, ToolsRail, and ToolsAside.

---

## 6.1 Component Inventory

### Current Panel Structure

```
src/components/panels/
├── ArxivPanel/
│   ├── ArxivPanel.css      (214 lines)
│   ├── ArxivPanel.tsx
│   └── index.ts
├── ChatsPanel/
│   ├── ChatsPanel.css      (70 lines)
│   ├── ChatsPanel.tsx
│   └── index.ts
├── ColpaliPanel/
│   ├── ColpaliPanel.css    (219 lines)
│   ├── ColpaliPanel.tsx
│   └── index.ts
├── JsonPanel/
│   ├── JsonPanel.css       (3 lines)
│   ├── JsonPanel.tsx
│   └── index.ts
├── LibraryPanel/
│   ├── LibraryPanel.css    (123 lines)
│   ├── LibraryPanel.tsx
│   └── index.ts
├── toolsRail/
│   ├── toolsRail.css       (10 lines)
│   └── ToolsRail.tsx
├── toolsAside/
│   ├── toolsAside.css      (6 lines)
│   └── ToolsAside.tsx
├── panelsContext.tsx
└── index.ts
```

---

## 6.2 Shared Panel Components

### Panel Container

```typescript
// src/components/panels/shared/PanelContainer.tsx
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PanelContainerProps {
  children: React.ReactNode;
  className?: string;
  busy?: boolean;
}

export function PanelContainer({ children, className, busy }: PanelContainerProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 h-full overflow-hidden",
        busy && "opacity-80",
        className
      )}
      aria-busy={busy}
    >
      {children}
    </div>
  );
}

export function PanelSearch({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-center">
      {children}
    </div>
  );
}

export function PanelList({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-2">
        {children}
      </div>
    </ScrollArea>
  );
}

export function PanelEmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center flex-1">
      <span className="text-5xl mb-3 opacity-50">{icon}</span>
      <h3 className="font-semibold mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-[280px]">{description}</p>
      )}
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return (
    <div className="text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/20 text-sm">
      {message}
    </div>
  );
}
```

---

## 6.3 ArxivPanel Migration

```typescript
// src/components/panels/ArxivPanel/ArxivPanel.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, ExternalLink, Download } from 'lucide-react';
import { PanelContainer, PanelSearch, PanelEmptyState, PanelError } from './shared/PanelContainer';

interface ArxivResult {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  score?: number;
  pdfUrl: string;
  arxivUrl: string;
}

export function ArxivPanel() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [results, setResults] = useState<ArxivResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    // ... search logic
    setLoading(false);
  };

  return (
    <PanelContainer busy={loading}>
      {/* Search Form */}
      <PanelSearch>
        <Input
          placeholder="Search papers..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          disabled={loading}
          className="flex-1"
        />
        <Select value={category} onValueChange={setCategory} disabled={loading}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="cs">CS</SelectItem>
            <SelectItem value="physics">Physics</SelectItem>
            <SelectItem value="math">Math</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleSearch} disabled={loading}>
          <Search className="h-4 w-4" />
        </Button>
      </PanelSearch>

      {/* Error */}
      {error && <PanelError message={error} />}

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3">
          {results.length === 0 && !loading && (
            <PanelEmptyState
              icon="📚"
              title="Search arXiv"
              description="Enter keywords to find relevant papers"
            />
          )}

          {results.map((result, index) => {
            const isExpanded = expandedIds.has(result.id);
            return (
              <Card key={result.id}>
                <CardContent className="p-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn(
                      "w-8 h-8 rounded-md grid place-items-center",
                      "bg-accent border border-border text-muted-foreground",
                      "font-bold text-sm"
                    )}>
                      {index + 1}
                    </div>
                    {result.score && (
                      <Badge variant="outline" className="bg-primary/10 text-primary">
                        {(result.score * 100).toFixed(0)}% match
                      </Badge>
                    )}
                  </div>

                  {/* Title */}
                  <h4 className="font-semibold text-base leading-snug mb-2">
                    <a
                      href={result.arxivUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary hover:underline"
                    >
                      {result.title}
                    </a>
                  </h4>

                  {/* Meta */}
                  <div className="text-sm text-muted-foreground mb-3 leading-snug">
                    <span className="font-medium">{result.authors.join(', ')}</span>
                    <span className="opacity-80"> · {result.published}</span>
                  </div>

                  {/* Abstract */}
                  <div className="mb-3">
                    <p className={cn(
                      "text-sm leading-relaxed",
                      !isExpanded && "line-clamp-4"
                    )}>
                      {result.abstract}
                    </p>
                    {result.abstract.length > 300 && (
                      <button
                        className="text-sm font-medium text-primary hover:underline mt-1"
                        onClick={() => toggleExpand(result.id)}
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 flex-wrap">
                    <a
                      href={result.arxivUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "text-sm font-medium text-primary",
                        "px-2 py-1 rounded-md border border-transparent",
                        "hover:bg-primary/10 hover:border-border"
                      )}
                    >
                      <ExternalLink className="inline h-3.5 w-3.5 mr-1" />
                      View on arXiv
                    </a>
                    <a
                      href={result.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "text-sm font-medium text-primary",
                        "px-2 py-1 rounded-md border border-transparent",
                        "hover:bg-primary/10 hover:border-border"
                      )}
                    >
                      <Download className="inline h-3.5 w-3.5 mr-1" />
                      PDF
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </PanelContainer>
  );
}
```

---

## 6.4 ChatsPanel Migration

```typescript
// src/components/panels/ChatsPanel/ChatsPanel.tsx
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Search, MessageSquare, Trash2 } from 'lucide-react';
import { PanelContainer, PanelSearch, PanelEmptyState, PanelError } from './shared/PanelContainer';

interface ChatSession {
  id: string;
  title: string;
  lastMessage?: string;
  updatedAt: string;
}

interface ChatsPanelProps {
  sessions: ChatSession[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  error?: string;
}

export function ChatsPanel({ sessions, selectedId, onSelect, onDelete, error }: ChatsPanelProps) {
  return (
    <PanelContainer>
      <PanelSearch>
        <Input placeholder="Search chats..." className="flex-1" />
        <Button variant="outline" size="icon">
          <Search className="h-4 w-4" />
        </Button>
      </PanelSearch>

      {error && <PanelError message={error} />}

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2">
          {sessions.length === 0 ? (
            <PanelEmptyState
              icon="💬"
              title="No Chats Yet"
              description="Start a conversation to see your chat history"
            />
          ) : (
            sessions.map((session) => (
              <Card
                key={session.id}
                className={cn(
                  "cursor-pointer transition-colors",
                  "hover:bg-accent",
                  selectedId === session.id && "bg-primary/5 border-primary",
                  "focus-within:ring-2 focus-within:ring-primary/25 focus-within:ring-offset-2"
                )}
                tabIndex={0}
                onClick={() => onSelect(session.id)}
              >
                <div className="grid grid-cols-[32px_1fr_auto] gap-3 items-center p-3">
                  <div className={cn(
                    "w-8 h-8 rounded-md grid place-items-center",
                    "bg-accent border border-border"
                  )}>
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </div>
                  
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{session.title}</div>
                    <div className="text-sm text-muted-foreground truncate">
                      {session.lastMessage || 'No messages'}
                    </div>
                  </div>
                  
                  <div className={cn(
                    "flex gap-2 opacity-0 transition-opacity",
                    "group-hover:opacity-100",
                    selectedId === session.id && "opacity-100"
                  )}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(session.id);
                      }}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </PanelContainer>
  );
}
```

---

## 6.5 LibraryPanel Migration

```typescript
// src/components/panels/LibraryPanel/LibraryPanel.tsx
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, FileText, Search, Eye, Trash2 } from 'lucide-react';
import { PanelContainer, PanelSearch, PanelEmptyState, PanelError } from './shared/PanelContainer';

interface LibraryItem {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
}

export function LibraryPanel() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<LibraryItem | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Handle file drop
  }, []);

  return (
    <PanelContainer>
      {/* Dropzone */}
      <div
        className={cn(
          "p-6 text-center border border-dashed rounded-lg",
          "bg-card transition-colors",
          isDragging && "bg-primary/10 border-primary"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Upload className="h-10 w-10 mx-auto mb-2 opacity-60" />
        <div className="font-semibold mb-1">Drop files here</div>
        <p className="text-sm text-muted-foreground">or click to browse</p>
      </div>

      {/* Search */}
      <PanelSearch>
        <Input placeholder="Search library..." className="flex-1" />
        <Button variant="outline" size="icon">
          <Search className="h-4 w-4" />
        </Button>
      </PanelSearch>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <PanelEmptyState
              icon="📁"
              title="Library Empty"
              description="Upload PDFs and documents to use as references"
            />
          ) : (
            items.map((item) => (
              <Card
                key={item.id}
                className={cn(
                  "cursor-pointer transition-colors",
                  "hover:bg-accent hover:border-border",
                  selectedId === item.id && "bg-primary/5 border-primary"
                )}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="grid grid-cols-[32px_1fr_auto] gap-3 items-center p-3">
                  <div className={cn(
                    "w-8 h-8 rounded-md grid place-items-center",
                    "bg-accent border border-border"
                  )}>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{item.name}</div>
                    <div className="text-sm text-muted-foreground truncate">
                      {item.type} · {item.uploadedAt}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreview(item);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Preview */}
      {preview && (
        <div className="flex flex-col gap-2 p-2">
          <div className="flex items-center justify-between px-2">
            <span className="font-semibold">{preview.name}</span>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              Close
            </Button>
          </div>
          <div className="border border-border rounded-md overflow-hidden">
            <iframe
              src={`/api/library/${preview.id}/preview`}
              className="w-full h-[420px] border-0 bg-white block"
            />
          </div>
        </div>
      )}
    </PanelContainer>
  );
}
```

---

## 6.6 JsonPanel Migration

```typescript
// src/components/panels/JsonPanel/JsonPanel.tsx
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface JsonPanelProps {
  value: string;
  onChange: (value: string) => void;
  onApply?: () => void;
}

export function JsonPanel({ value, onChange, onApply }: JsonPanelProps) {
  return (
    <div className="flex flex-col gap-2 h-full">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "flex-1 min-h-[200px] font-mono text-sm",
          "leading-relaxed p-2.5"
        )}
        placeholder="Paste or edit JSON..."
      />
      {onApply && (
        <Button onClick={onApply}>Apply Changes</Button>
      )}
    </div>
  );
}
```

---

## 6.7 ToolsRail Migration

```typescript
// src/components/panels/toolsRail/ToolsRail.tsx
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePanels } from '../panelsContext';
import { BookOpen, MessageSquare, Search, FileCode, Image } from 'lucide-react';

const tools = [
  { id: 'library', icon: BookOpen, label: 'Library' },
  { id: 'chats', icon: MessageSquare, label: 'Chats' },
  { id: 'arxiv', icon: Search, label: 'arXiv' },
  { id: 'json', icon: FileCode, label: 'JSON' },
  { id: 'colpali', icon: Image, label: 'ColPali' },
];

export function ToolsRail() {
  const { activePanel, setActivePanel } = usePanels();

  return (
    <div className="h-full flex flex-col items-center gap-3">
      {/* Header/Logo */}
      <div className="py-2">
        <div className={cn(
          "w-7 h-7 rounded-md grid place-items-center",
          "bg-gradient-to-br from-primary to-primary/80",
          "text-white font-bold text-sm"
        )}>
          CW
        </div>
      </div>

      {/* Tools */}
      <div className="flex flex-col gap-2">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activePanel === tool.id;
          
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="icon-sm"
                  className={cn(
                    "w-8 h-8",
                    isActive && "bg-primary/10 text-primary border-primary"
                  )}
                  onClick={() => setActivePanel(isActive ? null : tool.id)}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {tool.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-auto py-2 text-[11px] text-muted-foreground">
        v0.1
      </div>
    </div>
  );
}
```

---

## 6.8 ToolsAside Migration

```typescript
// src/components/panels/toolsAside/ToolsAside.tsx
import { usePanels } from '../panelsContext';
import { ArxivPanel } from '../ArxivPanel';
import { ChatsPanel } from '../ChatsPanel';
import { ColpaliPanel } from '../ColpaliPanel';
import { JsonPanel } from '../JsonPanel';
import { LibraryPanel } from '../LibraryPanel';

export function ToolsAside() {
  const { activePanel } = usePanels();

  if (!activePanel) {
    return (
      <div className="h-full grid place-items-center gap-1.5 p-3 text-center">
        <span className="font-semibold">Select a Tool</span>
        <p className="text-sm text-muted-foreground">
          Choose a tool from the rail to get started
        </p>
      </div>
    );
  }

  switch (activePanel) {
    case 'library':
      return <LibraryPanel />;
    case 'chats':
      return <ChatsPanel sessions={[]} selectedId={undefined} onSelect={() => {}} onDelete={() => {}} />;
    case 'arxiv':
      return <ArxivPanel />;
    case 'json':
      return <JsonPanel value="" onChange={() => {}} />;
    case 'colpali':
      return <ColpaliPanel />;
    default:
      return null;
  }
}
```

---

## 6.9 Create Tooltip Component

```typescript
// src/components/ui/tooltip.tsx
import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

Add `@radix-ui/react-tooltip` to dependencies.

---

## 6.10 Files to Delete After Migration

- [ ] `src/components/panels/ArxivPanel/ArxivPanel.css`
- [ ] `src/components/panels/ChatsPanel/ChatsPanel.css`
- [ ] `src/components/panels/ColpaliPanel/ColpaliPanel.css`
- [ ] `src/components/panels/JsonPanel/JsonPanel.css`
- [ ] `src/components/panels/LibraryPanel/LibraryPanel.css`
- [ ] `src/components/panels/toolsRail/toolsRail.css`
- [ ] `src/components/panels/toolsAside/toolsAside.css`

---

## 6.11 Verification Checklist

- [ ] ArxivPanel search works
- [ ] ArxivPanel results display correctly
- [ ] ArxivPanel abstract expand/collapse works
- [ ] ChatsPanel list renders
- [ ] ChatsPanel selection highlights
- [ ] LibraryPanel dropzone accepts files
- [ ] LibraryPanel preview works
- [ ] JsonPanel textarea editable
- [ ] ToolsRail tooltips show on hover
- [ ] ToolsRail active state highlights
- [ ] ToolsAside renders correct panel
- [ ] All panels responsive

---

## Next Phase

Continue to **[Phase 7: Inline Components](./07-inline-components.md)** to migrate Citation, Equation, Graph, Table, and AIBeat inline widgets.
