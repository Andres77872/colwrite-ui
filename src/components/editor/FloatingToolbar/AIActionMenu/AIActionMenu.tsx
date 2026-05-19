import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sparkles } from 'lucide-react';
import { AI_ACTION_REGISTRY, type AiAction, type AiActionGroup } from '../../../../config/aiActions';

interface AIActionMenuProps {
  disabled?: boolean;
  onAction: (action: AiAction, e: React.MouseEvent, language?: string) => void;
}

// ── Group ordering and labels ──

const GROUP_ORDER: AiActionGroup[] = ['edit', 'reference', 'transform'];
const GROUP_LABELS: Record<AiActionGroup, string> = {
  edit: 'Edit',
  reference: 'Reference',
  transform: 'Transform',
};

export function AIActionMenu({ disabled, onAction }: AIActionMenuProps) {
  const [customLang, setCustomLang] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Build grouped actions from the registry, filtering hidden ones
  const visibleActions = Object.values(AI_ACTION_REGISTRY).filter(
    (a) => a.hidden !== true,
  );

  const grouped = GROUP_ORDER.reduce<Record<AiActionGroup, typeof visibleActions>>(
    (acc, group) => {
      acc[group] = visibleActions.filter((a) => a.group === group);
      return acc;
    },
    {} as Record<AiActionGroup, typeof visibleActions>,
  );

  const handleAction = (action: AiAction, e: React.MouseEvent, language?: string) => {
    setShowCustomInput(false);
    setCustomLang('');
    onAction(action, e, language);
  };

  const handleCustomLangConfirm = (action: AiAction, e: React.MouseEvent) => {
    const lang = customLang.trim() || '__other__';
    handleAction(action, e, lang);
  };

  // ── Render ──

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
        {GROUP_ORDER.map((group, groupIdx) => {
          const items = grouped[group];
          if (items.length === 0) return null;

          return (
            <div key={group}>
              {/* Separator before every group except the first */}
              {groupIdx > 0 && <DropdownMenuSeparator />}

              {items.map((config) => {
                const Icon = config.icon;

                // ── Translate sub-menu ──
                if (config.id === 'translate') {
                  return (
                    <DropdownMenuSub key={config.id}>
                      <DropdownMenuSubTrigger className="gap-2">
                        <Icon className="h-4 w-4" />
                        {config.label}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-[180px]">
                        {showCustomInput ? (
                          <div className="flex flex-col gap-1 p-2">
                            <input
                              type="text"
                              className="w-full rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                              placeholder="Type a language..."
                              autoFocus
                              value={customLang}
                              onChange={(e) => setCustomLang(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const target = e.target as HTMLInputElement;
                                  handleCustomLangConfirm('translate', e as unknown as React.MouseEvent);
                                }
                                if (e.key === 'Escape') {
                                  setShowCustomInput(false);
                                  setCustomLang('');
                                }
                              }}
                            />
                            <Button
                              variant="default"
                              size="sm"
                              className="w-full"
                              disabled={!customLang.trim()}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleCustomLangConfirm('translate', e);
                              }}
                            >
                              Apply
                            </Button>
                          </div>
                        ) : (
                          <>
                            {config.supportedLanguages?.map((lang) => (
                              <DropdownMenuItem
                                key={lang.value}
                                className="gap-2"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  if (lang.value === '__other__') {
                                    setShowCustomInput(true);
                                    setCustomLang('');
                                  } else {
                                    handleAction('translate', e, lang.value);
                                  }
                                }}
                              >
                                {lang.value === '__other__' ? (
                                  <span className="text-muted-foreground">Other...</span>
                                ) : (
                                  lang.label
                                )}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                }

                // ── Regular action item — direct-click ──
                return (
                  <DropdownMenuItem
                    key={config.id}
                    className="gap-2"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAction(config.id, e);
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
