import './Canvas.css';
import { DocumentHeader } from '../DocumentChrome';
import { useEditor } from '../../../editor';
import { Fragment, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { BlockControls } from '../BlockControls';
import { ParagraphBlock } from '../blocks/ParagraphBlock';
import { HeadingBlock } from '../blocks/HeadingBlock';
import { DividerBlock } from '../blocks/DividerBlock';

export function Canvas() {
  const { blocks, activeId, setActive, reorderBlock } = useEditor();
  const [overId, setOverId] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<'before' | 'after' | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);

  const clearDnd = () => {
    setOverId(null);
    setOverPos(null);
    setInsertIndex(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    const types = Array.from(e.dataTransfer.types || []);
    const isBlockDrag = types.includes('application/x-block-id') || types.includes('text/plain');
    if (!isBlockDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setOverId(blocks[idx].id);
    setOverPos(pos);
    setInsertIndex(pos === 'before' ? idx : idx + 1);
  };


  const updateIndicatorFromPoint = (y: number) => {
    const root = containerRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLDivElement>('.block-row'));
    if (rows.length === 0) return;
    let updated = false;
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i];
      const rect = el.getBoundingClientRect();
      if (y < rect.top) {
        setOverId(el.dataset.blockId || null);
        setOverPos('before');
        setInsertIndex(i);
        updated = true;
        break;
      }
      if (y <= rect.bottom) {
        const pos = y < rect.top + rect.height / 2 ? 'before' : 'after';
        setOverId(el.dataset.blockId || null);
        setOverPos(pos);
        setInsertIndex(pos === 'before' ? i : i + 1);
        updated = true;
        break;
      }
    }
    if (!updated) {
      // Below the last row -> show end dropzone
      setOverId(null);
      setOverPos(null);
      setInsertIndex(rows.length);
    }
  };

  return (
    <div
      className="canvas"
      ref={containerRef}
      onDragEnd={clearDnd}
      onDragOverCapture={(e) => {
        // Allow dropping anywhere on the canvas for our block drag
        if (Array.from(e.dataTransfer.types || []).includes('application/x-block-id')) {
          e.preventDefault();
          updateIndicatorFromPoint(e.clientY);
        }
      }}
      onDropCapture={(e) => {
        const fromId = e.dataTransfer.getData('application/x-block-id') || e.dataTransfer.getData('text/plain');
        if (!fromId) return;
        e.preventDefault();
        if (insertIndex != null) {
          const fromIndex = blocks.findIndex(b => b.id === fromId);
          if (fromIndex !== -1) {
            let targetIndex = insertIndex;
            if (fromIndex < targetIndex) targetIndex -= 1;
            if (fromIndex !== targetIndex) reorderBlock(fromId, targetIndex);
          }
        }
        clearDnd();
      }}
    >
      <DocumentHeader />
      {blocks.map((b, i) => {
        const isCollapsed = (b as any).collapsed === true;
        const isAiHidden = (b as any).aiHidden === true;
        const isLocked = (b as any).locked === true;
        const classes = [
          'row block-row',
          b.id === activeId ? 'active' : '',
          isCollapsed ? 'collapsed' : '',
          isAiHidden ? 'ai-hidden' : '',
          isLocked ? 'locked' : '',
          overId === b.id && overPos === 'before' ? 'drag-over-top' : '',
          overId === b.id && overPos === 'after' ? 'drag-over-bottom' : '',
        ].filter(Boolean).join(' ');
        return (
          <Fragment key={b.id}>
          {insertIndex === i && <div className="dnd-insertion" />}
          <div
            className={classes}
            data-block-id={b.id}
            onClick={() => setActive(b.id)}
            onDragEnter={(e) => handleDragOver(e as unknown as DragEvent<HTMLDivElement>, i)}
            onDragOver={(e) => handleDragOver(e, i)}
          >
            <BlockControls id={b.id} />
            {isCollapsed ? (
              <div className="grow">
                <div className="block-collapsed">
                  <span className="bc-arrow">▸</span>
                  <span className="bc-label">
                    {b.type === 'paragraph' ? 'Paragraph' : b.type === 'heading' ? 'Heading' : 'Divider'}
                  </span>
                  {('html' in b) && (b as any).html ? (
                    <span className="bc-preview" dangerouslySetInnerHTML={{ __html: ((b as any).html || '').replace(/<[^>]*>/g, '').slice(0, 60) }} />
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="grow">
                {b.type === 'paragraph' && <ParagraphBlock block={b} />}
                {b.type === 'heading' && <HeadingBlock block={b} />}
                {b.type === 'divider' && <DividerBlock />}
              </div>
            )}
          </div>
          </Fragment>
        );
      })}
      {/* Tail dropzone to allow dropping at the very end */}
      <div
        className={["dnd-tail", insertIndex === blocks.length ? 'active' : ''].join(' ')}
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types || []);
          const isBlockDrag = types.includes('application/x-block-id') || types.includes('text/plain');
          if (!isBlockDrag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOverId(null);
          setOverPos(null);
          setInsertIndex(blocks.length);
        }}
      />
      
    </div>
  );
}
