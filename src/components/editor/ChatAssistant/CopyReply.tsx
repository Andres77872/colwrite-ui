import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Copy a reply out of the panel — the transcript is not selectable mid-stream. */
export function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* a clipboard the browser refuses is not worth an error banner */
        }
      }}
      className={cn(
        'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-opacity',
        'opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100',
        copied && 'opacity-100',
      )}
    >
      {copied ? (
        <>
          <Check aria-hidden="true" className="h-3 w-3 text-diff-add-fg" />
          Copied
        </>
      ) : (
        <>
          <Copy aria-hidden="true" className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  );
}
