import './FloatingToolbar.css';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';

export function FloatingToolbar() {
  const { exec } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [states, setStates] = useState({ bold: false, italic: false, underline: false, strike: false });
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onSelection = () => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setVisible(false); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { setVisible(false); return; }
      // ensure selection is inside our editor
      let node: Node | null = sel.anchorNode;
      let inside = false;
      while (node) {
        if ((node as HTMLElement).classList && (node as HTMLElement).classList.contains('editable')) { inside = true; break; }
        node = (node as Node).parentNode;
      }
      if (!inside) { setVisible(false); return; }

      setPos({
        top: rect.top - 44,
        left: rect.left + rect.width / 2,
      });
      try {
        setStates({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
        });
      } catch {
        // no-op
      }
      setVisible(true);
    };
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('scroll', onSelection, true);
    window.addEventListener('resize', onSelection);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      window.removeEventListener('scroll', onSelection, true);
      window.removeEventListener('resize', onSelection);
    };
  }, []);

  const onFormat = (cmd: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    exec(cmd);
  };

  if (!visible) return null;
  return (
    <div
      ref={ref}
      className="floating-toolbar"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => { e.preventDefault(); }}
    >
      <button className={states.bold ? 'active' : ''} onMouseDown={onFormat('bold')} title="Bold">B</button>
      <button className={states.italic ? 'active' : ''} onMouseDown={onFormat('italic')} title="Italic"><i>I</i></button>
      <button className={states.underline ? 'active' : ''} onMouseDown={onFormat('underline')} title="Underline"><u>U</u></button>
      <button className={states.strike ? 'active' : ''} onMouseDown={onFormat('strikeThrough')} title="Strikethrough"><s>S</s></button>
    </div>
  );
}
