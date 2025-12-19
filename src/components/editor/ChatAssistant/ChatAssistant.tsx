import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useEditor } from '../../../editor';
import type { OpenAIChatMessage } from '../../../services';
import { streamDocumentAiChat } from '../../../services';
import { useChatSessions } from '../../chat/ChatSessionsContext';
import { listMessages, listThreads } from '../../../services/chats';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';
import type { Block, Doc } from '../../../editor/types';
import { uid } from '../../../lib/uid';

type ChatMessage = OpenAIChatMessage;

// --- Streaming extras tag filter (module scope) ---
type ExtrasFilterState = { inExtras: boolean; carry: string; buf: string };
const OPEN_TAG = '<EXTRAS_JSON>';
const CLOSE_TAG = '</EXTRAS_JSON>';

function filterAndExtractExtras(state: ExtrasFilterState, incoming: string): { text: string; extras: any[] } {
  if (!incoming) return { text: '', extras: [] };
  let buffer = (state.carry || '') + incoming;
  state.carry = '';
  const outParts: string[] = [];
  const extrasOut: any[] = [];

  while (buffer.length) {
    if (state.inExtras) {
      const closeIdx = buffer.indexOf(CLOSE_TAG);
      if (closeIdx === -1) {
        // Accumulate JSON inside extras block; keep a small tail to match split close tag next time
        // Append all but the last few chars to buf
        const keep = Math.min(CLOSE_TAG.length - 1, buffer.length);
        const cutoff = buffer.length - keep;
        if (cutoff > 0) state.buf += buffer.slice(0, cutoff);
        state.carry = buffer.slice(cutoff);
        buffer = '';
        break;
      } else {
        // Capture JSON up to the close tag, then parse
        state.buf += buffer.slice(0, closeIdx);
        buffer = buffer.slice(closeIdx + CLOSE_TAG.length);
        try {
          const parsed = JSON.parse(state.buf);
          extrasOut.push(parsed);
        } catch {
          // ignore parse errors; malformed json
        }
        state.buf = '';
        state.inExtras = false;
        continue;
      }
    } else {
      const openIdx = buffer.indexOf(OPEN_TAG);
      if (openIdx === -1) {
        // No open tag; emit all visible text, but keep a potential partial tag start as carry
        const lastLt = buffer.lastIndexOf('<');
        if (lastLt !== -1) {
          const tail = buffer.slice(lastLt);
          if (OPEN_TAG.startsWith(tail)) {
            outParts.push(buffer.slice(0, lastLt));
            state.carry = tail;
            buffer = '';
            break;
          }
        }
        outParts.push(buffer);
        buffer = '';
        break;
      } else {
        // Emit text before the tag, then enter extras mode
        outParts.push(buffer.slice(0, openIdx));
        buffer = buffer.slice(openIdx + OPEN_TAG.length);
        state.inExtras = true;
        state.buf = '';
        continue;
      }
    }
  }

  return { text: outParts.join(''), extras: extrasOut };
}

// Patch application helpers for processing extras JSON
type PatchOperation = {
  op: 'insert' | 'update' | 'delete';
  block?: Block;
  beforeOf?: string | null;
  afterOf?: string | null;
  blockId?: string;
  fields?: Record<string, any>;
};


// Normalize a raw block to ensure it has the required properties
function normalizeBlock(rawBlock: any): Block {
  if (!rawBlock || typeof rawBlock !== 'object') {
    return { id: uid(), type: 'paragraph', html: '', children: [], columns: 1 };
  }
  
  const id = rawBlock.id || uid();
  const type = rawBlock.type || 'paragraph';
  
  if (type === 'paragraph') {
    return {
      id,
      type: 'paragraph',
      html: rawBlock.html || '',
      children: Array.isArray(rawBlock.children) ? rawBlock.children : [],
      columns: typeof rawBlock.columns === 'number' ? rawBlock.columns : 1,
      ...(rawBlock.aiHidden && { aiHidden: rawBlock.aiHidden }),
      ...(rawBlock.locked && { locked: rawBlock.locked }),
      ...(rawBlock.collapsed && { collapsed: rawBlock.collapsed }),
    };
  }
  
  if (type === 'heading') {
    return {
      id,
      type: 'heading',
      level: ([1, 2, 3].includes(rawBlock.level) ? rawBlock.level : 2) as 1 | 2 | 3,
      html: rawBlock.html || '',
      ...(rawBlock.aiHidden && { aiHidden: rawBlock.aiHidden }),
      ...(rawBlock.locked && { locked: rawBlock.locked }),
      ...(rawBlock.collapsed && { collapsed: rawBlock.collapsed }),
    };
  }
  
  if (type === 'divider') {
    return {
      id,
      type: 'divider',
      ...(rawBlock.aiHidden && { aiHidden: rawBlock.aiHidden }),
      ...(rawBlock.locked && { locked: rawBlock.locked }),
      ...(rawBlock.collapsed && { collapsed: rawBlock.collapsed }),
    };
  }
  
  // Fallback to paragraph
  return { id, type: 'paragraph', html: '', children: [], columns: 1 };
}

