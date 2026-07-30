import { AlertCircle, CheckCircle2, Clock, Loader2, ScanLine } from 'lucide-react';
import type { ElementType } from 'react';
import type { ExtractionStatus } from '@/services/resources';

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'info';

export type ExtractionDescriptor = {
  /** Two words at most — this sits in a badge in a 380px panel. */
  label: string;
  /** What the state means for someone writing, not what the pipeline did. */
  hint: string;
  variant: BadgeVariant;
  icon: ElementType;
  spin: boolean;
  /** Whether the client should keep asking; `running` and `pending` settle. */
  settling: boolean;
  /** Whether a plain re-extract will change anything, or it needs forcing. */
  retry: 'none' | 'automatic' | 'force';
};

/**
 * One vocabulary for extraction state across the app.
 *
 * The panel and the profile dashboard both show these rows, and a file that
 * reads "Failed" in one place and "Not ready" in the other is two bugs to a
 * user reporting it. The wording is deliberately about consequence — whether
 * the assistant can read the file — rather than about the pipeline stage,
 * which is not something a writer has any reason to model.
 */
export function describeExtraction(status: ExtractionStatus | null): ExtractionDescriptor {
  switch (status) {
    case 'ready':
      return {
        label: 'Ready',
        hint: 'The assistant can read and quote this file.',
        variant: 'success',
        icon: CheckCircle2,
        spin: false,
        settling: false,
        retry: 'none',
      };
    case 'running':
      return {
        label: 'Converting',
        hint: 'Being converted to text. This takes longer for a long paper.',
        variant: 'info',
        icon: Loader2,
        spin: true,
        settling: true,
        retry: 'none',
      };
    case 'pending':
      return {
        label: 'Queued',
        hint: 'Waiting to be converted to text.',
        variant: 'secondary',
        icon: Clock,
        spin: false,
        settling: true,
        retry: 'none',
      };
    case 'failed':
      return {
        label: 'Failed',
        hint: 'Conversion did not finish. Retrying usually works.',
        variant: 'warning',
        icon: AlertCircle,
        spin: false,
        settling: false,
        retry: 'automatic',
      };
    case 'unsupported':
      return {
        label: 'No text',
        hint: 'No text layer to read — usually a scan. Retrying will not help.',
        variant: 'destructive',
        icon: ScanLine,
        spin: false,
        settling: false,
        // `unsupported` is deliberately sticky: re-running it costs a provider
        // call per read and returns the same answer, so only an explicit
        // forced retry runs it again.
        retry: 'force',
      };
    default:
      return {
        label: 'Unknown',
        hint: 'The conversion state could not be read.',
        variant: 'secondary',
        icon: AlertCircle,
        spin: false,
        settling: false,
        // Forced rather than automatic: an unreadable status is as likely to be
        // a field this client does not know about as a real failure, and a
        // plain retry would spend a provider call to find that out.
        retry: 'force',
      };
  }
}
