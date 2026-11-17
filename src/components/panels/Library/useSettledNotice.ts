import { useState } from 'react';
import { describeExtraction } from '@/components/common/ExtractionStatus';
import type { ResourceItem } from '@/data/resources';

/**
 * A polite announcement when a PDF's conversion finishes, once. Polling swaps
 * a row's badge from Converting to Ready silently, which nobody who is not
 * watching that row would notice.
 */
export function useSettledNotice(resources: readonly ResourceItem[]): string {
  const [seen, setSeen] = useState<{ resources: readonly ResourceItem[]; notice: string }>({
    resources,
    notice: '',
  });
  if (seen.resources !== resources) {
    const before = new Map(seen.resources.map((resource) => [resource.id, resource.extraction.status]));
    const settled = resources.flatMap((resource) => {
      const previous = before.get(resource.id);
      if (previous === undefined || previous === resource.extraction.status) return [];
      if (!describeExtraction(previous).settling || describeExtraction(resource.extraction.status).settling) return [];
      return [`${resource.title || resource.filename}: ${describeExtraction(resource.extraction.status).label}`];
    });
    setSeen({ resources, notice: settled.length > 0 ? settled.join('. ') : seen.notice });
  }
  return seen.notice;
}