// Apply patches with intelligent ordering to avoid inversion issues
function applyPatchesIntelligently(patches: PatchOperation[], editor: any): void {
  if (!patches || patches.length === 0) return;
  
  console.log('Received patches:', patches.map(p => ({
    op: p.op,
    type: p.block?.type,
    beforeOf: p.beforeOf,
    afterOf: p.afterOf,
    blockId: p.blockId
  })));
  
  // Separate patches by operation type
  const insertPatches = patches.filter(p => p.op === 'insert');
  const updatePatches = patches.filter(p => p.op === 'update');
  const deletePatches = patches.filter(p => p.op === 'delete');
  
  // Apply deletes first
  deletePatches.forEach(patch => applyPatch(patch, editor));
  
  // For inserts, apply in structured order to preserve expected layout
  if (insertPatches.length > 0) {
    const appliedIds = new Set<string>(editor.blocks.map((b: Block) => b.id));
    const groupPrepend = insertPatches.filter(p => p.afterOf === null);
    const groupAppend = insertPatches.filter(p => p.beforeOf === null);
    const groupAfterRef = insertPatches.filter(p => typeof p.afterOf === 'string' && p.afterOf !== '');
    const groupBeforeRef = insertPatches.filter(p => typeof p.beforeOf === 'string' && p.beforeOf !== '');
    const groupNoPlacement = insertPatches.filter(p => p.afterOf == null && p.beforeOf == null); // both undefined

    // 1) Prepend group: apply in reverse to maintain top-down order at the start
    if (groupPrepend.length) {
      for (let i = groupPrepend.length - 1; i >= 0; i--) {
        const p = groupPrepend[i];
        applyPatch(p, editor);
        const id = p.block?.id; if (id) appliedIds.add(id);
      }
    }

    // 2) Resolve after/before references in multiple passes
    const pendingRef: PatchOperation[] = [...groupAfterRef, ...groupBeforeRef];
    let safety = pendingRef.length * 3;
    while (pendingRef.length && safety-- > 0) {
      const nextRound: PatchOperation[] = [];
      for (const p of pendingRef) {
        const id = p.block?.id; if (!id) continue;
        const hasAfter = typeof p.afterOf === 'string' && p.afterOf;
        const hasBefore = typeof p.beforeOf === 'string' && p.beforeOf;
        if (hasAfter && appliedIds.has(p.afterOf as string)) {
          applyPatch(p, editor);
          appliedIds.add(id);
          continue;
        }
        if (hasBefore && appliedIds.has(p.beforeOf as string)) {
          applyPatch(p, editor);
          appliedIds.add(id);
          continue;
        }
        nextRound.push(p);
      }
      if (nextRound.length === pendingRef.length) break;
      pendingRef.splice(0, pendingRef.length, ...nextRound);
    }
    // Apply unresolved references with defaults
    for (const p of pendingRef) applyPatch(p, editor);

    // 3) Append group: apply in given order to maintain top-down order at the end
    for (const p of groupAppend) {
      applyPatch(p, editor);
      const id = p.block?.id; if (id) appliedIds.add(id);
    }

    // 4) No-placement group: default to append
    for (const p of groupNoPlacement) {
      applyPatch(p, editor);
    }
  }
  
  // Apply updates last
  updatePatches.forEach(patch => applyPatch(patch, editor));
}

// (removed unused sortInsertPatches)

