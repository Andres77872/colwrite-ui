import './TodoBlock.css';
import { useEditor } from '../../../../editor';
import type { TodoBlock as T } from '../../../../editor';
import { Editable } from '../../../common/Editable';

export function TodoBlock({ block }: { block: T }) {
  const { toggleTodo } = useEditor();
  return (
    <div className="todo-block">
      <input type="checkbox" checked={block.checked} onChange={() => toggleTodo(block.id)} />
      <Editable id={block.id} html={block.html} placeholder="Todo" />
    </div>
  );
}
