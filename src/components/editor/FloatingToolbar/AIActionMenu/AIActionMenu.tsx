import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Sparkles } from 'lucide-react';
import { AI_ACTION_REGISTRY, type AiAction, type AiActionGroup } from '@/config/aiActions';

interface AIActionMenuProps {
  disabled?: boolean;
  onAction: (action: AiAction, language?: string) => void;
}

const GROUP_ORDER: readonly AiActionGroup[] = ['edit', 'reference', 'transform'];

const GROUP_LABELS: Record<AiActionGroup, string> = {
  edit: 'Edit',
  reference: 'Reference',
  transform: 'Transform',
};

const CUSTOM_LANGUAGE = '__other__';

/**
 * AIActionMenu — the AI actions available for the current text selection.
 *
 * Items fire through Radix's `onSelect`, so they work from the keyboard as
 * well as the mouse. The toolbar keeps the selection range in a ref, which is
 * what makes that safe: opening the menu moves DOM focus off the text.
 */
export function AIActionMenu({ disabled, onAction }: AIActionMenuProps) {
  const [customLanguage, setCustomLanguage] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const visibleActions = Object.values(AI_ACTION_REGISTRY).filter((action) => !action.hidden);

  const run = (action: AiAction, language?: string) => {
    setShowCustomInput(false);
    setCustomLanguage('');
    onAction(action, language);
  };

  const confirmCustomLanguage = () => {
    const language = customLanguage.trim();
    if (!language) return;
    run('translate', language);
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) return;
        setShowCustomInput(false);
        setCustomLanguage('');
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 font-semibold" disabled={disabled}>
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          AI
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[15rem]">
        {GROUP_ORDER.map((group, groupIndex) => {
          const items = visibleActions.filter((action) => action.group === group);
          if (items.length === 0) return null;

          return (
            <DropdownMenuGroup key={group}>
              {groupIndex > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {GROUP_LABELS[group]}
              </DropdownMenuLabel>

              {items.map((config) => {
                const Icon = config.icon;

                if (config.id === 'translate') {
                  return (
                    <DropdownMenuSub key={config.id}>
                      <DropdownMenuSubTrigger className="gap-2">
                        <Icon className="h-4 w-4" />
                        {config.label}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-[12rem]">
                        {showCustomInput ? (
                          <div className="flex flex-col gap-1.5 p-2">
                            <Input
                              autoFocus
                              className="h-8"
                              placeholder="Language name…"
                              aria-label="Target language"
                              value={customLanguage}
                              onChange={(event) => setCustomLanguage(event.target.value)}
                              // Radix menus type-ahead on printable keys; without
                              // this the field loses focus on the first letter.
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  confirmCustomLanguage();
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setShowCustomInput(false);
                                  setCustomLanguage('');
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={!customLanguage.trim()}
                              onClick={confirmCustomLanguage}
                            >
                              Translate
                            </Button>
                          </div>
                        ) : (
                          config.supportedLanguages?.map((language) => (
                            <DropdownMenuItem
                              key={language.value}
                              className="gap-2"
                              onSelect={(event) => {
                                if (language.value === CUSTOM_LANGUAGE) {
                                  // Keep the menu open so the input can be used.
                                  event.preventDefault();
                                  setShowCustomInput(true);
                                  setCustomLanguage('');
                                  return;
                                }
                                run('translate', language.value);
                              }}
                            >
                              {language.value === CUSTOM_LANGUAGE ? (
                                <span className="text-muted-foreground">Other…</span>
                              ) : (
                                language.label
                              )}
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                }

                return (
                  <DropdownMenuItem
                    key={config.id}
                    className="gap-2"
                    onSelect={() => run(config.id)}
                  >
                    <Icon className="h-4 w-4" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