// Apply a single patch operation using editor context methods
function applyPatch(patch: PatchOperation, editor: any): void {
  console.log('Applying patch:', JSON.stringify(patch, null, 2));
  console.log('Current blocks before patch:', editor.blocks.map((b: Block) => ({ id: b.id, type: b.type, html: b.type !== 'divider' ? (b as any).html?.substring(0, 50) + '...' : 'divider' })));
  
  try {
    switch (patch.op) {
      case 'insert': {
        if (!patch.block) return;
        const normalizedBlock = normalizeBlock(patch.block);

        // If a block with the same id already exists, skip insert
        if (editor.blocks.some((b: Block) => b.id === normalizedBlock.id)) {
          console.log('Block already exists, skipping insert:', normalizedBlock.id);
          break;
        }

        // Server semantics: beforeOf === null -> append; afterOf === null -> prepend
        if (patch.beforeOf === null) {
          editor.appendBlockExact(normalizedBlock);
        } else if (patch.afterOf === null) {
          editor.insertBlockAtStartExact(normalizedBlock);
        } else if (typeof patch.afterOf === 'string' && patch.afterOf) {
          editor.insertBlockAfterExact(patch.afterOf, normalizedBlock);
        } else if (typeof patch.beforeOf === 'string' && patch.beforeOf) {
          editor.insertBlockBeforeExact(patch.beforeOf, normalizedBlock);
        } else {
          // Default: append
          editor.appendBlockExact(normalizedBlock);
        }

        console.log('After insert patch, blocks are:', editor.blocks.map((b: Block) => ({ id: b.id, type: b.type, html: b.type !== 'divider' ? (b as any).html?.substring(0, 50) + '...' : 'divider' })));
        break;
      }
      
      case 'update': {
        if (!patch.blockId || !patch.fields) return;
        const block = editor.blocks.find((b: Block) => b.id === patch.blockId);
        if (!block) return;
        
        // Update the block fields
        if ('html' in patch.fields && (block.type === 'paragraph' || block.type === 'heading')) {
          editor.updateHtml(patch.blockId, patch.fields.html);
        }
        if ('columns' in patch.fields && block.type === 'paragraph') {
          editor.setParagraphColumns(patch.blockId, patch.fields.columns);
        }
        if ('level' in patch.fields && block.type === 'heading') {
          editor.setHeadingLevel(patch.blockId, patch.fields.level);
        }
        // Handle meta fields
        if ('aiHidden' in patch.fields) {
          const currentHidden = (block as any).aiHidden ?? false;
          if (currentHidden !== patch.fields.aiHidden) {
            editor.toggleAiHidden(patch.blockId);
          }
        }
        if ('locked' in patch.fields) {
          const currentLocked = (block as any).locked ?? false;
          if (currentLocked !== patch.fields.locked) {
            editor.toggleLocked(patch.blockId);
          }
        }
        if ('collapsed' in patch.fields) {
          const currentCollapsed = (block as any).collapsed ?? false;
          if (currentCollapsed !== patch.fields.collapsed) {
            editor.toggleCollapsed(patch.blockId);
          }
        }
        break;
      }
      
      case 'delete': {
        if (!patch.blockId) return;
        const block = editor.blocks.find((b: Block) => b.id === patch.blockId);
        if (block) {
          editor.removeBlock(patch.blockId);
        }
        break;
      }
    }
  } catch (error) {
    console.warn('Failed to apply patch:', patch, error);
  }
}

// --- Utilities ---
// Remove any <EXTRAS_JSON>{...}</EXTRAS_JSON> blocks from a text content string.
function stripExtrasTags(text: string | undefined | null): { text: string; hadExtras: boolean } {
  if (typeof text !== 'string' || !text) return { text: '', hadExtras: false };
  const re = /<EXTRAS_JSON>[\s\S]*?<\/EXTRAS_JSON>/g; // non-greedy across lines
  const hadExtras = re.test(text);
  const cleaned = text.replace(re, '');
  return { text: cleaned, hadExtras };
}

