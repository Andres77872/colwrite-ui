# Phase 7: Inline Components Migration

## Overview

This phase covers migrating the inline editor components: CitationInline, EquationInline, GraphInline, TableInline, and AiBeatInline. These are complex widgets embedded within the contenteditable editor.

---

## 7.1 Component Inventory

### Current Inline Structure

```
src/components/editor/blocks/ParagraphBlock/Inlines/
├── AiBeatInline/
│   ├── AiBeatInline.css    (27 lines)
│   ├── AiBeatInline.tsx
│   └── index.ts
├── CitationInline/
│   ├── CitationInline.css  (15 lines)
│   ├── CitationInline.tsx
│   └── index.ts
├── EquationInline/
│   ├── EquationInline.css  (17 lines)
│   ├── EquationInline.tsx
│   └── index.ts
├── GraphInline/
│   ├── GraphInline.css     (24 lines)
│   ├── GraphInline.tsx
│   └── index.ts
├── TableInline/
│   ├── TableInline.css     (15 lines)
│   ├── TableInline.tsx
│   └── index.ts
└── index.ts
```

---

## 7.2 Shared Inline Components

### Inline Pill Component

```typescript
// src/components/editor/blocks/ParagraphBlock/Inlines/shared/InlinePill.tsx
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

interface InlinePillProps {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  showCaret?: boolean;
}

export function InlinePill({ icon, label, onClick, className, showCaret = true }: InlinePillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5",
        "border border-border rounded-full bg-white",
        "text-sm cursor-pointer shadow-xs",
        "hover:bg-accent transition-colors",
        className
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
      {showCaret && <ChevronDown className="h-3 w-3 opacity-60" />}
    </button>
  );
}
```

### Inline Editor Popover

```typescript
// src/components/editor/blocks/ParagraphBlock/Inlines/shared/InlineEditor.tsx
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface InlineEditorProps {
  children: React.ReactNode;
  className?: string;
}

export function InlineEditor({ children, className }: InlineEditorProps) {
  return (
    <div className={cn(
      "absolute top-[calc(100%+6px)] left-0 z-10",
      "min-w-[380px] bg-white border border-border rounded-md shadow-sm p-2.5",
      className
    )}>
      {children}
    </div>
  );
}

interface InlineFieldProps {
  label: string;
  children: React.ReactNode;
}

export function InlineField({ label, children }: InlineFieldProps) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2 last:mb-0">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function InlineInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "h-8 px-2 py-1.5 text-sm",
        "focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-transparent",
        className
      )}
      {...props}
    />
  );
}

interface InlineActionsProps {
  onDelete?: () => void;
  children?: React.ReactNode;
}

export function InlineActions({ onDelete, children }: InlineActionsProps) {
  return (
    <div className="flex justify-end gap-2 mt-1.5">
      {onDelete && (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-red-200"
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
      {children}
    </div>
  );
}
```

---

## 7.3 CitationInline Migration

```typescript
// src/components/editor/blocks/ParagraphBlock/Inlines/CitationInline/CitationInline.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';
import {
  InlinePill,
  InlineEditor,
  InlineField,
  InlineInput,
  InlineActions,
} from '../shared';

interface CitationData {
  id: string;
  authors?: string;
  title?: string;
  year?: string;
  journal?: string;
  doi?: string;
}

interface CitationInlineProps {
  data: CitationData;
  onChange: (data: CitationData) => void;
  onDelete: () => void;
}

export function CitationInline({ data, onChange, onDelete }: CitationInlineProps) {
  const [isOpen, setIsOpen] = useState(false);

  const displayLabel = data.authors
    ? `${data.authors.split(',')[0]}${data.year ? ` (${data.year})` : ''}`
    : 'Citation';

  return (
    <span className="relative inline-flex items-center">
      <InlinePill
        icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
        label={displayLabel}
        onClick={() => setIsOpen(!isOpen)}
      />

      {isOpen && (
        <InlineEditor className="min-w-[380px]">
          <InlineField label="Authors">
            <InlineInput
              value={data.authors || ''}
              onChange={(e) => onChange({ ...data, authors: e.target.value })}
              placeholder="Smith, J. et al."
            />
          </InlineField>
          
          <InlineField label="Title">
            <InlineInput
              value={data.title || ''}
              onChange={(e) => onChange({ ...data, title: e.target.value })}
              placeholder="Paper title"
            />
          </InlineField>
          
          <InlineField label="Year">
            <InlineInput
              value={data.year || ''}
              onChange={(e) => onChange({ ...data, year: e.target.value })}
              placeholder="2024"
            />
          </InlineField>
          
          <InlineField label="Journal">
            <InlineInput
              value={data.journal || ''}
              onChange={(e) => onChange({ ...data, journal: e.target.value })}
              placeholder="Nature"
            />
          </InlineField>
          
          <InlineField label="DOI">
            <InlineInput
              value={data.doi || ''}
              onChange={(e) => onChange({ ...data, doi: e.target.value })}
              placeholder="10.1000/xyz123"
            />
          </InlineField>

          <InlineActions onDelete={onDelete} />
        </InlineEditor>
      )}
    </span>
  );
}
```

