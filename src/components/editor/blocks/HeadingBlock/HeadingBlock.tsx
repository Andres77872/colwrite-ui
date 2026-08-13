import type { HeadingBlock as H } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { memo } from 'react';
import { cn } from '@/lib/utils';

export const HeadingBlock = memo(function HeadingBlock({ block }: { block: H }) {
  return (
    // Heading and textbox are two distinct accessibility concepts and one
    // element cannot expose both roles. The wrapper keeps this block in the
    // document outline while Editable exposes the nested editing field.
    <div className="heading-block w-full" role="heading" aria-level={block.level}>
      <Editable
        id={block.id}
        html={block.html}
        locked={block.locked === true}
        ariaLabel={`Heading level ${block.level}`}
        placeholder="Heading"
        className={cn(
          "font-semibold leading-tight tracking-tight",
          block.level === 1 && "text-3xl mt-6 mb-2",
          block.level === 2 && "text-2xl mt-5 mb-1.5",
          block.level === 3 && "text-xl mt-4 mb-1"
        )}
      />
    </div>
  );
});
