import './ParagraphBlock.css';
import type { ParagraphBlock as P } from '../../../../editor';
import { Editable } from '../../../common/Editable';

export function ParagraphBlock({ block }: { block: P }) {
  return <Editable className="paragraph-block" id={block.id} html={block.html} placeholder="Type '/' for commands" />;
}
