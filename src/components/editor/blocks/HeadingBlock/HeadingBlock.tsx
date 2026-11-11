import type { HeadingBlock as H } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { memo } from 'react';

export const HeadingBlock = memo(function HeadingBlock({ block }: { block: H }) {
  // The page title is the one level-1 heading; Heading 1 blocks are
  // sections under it (level 2), as Notion renders them. The visual size
  // is unchanged.
  const level = block.level + 1;
  return (
    // Heading and textbox are two distinct accessibility concepts and one
    // element cannot expose both roles. The wrapper keeps this block in the
    // document outline while Editable exposes the nested editing field.
    // Size, weight and the space above live on the row (`data-kind` in
    // globals.css), so the block handle lines up with the heading's text.
    <div className="heading-block w-full" role="heading" aria-level={level}>
      <Editable
        id={block.id}
        html={block.html}
        locked={block.locked === true}
        // The field names the level a screen reader announces for the
        // heading around it; "Heading level 1" inside a level-2 heading
        // contradicted itself. The placeholder keeps the kind's own name
        // ("Heading 1"), which is what the author picked from the menu.
        ariaLabel={`Heading level ${level}`}
        placeholder={`Heading ${block.level}`}
      />
    </div>
  );
});