---

## 7.4 EquationInline Migration

```typescript
// src/components/editor/blocks/ParagraphBlock/Inlines/EquationInline/EquationInline.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Calculator } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  InlinePill,
  InlineEditor,
  InlineField,
  InlineInput,
  InlineActions,
} from '../shared';

interface EquationData {
  id: string;
  latex: string;
  displayMode?: boolean;
  label?: string;
}

interface EquationInlineProps {
  data: EquationData;
  onChange: (data: EquationData) => void;
  onDelete: () => void;
}

export function EquationInline({ data, onChange, onDelete }: EquationInlineProps) {
  const [isOpen, setIsOpen] = useState(false);

  const displayLabel = data.latex
    ? data.latex.slice(0, 20) + (data.latex.length > 20 ? '...' : '')
    : 'Equation';

  return (
    <span className="relative inline-flex items-center">
      <InlinePill
        icon={<Calculator className="h-3.5 w-3.5 text-muted-foreground" />}
        label={displayLabel}
        onClick={() => setIsOpen(!isOpen)}
        className="font-mono"
      />

      {isOpen && (
        <InlineEditor className="min-w-[420px]">
          <InlineField label="LaTeX">
            <InlineInput
              value={data.latex}
              onChange={(e) => onChange({ ...data, latex: e.target.value })}
              placeholder="E = mc^2"
              className="font-mono"
            />
          </InlineField>
          
          <InlineField label="Label">
            <InlineInput
              value={data.label || ''}
              onChange={(e) => onChange({ ...data, label: e.target.value })}
              placeholder="eq:1"
            />
          </InlineField>
          
          <InlineField label="Display Mode">
            <div className="flex items-center">
              <Checkbox
                checked={data.displayMode}
                onCheckedChange={(checked) =>
                  onChange({ ...data, displayMode: checked as boolean })
                }
              />
            </div>
          </InlineField>

          {/* Preview */}
          <div className="mt-1.5 p-2 bg-accent rounded-md text-sm">
            <div className="text-xs text-muted-foreground mb-1">Preview</div>
            {data.latex ? (
              <div className="text-center py-2">
                {/* Render LaTeX preview here - use KaTeX or MathJax */}
                <code className="font-mono">{data.latex}</code>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-2">
                Enter LaTeX to preview
              </div>
            )}
          </div>

          <InlineActions onDelete={onDelete} />
        </InlineEditor>
      )}
    </span>
  );
}
```

---

## 7.5 GraphInline Migration

```typescript
// src/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/GraphInline.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { BarChart3 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  InlineEditor,
  InlineField,
  InlineInput,
  InlineActions,
} from '../shared';

interface GraphData {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'scatter';
  data: string; // JSON string
  caption?: string;
}

interface GraphInlineProps {
  data: GraphData;
  onChange: (data: GraphData) => void;
  onDelete: () => void;
}

export function GraphInline({ data, onChange, onDelete }: GraphInlineProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateData = (jsonStr: string) => {
    try {
      JSON.parse(jsonStr);
      setError(null);
      return true;
    } catch {
      setError('Invalid JSON data');
      return false;
    }
  };

  return (
    <div className="relative block my-2">
      {/* Figure Display */}
      <figure
        className={cn(
          "block border border-border rounded-lg bg-white shadow-xs p-2",
          "cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        )}
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="max-w-[520px] mx-auto">
          {/* Chart placeholder - replace with actual chart library */}
          <div className="bg-accent h-48 rounded-md flex items-center justify-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground" />
          </div>
        </div>
        {data.caption && (
          <figcaption className="mt-1.5 text-xs text-muted-foreground text-center">
            {data.caption}
          </figcaption>
        )}
      </figure>

      {/* Editor Popover */}
      {isOpen && (
        <InlineEditor className="min-w-[460px]">
          <InlineField label="Chart Type">
            <Select
              value={data.type}
              onValueChange={(value) =>
                onChange({ ...data, type: value as GraphData['type'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bar">Bar Chart</SelectItem>
                <SelectItem value="line">Line Chart</SelectItem>
                <SelectItem value="pie">Pie Chart</SelectItem>
                <SelectItem value="scatter">Scatter Plot</SelectItem>
              </SelectContent>
            </Select>
          </InlineField>
          
          <InlineField label="Data (JSON)">
            <Textarea
              value={data.data}
              onChange={(e) => {
                validateData(e.target.value);
                onChange({ ...data, data: e.target.value });
              }}
              placeholder='{"labels": ["A", "B"], "values": [10, 20]}'
              className="font-mono text-sm min-h-[80px]"
            />
          </InlineField>
          
          <InlineField label="Caption">
            <InlineInput
              value={data.caption || ''}
              onChange={(e) => onChange({ ...data, caption: e.target.value })}
              placeholder="Figure 1: Chart description"
            />
          </InlineField>

          {error && (
            <div className="mt-1.5 text-xs text-destructive">{error}</div>
          )}

          {/* Preview */}
          <div className="mt-1.5 p-2 bg-accent rounded-md">
            <div className="flex items-center justify-center h-24">
              {error ? (
                <span className="text-muted-foreground">Invalid data</span>
              ) : (
                <BarChart3 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
          </div>

          <InlineActions onDelete={onDelete} />
        </InlineEditor>
      )}
    </div>
  );
}
```

