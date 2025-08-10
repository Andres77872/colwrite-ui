import './Canvas.css';
import { useEditor } from '../../../editor';
import { BlockControls } from '../BlockControls';
import { ParagraphBlock } from '../blocks/ParagraphBlock';
import { HeadingBlock } from '../blocks/HeadingBlock';
import { TodoBlock } from '../blocks/TodoBlock';
import { CounterBlock } from '../blocks/CounterBlock';
import { DividerBlock } from '../blocks/DividerBlock';

export function Canvas() {
  const { blocks, activeId, setActive } = useEditor();
  return (
    <div className="canvas">
      {blocks.map((b) => (
        <div key={b.id} className={["row block-row", b.id === activeId ? 'active' : ''].join(' ')} onClick={() => setActive(b.id)}>
          <BlockControls id={b.id} />
          <div className="grow">
            {b.type === 'paragraph' && <ParagraphBlock block={b} />}
            {b.type === 'heading' && <HeadingBlock block={b} />}
            {b.type === 'todo' && <TodoBlock block={b} />}
            {b.type === 'counter' && <CounterBlock block={b} />}
            {b.type === 'divider' && <DividerBlock />}
          </div>
        </div>
      ))}
    </div>
  );
}
