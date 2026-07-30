import { Button, EmptyState } from 'colwrite-ui';
import { FileText, MessageSquare, Paperclip, Plus } from 'lucide-react';

// Ported from the app's own uses: ChatsPanel, DocumentsMenu, UploadsSection.

export function InAPanel() {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card">
      <EmptyState
        icon={MessageSquare}
        title="No chats yet"
        description="Start a conversation to keep a history of your assistant sessions."
      />
    </div>
  );
}

export function OnAPage() {
  return (
    <EmptyState
      size="page"
      icon={FileText}
      title="No documents yet"
      description="Create one to start writing."
    />
  );
}

export function WithAction() {
  return (
    <div className="w-full max-w-md rounded-lg border border-border bg-card">
      <EmptyState
        icon={Paperclip}
        title="No files yet"
        description="PDFs you upload are kept with your account."
        action={
          <Button size="sm">
            <Plus />
            Upload a PDF
          </Button>
        }
      />
    </div>
  );
}

export function SearchMiss() {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card">
      <EmptyState
        icon={FileText}
        title="No matches"
        description={'Nothing matches “diffusion”.'}
      />
    </div>
  );
}