---

## 7.6 TableInline Migration

```typescript
// src/components/editor/blocks/ParagraphBlock/Inlines/TableInline/TableInline.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus, Trash2 } from 'lucide-react';

interface TableData {
  id: string;
  headers: string[];
  rows: string[][];
}

interface TableInlineProps {
  data: TableData;
  onChange: (data: TableData) => void;
  onDelete: () => void;
}

export function TableInline({ data, onChange, onDelete }: TableInlineProps) {
  const addColumn = () => {
    onChange({
      ...data,
      headers: [...data.headers, ''],
      rows: data.rows.map((row) => [...row, '']),
    });
  };

  const removeColumn = (index: number) => {
    if (data.headers.length <= 1) return;
    onChange({
      ...data,
      headers: data.headers.filter((_, i) => i !== index),
      rows: data.rows.map((row) => row.filter((_, i) => i !== index)),
    });
  };

  const addRow = () => {
    onChange({
      ...data,
      rows: [...data.rows, new Array(data.headers.length).fill('')],
    });
  };

  const removeRow = (index: number) => {
    if (data.rows.length <= 1) return;
    onChange({
      ...data,
      rows: data.rows.filter((_, i) => i !== index),
    });
  };

  const updateHeader = (index: number, value: string) => {
    const headers = [...data.headers];
    headers[index] = value;
    onChange({ ...data, headers });
  };

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    const rows = data.rows.map((row, ri) =>
      ri === rowIndex
        ? row.map((cell, ci) => (ci === colIndex ? value : cell))
        : row
    );
    onChange({ ...data, rows });
  };

  return (
    <div className={cn(
      "relative inline-flex flex-col gap-2",
      "bg-accent p-2 rounded-md",
      "shadow-[inset_0_0_0_1px_var(--color-border)]"
    )}>
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addColumn}>
          <Plus className="h-3 w-3 mr-1" /> Column
        </Button>
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3 w-3 mr-1" /> Row
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-red-200"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-auto max-w-[70vw] rounded-md shadow-sm">
        <table className="border-collapse bg-white text-sm">
          <thead>
            <tr>
              {data.headers.map((header, i) => (
                <th key={i} className="border border-border p-0 sticky top-0 bg-white z-[1]">
                  <Input
                    value={header}
                    onChange={(e) => updateHeader(i, e.target.value)}
                    className="border-0 px-2.5 py-2 w-[140px] font-bold bg-transparent rounded-none focus-visible:ring-inset"
                    placeholder={`Header ${i + 1}`}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={cn(rowIndex % 2 === 0 && "bg-slate-50/50")}>
                {row.map((cell, colIndex) => (
                  <td key={colIndex} className="border border-border p-0">
                    <Input
                      value={cell}
                      onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                      className="border-0 px-2.5 py-2 w-[140px] bg-transparent rounded-none focus-visible:ring-inset"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stats */}
      <div className="text-xs text-muted-foreground">
        {data.headers.length} columns × {data.rows.length} rows
      </div>
    </div>
  );
}
```

---

## 7.7 AiBeatInline Migration

