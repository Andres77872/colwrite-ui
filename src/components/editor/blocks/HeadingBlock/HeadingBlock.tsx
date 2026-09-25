import type { HeadingBlock as H } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { memo } from 'react';

export const HeadingBlock = memo(function HeadingBlock({ block }: { block: H }) {
  return (
    // Heading and textbox are two distinct accessibility concepts and one
    // element cannot expose both roles. The wrapper keeps this block in the
    // document outline while Editable exposes the nested editing field.
    // Size, weight and the space above live on the row (`data-kind` in
    // globals.css), so the block handle lines up with the heading's text.
    // The page title is the one level-1 heading; Heading 1 blocks are
    // sections under it (level 2), as Notion renders them. The visual size
    // is unchanged.
    <div className="heading-block w-full" role="heading" aria-level={block.level + 1}>
      <Editable
        id={block.id}
        html={block.html}
        locked={block.locked === true}
        ariaLabel={`Heading level ${block.level}`}
        placeholder={`Heading ${block.level}`}
      />
    </div>
  );
});
