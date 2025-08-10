import './HeadingBlock.css';
import { useEditor } from '../../../../editor';
import type { HeadingBlock as H } from '../../../../editor';
import { Editable } from '../../../common/Editable';

export function HeadingBlock({ block }: { block: H }) {
  const { setHeadingLevel, activeId } = useEditor();
  const size = block.level === 1 ? 28 : block.level === 2 ? 22 : 18;
  return (
    <div className="heading-block">
      {activeId === block.id && (
        <div className="row" style={{ marginBottom: 4 }}>
          <select className="select" value={block.level} onChange={e => setHeadingLevel(block.id, Number(e.target.value) as 1|2|3)}>
            <option value={1}>Heading 1</option>
            <option value={2}>Heading 2</option>
            <option value={3}>Heading 3</option>
          </select>
        </div>
      )}
      <Editable id={block.id} html={block.html} placeholder="Heading" style={{ fontWeight: 700, fontSize: size, lineHeight: 1.3 }} />
    </div>
  );
}
