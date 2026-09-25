import { useState } from 'react';
import { Code2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { findItemNode } from '@/lib/figure/edit';
import { labelText } from '@/lib/figure/labels';
import { figurePalette } from '@/lib/figure/palette';
import { ROLES, SHAPES, TONES } from '@/lib/figure/vocabulary';
import type { CompiledFigure, JsonNode, JsonValue, Tone } from '@/lib/figure/types';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type FigureSelection = { id: string; kind: 'node' | 'group' | 'edge' };
export type FigureEdit = Array<[key: string, value: JsonValue | undefined]>;

function plain(node: JsonNode | undefined): JsonValue | undefined {
  if (!node) return undefined;
  switch (node.kind) {
    case 'object':
      return Object.fromEntries(node.members.map((member) => [member.key, plain(member.value) ?? null]));
    case 'array':
      return node.items.map((item) => plain(item) ?? null);
    case 'null':
      return null;
    default:
      return node.value;
  }
}

function stringOf(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

const BORDERS = ['solid', 'dashed', 'dotted', 'bold', 'none'] as const;
const LAYOUTS = ['flow', 'row', 'column', 'grid'] as const;
const DIRECTIONS = ['down', 'up', 'right', 'left'] as const;

/**
 * Quick edits for the item clicked in the preview.
 *
 * Every change is written into the source text in place (`setItemProperty`),
 * so the JSON stays the single truth, comments and formatting survive, and
 * the assistant sees exactly what the author sees. Choosing a role clears an
 * explicit shape and tone, because those would otherwise win over it; clearing
 * the role leaves them be.
 */
export function FigureInspector({
  selection,
  compiled,
  onEdit,
  onReveal,
  onClose,
}: {
  selection: FigureSelection;
  compiled: CompiledFigure;
  onEdit: (id: string, changes: FigureEdit) => void;
  onReveal: () => void;
  onClose: () => void;
}) {
  const { resolved } = useTheme();
  const palette = figurePalette(resolved, compiled.model?.palette ?? 'color');
  const item = compiled.model?.items.get(selection.id);
  const edge = selection.kind === 'edge' ? compiled.model?.edges.find((candidate) => candidate.id === selection.id) : undefined;
  const found = compiled.parse.ast ? findItemNode(compiled.parse.ast, selection.id, compiled.model) : null;
  const raw = plain(found?.node);
  const rawObject = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const currentLabel = item ? (item.kind === 'node' ? item.label.source : item.label?.source ?? '') : '';

  // The field follows the source's label (typing there, Undo, the assistant)
  // until the author types in it, and only typed text is written back: a
  // plain focus and blur must not restore a label the source has moved on from.
  const [field, setField] = useState({ id: selection.id, synced: currentLabel, text: currentLabel, dirty: false });
  if (field.id !== selection.id || field.synced !== currentLabel) {
    const keep = field.id === selection.id && field.dirty;
    setField({ id: selection.id, synced: currentLabel, text: keep ? field.text : currentLabel, dirty: keep });
  }

  const commitLabel = () => {
    if (!field.dirty) return;
    setField({ ...field, dirty: false });
    if (field.text !== currentLabel) onEdit(selection.id, [['label', field.text]]);
  };

  // Other ways to write the tone, which would win over or fight a new one. A
  // string `fill` is one; on a group, `fill: true/false` means filled and stays.
  const toneAliases: FigureEdit = ['color', 'colour', ...(typeof rawObject.fill === 'string' ? ['fill'] : [])].map(
    (key) => [key, undefined],
  );

  const heading =
    selection.kind === 'edge' && edge
      ? `Edge ${edge.from} → ${edge.to}`
      : item
        ? `${item.kind === 'group' ? 'Group' : 'Node'} ${item.id}`
        : selection.id;

  const setTone = (tone: Tone) => onEdit(selection.id, [['tone', tone], ...toneAliases]);

  const setRole = (role: string) =>
    onEdit(
      selection.id,
      role
        ? [['role', role], ['shape', undefined], ['tone', undefined], ...toneAliases, ['type', undefined], ['kind', undefined]]
        : [['role', undefined]],
    );

  return (
    <div
      contentEditable={false}
      className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-border bg-background px-3 py-2.5 text-xs"
      aria-label="Selected figure item"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate font-medium text-foreground">
          {heading}
          {item && item.kind === 'node' && labelText(item.label) !== item.id && (
            <span className="ml-1.5 font-normal text-muted-foreground">{labelText(item.label)}</span>
          )}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReveal}
            className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Code2 aria-hidden="true" className="h-3.5 w-3.5" />
            Show in source
          </button>
          <button
            type="button"
            aria-label="Close item editor"
            onClick={onClose}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {item && found && (
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-muted-foreground">Label</span>
          {/* A textarea, since a label breaks lines with a newline (Shift+Enter). */}
          <Textarea
            value={field.text}
            rows={Math.min(4, field.text.split('\n').length)}
            onChange={(event) => setField({ ...field, text: event.target.value, dirty: true })}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commitLabel();
              }
              if (event.key === 'Escape') setField({ ...field, text: currentLabel, dirty: false });
            }}
            className="min-h-7 resize-none py-1 font-mono text-xs leading-5"
          />
        </label>
      )}

      {item?.kind === 'node' && found && (
        <>
          <label className="flex w-36 flex-col gap-1">
            <span className="text-muted-foreground">Role</span>
            <NativeSelect
              value={stringOf(rawObject.role)}
              onChange={(event) => setRole(event.target.value)}
              selectClassName="h-7 text-xs"
            >
              <option value="">—</option>
              {ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.id}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex w-32 flex-col gap-1">
            <span className="text-muted-foreground">Shape</span>
            <NativeSelect
              value={item.shape}
              onChange={(event) => onEdit(selection.id, [['shape', event.target.value]])}
              selectClassName="h-7 text-xs"
            >
              {SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {shape}
                </option>
              ))}
            </NativeSelect>
          </label>
        </>
      )}

      {item?.kind === 'group' && found && (
        <>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-muted-foreground">Layout</span>
            <NativeSelect
              value={item.layout}
              onChange={(event) => onEdit(selection.id, [['layout', event.target.value]])}
              selectClassName="h-7 text-xs"
            >
              {LAYOUTS.map((layout) => (
                <option key={layout} value={layout}>
                  {layout}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-muted-foreground">Direction</span>
            <NativeSelect
              value={item.direction}
              onChange={(event) => onEdit(selection.id, [['direction', event.target.value]])}
              selectClassName="h-7 text-xs"
            >
              {DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {direction}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-muted-foreground">Border</span>
            <NativeSelect
              value={item.border}
              onChange={(event) => onEdit(selection.id, [['border', event.target.value]])}
              selectClassName="h-7 text-xs"
            >
              {BORDERS.map((border) => (
                <option key={border} value={border}>
                  {border}
                </option>
              ))}
            </NativeSelect>
          </label>
        </>
      )}

      {item && found && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-muted-foreground">Tone</legend>
          <div className="flex gap-1">
            {TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                title={tone}
                aria-label={`Tone ${tone}`}
                aria-pressed={item.tone === tone}
                onClick={() => setTone(tone)}
                className={cn(
                  'h-5 w-5 rounded-full border transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  item.tone === tone && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                )}
                style={{ background: palette.tones[tone].fill, borderColor: palette.tones[tone].stroke }}
              />
            ))}
          </div>
        </fieldset>
      )}

      {item && !found && (
        <p className="text-muted-foreground">Could not find where this item is defined in the source.</p>
      )}
    </div>
  );
}