export function ChatAssistant() {
  const editor = useEditor();
  const { documentId, createRemote } = editor;
  const { selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('chat.expanded') === '1'; } catch { return false; }
  });
  const extrasFilterRef = useRef<ExtrasFilterState>({ inExtras: false, carry: '', buf: '' });
  const latestExtrasRef = useRef<any | null>(null);
  const [extrasActive, setExtrasActive] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: 'system', content: 'You are a helpful writing assistant embedded in a document editor. Provide concise, actionable suggestions. When relevant, reference the current document context.' },
  ]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputHostRef = useRef<ChatTaggedInputHandle | null>(null);
  const refPickerRef = useRef<ChatRefPickerHandle | null>(null);

  useEffect(() => {
    try { localStorage.setItem('chat.expanded', expanded ? '1' : '0'); } catch {}
  }, [expanded]);

  const visibleMessages = useMemo(() => messages.filter(m => m.role !== 'system'), [messages]);
  
  // Helpers to reset chat UI and start a brand new chat
  const resetChatUI = (clearMessages: boolean = true) => {
    // Stop any ongoing stream
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
      abortRef.current = null;
    }
    setIsStreaming(false);
    // Reset extras/feedback state
    extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
    setExtrasActive(false);
    // Clear input and error
    setError('');
    setInput('');
    // Optionally reset messages to just the system prompt
    if (clearMessages) {
      setMessages([
        { role: 'system', content: 'You are a helpful writing assistant embedded in a document editor. Provide concise, actionable suggestions. When relevant, reference the current document context.' },
      ]);
    }
  };

  const onNewChat = () => {
    // Clear UI and forget the selected chat/thread
    resetChatUI(true);
    setSelectedChatId(null);
    setSelectedThreadId(null);
    // Put caret at start for quick typing
    requestAnimationFrame(() => inputHostRef.current?.setSelectionRange(0, 0));
  };

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visibleMessages, isStreaming]);

  // Improve UX: open the assistant when a chat gets selected
  useEffect(() => {
    if (selectedChatId) setExpanded(true);
  }, [selectedChatId]);

  // Clear the chat UI when the document changes
  useEffect(() => {
    resetChatUI(true);
  }, [documentId]);

  const ensureDocumentId = async (): Promise<string> => {
    if (documentId) return documentId;
    const id = await createRemote();
    return id;
  };

  // Load messages for the selected chat when selection changes
  useEffect(() => {
    (async () => {
      try {
        if (!documentId || !selectedChatId) return;
        // If streaming, stop first
        if (abortRef.current) {
          try { abortRef.current.abort(); } catch {}
          abortRef.current = null;
        }
        setIsStreaming(false);
        // Reset any transient extras state
        extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
        setExtrasActive(false);

        // Fetch conversation along the current branch
        let pivot: number | undefined = (selectedThreadId ?? undefined) as number | undefined;
        if (typeof pivot !== 'number') {
          // Fallback: fetch threads and pick the latest by id
          const thr = await listThreads(documentId, selectedChatId, 100, 0);
          const ids = (thr.threads || []).map(t => t.id).filter((n: any) => typeof n === 'number');
          if (ids.length) pivot = Math.max(...ids);
        }
        if (typeof pivot !== 'number') return; // nothing to load yet
        const res = await listMessages(documentId, selectedChatId, pivot);
        const base: ChatMessage[] = [
          { role: 'system', content: 'You are a helpful writing assistant embedded in a document editor. Provide concise, actionable suggestions. When relevant, reference the current document context.' },
          ...res.messages.map((m) => {
            const { text } = stripExtrasTags(m.content);
            return { role: m.role as any, content: text } as ChatMessage;
          })
        ];
        setMessages(base);
        if (typeof res.pivotThreadId === 'number') setSelectedThreadId(res.pivotThreadId);
      } catch {
        // ignore load errors here; UI remains usable
      }
    })();
  }, [documentId, selectedChatId, selectedThreadId]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setError('');
    setInput('');
    // Reset extras state for a fresh stream
    extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
    latestExtrasRef.current = null;
    setExtrasActive(false);

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setMessages(nextMessages);

    try {
      const id = await ensureDocumentId();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      await streamDocumentAiChat(id, nextMessages, {
        signal: controller.signal,
        chatId: selectedChatId,
        threadId: typeof selectedThreadId === 'number' ? selectedThreadId : undefined,
        onHeaders: (headers) => {
          const newChatId = headers.get('x-chat-id');
          if (newChatId && !selectedChatId) setSelectedChatId(newChatId);
        },
        onChunk: (delta, chunk) => {
          // 1) Update assistant message text (filter out <EXTRAS_JSON> blocks) and extract inline extras
          const { text: clean, extras: inlineExtras } = filterAndExtractExtras(extrasFilterRef.current, delta || '');
          setMessages(prev => {
            const out = prev.slice();
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].role === 'assistant') {
                if (clean) out[i] = { ...out[i], content: (out[i].content || '') + clean };
                break;
              }
            }
            return out;
          });
          // 2) Track latest extras only; apply once at end to avoid inversion
          try {
            const sseExtras: any = (chunk as any)?.extras ?? null;
            const hasInline = inlineExtras && inlineExtras.length > 0;
            const hasAny = Boolean(sseExtras) || hasInline || extrasFilterRef.current.inExtras;

            if (hasAny) {
              setExtrasActive(true);
              if (sseExtras && typeof sseExtras === 'object') {
                latestExtrasRef.current = sseExtras;
              } else if (hasInline) {
                // Keep the last inline extras object as the latest
                latestExtrasRef.current = inlineExtras[inlineExtras.length - 1];
              }
            }
          } catch (error) {
            console.warn('Error buffering extras:', error);
          }
        },
      });
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      // Apply latest buffered extras once to avoid order inversion
      try {
        const extras = latestExtrasRef.current;
        if (extras && typeof extras === 'object') {
          if (extras.nextDocument && typeof extras.nextDocument === 'object') {
            const doc = extras.nextDocument as Doc;
            if (doc.blocks && Array.isArray(doc.blocks)) {
              editor.setFromJSON(JSON.stringify(doc));
              if (doc.name) editor.setDocName(doc.name);
            }
          } else if (extras.patches && Array.isArray(extras.patches)) {
            applyPatchesIntelligently(extras.patches, editor);
          }
        }
      } catch (err) {
        console.warn('Failed to apply buffered extras:', err);
      } finally {
        // Ensure feedback is cleared
        extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
        latestExtrasRef.current = null;
        setExtrasActive(false);
      }
    }
  };

  const onStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
      extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
      setExtrasActive(false);
    }
  };

  return (
    <div className={cn(
      "chat-assistant fixed bottom-4 right-4 z-50",
      expanded ? "w-[380px]" : "w-auto"
    )}>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "shadow-md",
          expanded && "hidden"
        )}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide assistant' : 'Show assistant'}
      >
        {expanded ? 'Hide Assistant' : '✨ Assistant'}
      </Button>

      {expanded && (
        <div className="bg-card border border-border rounded-lg shadow-lg flex flex-col max-h-[500px]">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="flex-1">
              <div className="font-semibold text-sm">Assistant</div>
              <div className="text-xs text-muted-foreground">Helps you edit and refine your document</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onNewChat} title="Start a new chat">New</Button>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} title="Hide assistant">×</Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-3 min-h-[200px]" ref={listRef}>
            {visibleMessages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-8">
                Ask for suggestions, rewriting, structure, summaries, or references.
              </div>
            )}
            {visibleMessages.map((m, idx) => (
              <div 
                key={idx} 
                className={cn(
                  "flex",
                  m.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div className={cn(
                  "max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap",
                  m.role === 'user' 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted text-foreground"
                )}>
                  {m.role === 'user' ? (<ChatRefTags text={m.content} />) : m.content}
                </div>
              </div>
            ))}
            {isStreaming && extrasActive && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="animate-spin">⚙️</span> Processing changes…
              </div>
            )}
            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
          <div className="p-3 border-t border-border">
            <div className="flex items-end gap-2">
              <div className="chat-textarea-wrap flex-1 relative">
                <ChatTaggedInput
                  ref={inputHostRef}
                  value={input}
                  onChange={setInput}
                  placeholder="Ask the assistant…"
                  onTriggerPicker={(anchor) => refPickerRef.current?.openAt(anchor)}
                  onEditRef={(start) => refPickerRef.current?.openAt(start, { editing: true })}
                  onRemoveRef={(start, refText) => {
                    const before = input.slice(0, start);
                    const after = input.slice(start + refText.length);
                    setInput(before + after);
                    requestAnimationFrame(() => inputHostRef.current?.setSelectionRange(start, start));
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { onSend(); return; }
                  }}
                  maxLength={2000}
                  showStatus={true}
                />
                <ChatRefPicker
                  ref={refPickerRef}
                  hostRef={{ current: inputHostRef.current?.getHost() as any }}
                  input={input}
                  setInput={setInput}
                  setCaretIndex={(idx) => inputHostRef.current?.setSelectionRange(idx, idx)}
                />
              </div>
              {!isStreaming ? (
                <Button onClick={onSend} disabled={!input.trim()}>Send</Button>
              ) : (
                <Button variant="destructive" onClick={onStop}>Stop</Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


