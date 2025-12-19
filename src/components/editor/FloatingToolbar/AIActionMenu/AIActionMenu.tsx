import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sparkles, Wand2, CheckCircle, ArrowRight, RefreshCw, Minimize2, Maximize2, Languages } from 'lucide-react';
import type { AiAction } from '../../../../services';

interface AIActionMenuProps {
  disabled?: boolean;
  onAction: (action: AiAction, e: React.MouseEvent) => void;
}

const actions: { icon: typeof Wand2; label: string; action: AiAction }[] = [
  { icon: Wand2, label: 'Improve writing', action: 'improve' },
  { icon: CheckCircle, label: 'Fix grammar', action: 'grammar' },
  { icon: ArrowRight, label: 'Continue writing', action: 'continue' },
  { icon: RefreshCw, label: 'Rephrase', action: 'rephrase' },
  { icon: Minimize2, label: 'Make shorter', action: 'shorter' },
  { icon: Maximize2, label: 'Make longer', action: 'longer' },
  { icon: Languages, label: 'Translate', action: 'translate' },
];

export function AIActionMenu({ disabled, onAction }: AIActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="gap-1.5 font-semibold"
          disabled={disabled}
        >
          <Sparkles className="h-4 w-4" />
          AI
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        {actions.map((item) => (
          <DropdownMenuItem 
            key={item.action} 
            className="gap-2"
            onMouseDown={(e) => {
              e.preventDefault();
              onAction(item.action, e);
            }}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
