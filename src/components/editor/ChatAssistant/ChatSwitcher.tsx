import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ChatItem } from '@/services/chats';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChatsPanel, type ChatHistory } from '@/components/panels/ChatsPanel';

/**
 * The conversation on screen, and every other one kept with this document.
 *
 * The title is the button: history lives one click away in the panel that
 * uses it, rather than in a separate tool column. The list inside is the
 * shared `ChatsPanel`, so search, rename and delete behave the same wherever
 * a list of chats appears.
 */
export function ChatSwitcher({
  title,
  history,
  onNewChat,
  onSelect,
  onDeleted,
}: {
  title: string;
  history: ChatHistory;
  onNewChat: () => void;
  onSelect: (chat: ChatItem) => void;
  onDeleted: (chat: ChatItem) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 min-w-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-foreground outline-none transition-colors duration-120 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-active"
          aria-label={`Chats: ${title}`}
          title="Chat history"
        >
          <span className="truncate">{title}</span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="flex max-h-[min(28rem,70vh)] w-80 flex-col overflow-hidden p-0"
      >
        <ChatsPanel
          history={history}
          onNewChat={() => {
            setOpen(false);
            onNewChat();
          }}
          onSelect={(chat) => {
            setOpen(false);
            onSelect(chat);
          }}
          onDeleted={onDeleted}
        />
      </PopoverContent>
    </Popover>
  );
}
