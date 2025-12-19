import type { HeadingBlock as H } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { memo } from 'react';
import { cn } from '@/lib/utils';

export const HeadingBlock = memo(function HeadingBlock({ block }: { block: H }) {
  return (
    <div className="heading-block w-full">
      <Editable
        id={block.id}
        html={block.html}
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
