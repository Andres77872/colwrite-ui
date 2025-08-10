import './CounterBlock.css';
import { useEditor } from '../../../../editor';
import type { CounterBlock as C } from '../../../../editor';

export function CounterBlock({ block }: { block: C }) {
  const { bumpCounter } = useEditor();
  return (
    <div className="counter-block">
      <strong>Counter:</strong>
      <button className="btn" onClick={() => bumpCounter(block.id, -1)}>-</button>
      <span className="value">{block.count}</span>
      <button className="btn" onClick={() => bumpCounter(block.id, +1)}>+</button>
    </div>
  );
}
