import './Canvas.css';
import { useEditor } from '../../../editor';
import { BlockControls } from '../BlockControls';
import { ParagraphBlock } from '../blocks/ParagraphBlock';
import { HeadingBlock } from '../blocks/HeadingBlock';
import { TodoBlock } from '../blocks/TodoBlock';
import { CounterBlock } from '../blocks/CounterBlock';
import { DividerBlock } from '../blocks/DividerBlock';

export function Canvas() {
  const { blocks, addBlockAfter } = useEditor();
  return (
    <div className="canvas">
      {blocks.map((b) => (
        <div key={b.id} className="row block-row">
          <BlockControls id={b.id} />
          <div className="grow">
            {b.type === 'paragraph' && <ParagraphBlock block={b} />}
            {b.type === 'heading' && <HeadingBlock block={b} />}
            {b.type === 'todo' && <TodoBlock block={b} />}
            {b.type === 'counter' && <CounterBlock block={b} />}
            {b.type === 'divider' && <DividerBlock />}

            <div className="row quick-add">
              <button className="btn" onClick={() => addBlockAfter(b.id, 'paragraph')}>Add text</button>
              <button className="btn" onClick={() => addBlockAfter(b.id, 'heading')}>Add heading</button>
              <button className="btn" onClick={() => addBlockAfter(b.id, 'todo')}>Add todo</button>
              <button className="btn" onClick={() => addBlockAfter(b.id, 'counter')}>Add counter</button>
              <button className="btn" onClick={() => addBlockAfter(b.id, 'divider')}>Add divider</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
