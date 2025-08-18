import './HeadingBlock.css';
import type { HeadingBlock as H } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { memo } from 'react';

export const HeadingBlock = memo(function HeadingBlock({ block }: { block: H }) {
  const size = block.level === 1 ? 28 : block.level === 2 ? 22 : 18;
  return (
    <div className="heading-block">
      <Editable id={block.id} html={block.html} placeholder="Heading" style={{ fontWeight: 700, fontSize: size, lineHeight: 1.3 }} />
    </div>
  );
});
