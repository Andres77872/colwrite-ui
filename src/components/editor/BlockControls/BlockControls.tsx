import './BlockControls.css';
import { useEditor } from '../../../editor';

export function BlockControls({ id }: { id: string }) {
  const { addBlockAfter, moveBlock, removeBlock } = useEditor();
  return (
    <div className="block-controls">
      <button className="icon" title="Add text below" onClick={() => addBlockAfter(id, 'paragraph')}>＋</button>
      <button className="icon" title="Move up" onClick={() => moveBlock(id, -1)}>↑</button>
      <button className="icon" title="Move down" onClick={() => moveBlock(id, 1)}>↓</button>
      <button className="icon danger" title="Delete" onClick={() => removeBlock(id)}>🗑</button>
    </div>
  );
}