```typescript
// src/components/editor/blocks/ParagraphBlock/Inlines/AiBeatInline/AiBeatInline.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Sparkles, X, ChevronUp, Check, RefreshCw, Loader2 } from 'lucide-react';

interface AiBeatData {
  id: string;
  context: string;
  prompt: string;
  output?: string;
}

interface AiBeatInlineProps {
  data: AiBeatData;
  onChange: (data: AiBeatData) => void;
  onAccept: (text: string) => void;
  onDelete: () => void;
}

export function AiBeatInline({ data, onChange, onAccept, onDelete }: AiBeatInlineProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      // Call AI generation API
      // const result = await generateAiBeat(data.context, data.prompt);
      // onChange({ ...data, output: result });
    } catch (err) {
      setError('Generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (collapsed) {
    return (
      <button
        className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-md bg-amber-50 text-sm"
        onClick={() => setCollapsed(false)}
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span>AI Beat</span>
        <ChevronUp className="h-3 w-3" />
      </button>
    );
  }

  return (
    <div className={cn(
      "relative inline-flex flex-col gap-2",
      "bg-accent p-2 pb-10 rounded-md",
      "shadow-[inset_0_0_0_1px_var(--color-border)]"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-xs opacity-80">✨ AI Beat</span>
        <div className="inline-flex gap-1">
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={onDelete}
            className="text-destructive"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Context Input */}
      <Textarea
        value={data.context}
        onChange={(e) => onChange({ ...data, context: e.target.value })}
        placeholder="Describe what you want to write about..."
        className="min-w-[36ch] resize-y text-sm"
      />

      {/* Prompt Row */}
      <div className="flex items-center gap-1.5 opacity-85">
        <span className="text-xs text-muted-foreground">Prompt:</span>
        <Input
          value={data.prompt}
          onChange={(e) => onChange({ ...data, prompt: e.target.value })}
          placeholder="Optional additional instructions..."
          className="flex-1 min-w-[24ch] h-7 text-sm"
        />
      </div>

      {/* Output */}
      {data.output && (
        <div className={cn(
          "bg-amber-50 border border-dashed border-amber-400 rounded-md",
          "p-2 whitespace-pre-wrap break-words text-sm",
          isGenerating && "animate-pulse"
        )}>
          {data.output}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-destructive bg-red-50 border border-red-200 rounded-md p-1.5">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="absolute right-2 bottom-2 inline-flex gap-1.5">
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating || !data.context}
          className="bg-primary text-white"
        >
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          Generate
        </Button>
        
        {data.output && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...data, output: '' })}
              disabled={isGenerating}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => onAccept(data.output!)}
              disabled={isGenerating}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Accept
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

---

## 7.8 Editable Component Updates

The `Editable` component needs minor updates to work with Tailwind:

```typescript
// src/components/common/Editable/Editable.tsx
import { cn } from '@/lib/utils';

export function Editable({ className, ...props }: EditableProps) {
  return (
    <div
      contentEditable
      className={cn(
        "outline-none min-h-6 px-2 py-1.5 rounded-md",
        "transition-[background,box-shadow] duration-120",
        "break-words overflow-wrap-anywhere",
        // Focus state
        "focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-border)]",
        // Reserve focus ring space
        "shadow-[inset_0_0_0_1px_transparent]",
        className
      )}
      {...props}
    />
  );
}
```

Delete `src/components/common/Editable/Editable.css` after migration.

---

## 7.9 Create Checkbox Component

```typescript
// src/components/ui/checkbox.tsx
import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
```

Add `@radix-ui/react-checkbox` to dependencies.

---

## 7.10 Files to Delete After Migration

- [ ] `src/components/editor/blocks/ParagraphBlock/Inlines/AiBeatInline/AiBeatInline.css`
- [ ] `src/components/editor/blocks/ParagraphBlock/Inlines/CitationInline/CitationInline.css`
- [ ] `src/components/editor/blocks/ParagraphBlock/Inlines/EquationInline/EquationInline.css`
- [ ] `src/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/GraphInline.css`
- [ ] `src/components/editor/blocks/ParagraphBlock/Inlines/TableInline/TableInline.css`
- [ ] `src/components/common/Editable/Editable.css`
- [ ] `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.css`
- [ ] `src/components/editor/blocks/HeadingBlock/HeadingBlock.css`
- [ ] `src/components/editor/blocks/DividerBlock/DividerBlock.css`

---

## 7.11 Verification Checklist

- [ ] CitationInline pill displays correctly
- [ ] CitationInline editor popover opens/closes
- [ ] EquationInline shows LaTeX preview
- [ ] GraphInline figure renders
- [ ] GraphInline editor validates JSON
- [ ] TableInline adds/removes columns
- [ ] TableInline adds/removes rows
- [ ] TableInline cells are editable
- [ ] AiBeatInline generates content
- [ ] AiBeatInline accept inserts text
- [ ] All inline popovers position correctly
- [ ] Keyboard navigation works

---

## Next Phase

Continue to **[Phase 8: Cleanup & Polish](./08-cleanup-polish.md)** to remove remaining CSS files and finalize the migration.
