import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { formatDateTime } from '@/lib/text';
import { errorMessage } from '@/services/contracts';
import { listUserDocuments, type UserDocument } from '@/services/userProfile';
import { Bot, FileText, MessagesSquare, Paperclip, Save } from 'lucide-react';

const PAGE_SIZE = 20;

/**
 * DocumentsSection — every document the user has written, with the activity
 * MySQL correlates to it.
 *
 * Deliberately not the sidebar's list: that one is the MongoDB content index
 * and cannot know how many chats or assistant runs a document accumulated.
 */
export function DocumentsSection({
  documents,
  totalKnown,
  onOpen,
}: {
  documents: UserDocument[];
  /** Active document count from the usage summary, used to offer "load more". */
  totalKnown: number;
  onOpen: (documentId: string) => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState(documents);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const canLoadMore = !exhausted && items.length < totalKnown;

  const loadMore = async () => {
    setLoading(true);
    try {
      const response = await listUserDocuments(PAGE_SIZE, items.length);
      const fetched = response.documents ?? [];
      if (fetched.length === 0) setExhausted(true);
      setItems((previous) => [...previous, ...fetched]);
    } catch (error) {
      toast({
        title: 'Could not load more documents',
        description: errorMessage(error, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-md font-semibold">Documents</h2>
        <p className="text-xs text-muted-foreground">
          {totalKnown} {totalKnown === 1 ? 'document' : 'documents'}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Documents you create in the editor are listed here."
        />
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border/50">
            {items.map((document) => (
              <li key={document.document_id} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{document.name}</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      v{document.version}
                      {document.updated_at && ` · edited ${formatDateTime(document.updated_at)}`}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                      <Metric icon={Save} value={document.save_count} label="saves" />
                      <Metric icon={MessagesSquare} value={document.chat_count} label="chats" />
                      <Metric icon={Bot} value={document.agent_run_count} label="assistant runs" />
                      {document.upload_count > 0 && (
                        <Metric icon={Paperclip} value={document.upload_count} label="attachments" />
                      )}
                    </ul>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpen(document.document_id)}
                  >
                    Open
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {canLoadMore && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={loadMore}
              disabled={loading}
            >
              {loading && <Spinner />}
              {loading ? 'Loading…' : `Show more (${totalKnown - items.length} left)`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
}) {
  return (
    <li className="flex items-center gap-1">
      <Icon aria-hidden="true" className="h-3 w-3" />
      <span className="tabular-nums">{value}</span>
      <span>{label}</span>
    </li>
  );
}
