import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'colwrite-ui';
import { Bold, Italic, Sigma, Undo2 } from 'lucide-react';

// The axis is the trigger. `asChild` is the normal form — it hands the hint to a
// control that already exists — but the bare trigger renders its own <button>
// and takes `className`, which is how an inline term in the prose gets a hint.
// Every cell forces `open` and supplies the required TooltipProvider.

export function AsChildIconButton() {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1.5 shadow-sm">
        <Button variant="ghost" size="icon-sm" aria-label="Bold">
          <Bold />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Italic">
          <Italic />
        </Button>
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Insert equation">
              <Sigma />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Insert display equation</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" aria-label="Undo">
          <Undo2 />
        </Button>
      </div>
    </TooltipProvider>
  );
}

export function AsChildBadge() {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <span className="mr-auto truncate text-sm text-foreground">
          Attention Is All You Need, Revisited
        </span>
        <Tooltip open>
          <TooltipTrigger asChild>
            <Badge variant="warning">3 unresolved</Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            3 citations have no matching reference
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function StyledTriggerElement() {
  return (
    <TooltipProvider delayDuration={0}>
      <p className="max-w-md text-base leading-relaxed text-foreground">
        At a matched passage budget the only difference between the two systems is where
        cross-passage attention happens, so we compare the reader against{' '}
        <Tooltip open>
          <TooltipTrigger className="rounded-sm border-b border-dashed border-primary/50 px-0.5 text-primary">
            FiD
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            Fusion-in-Decoder (Izacard &amp; Grave, 2021)
          </TooltipContent>
        </Tooltip>. Both readers see the same 100 passages.
      </p>
    </TooltipProvider>
  );
}
