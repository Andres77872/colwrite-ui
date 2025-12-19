import { cn } from '@/lib/utils';
import { useEditor } from '../../../editor';
import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  GripVertical, Plus, Eye, EyeOff, Lock, Unlock, 
  ChevronRight, ChevronDown, Trash2, Type, 
  Heading2, Minus 
} from 'lucide-react';

interface MenuProps {
  open: boolean;
  onClose: () => void;
  position: { top: number; left: number };
  children: React.ReactNode;
}

function FloatingMenu({ open, onClose, position, children }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Delay to prevent immediate close from the same click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-2xl py-1 min-w-[180px] animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ top: position.top, left: position.left }}
    >
      {children}
    </div>,
    document.body
  );
}

export function BlockControls({ id }: { id: string }) {
  const { 
    addBlockAfter, removeBlock, toggleAiHidden, toggleLocked, 
    toggleCollapsed, blocks, setParagraphColumns, setHeadingLevel, refs,
    openMenuBlockId, openMenuType, setBlockMenu
  } = useEditor();
  
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const optsBtnRef = useRef<HTMLButtonElement>(null);
  const positionRef = useRef({ top: 0, left: 0 });
  
  const block = blocks.find(b => b.id === id);
  
  // This block's menu is open if global state matches
  const isAddMenuOpen = openMenuBlockId === id && openMenuType === 'add';
  const isOptionsMenuOpen = openMenuBlockId === id && openMenuType === 'options';
  const hasAnyMenuOpen = isAddMenuOpen || isOptionsMenuOpen;

  const openMenu = useCallback((type: 'add' | 'options', btnRef: React.RefObject<HTMLButtonElement | null>) => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    positionRef.current = { top: rect.top, left: rect.right + 8 };
    
    // Toggle: if same menu, close; otherwise open new
    if (openMenuBlockId === id && openMenuType === type) {
      setBlockMenu(null, null);
    } else {
      setBlockMenu(id, type);
    }
  }, [id, openMenuBlockId, openMenuType, setBlockMenu]);

  const closeMenu = useCallback(() => {
    setBlockMenu(null, null);
  }, [setBlockMenu]);

  const handleAddBlock = useCallback((type: 'paragraph' | 'heading' | 'divider') => {
    const newId = addBlockAfter(id, type);
    closeMenu();
    queueMicrotask(() => refs.current[newId]?.focus());
  }, [id, addBlockAfter, closeMenu, refs]);

  return (
    <div
      className={cn(
        "absolute left-0 top-1 flex items-center gap-1",
        "opacity-0 group-hover:opacity-100 transition-opacity",
        hasAnyMenuOpen && "opacity-100"
      )}
      style={{ transform: 'translateX(calc(-100% - 4px))' }}
    >
      {/* Add Button */}
      <button
        ref={addBtnRef}
        type="button"
        className={cn(
          "w-6 h-6 flex items-center justify-center rounded",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          isAddMenuOpen && "bg-accent text-foreground"
        )}
        title="Add block"
        onClick={() => openMenu('add', addBtnRef)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Drag Handle / Options */}
      <button
        ref={optsBtnRef}
        type="button"
        className={cn(
          "w-6 h-6 flex items-center justify-center rounded cursor-grab",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          "active:cursor-grabbing",
          isOptionsMenuOpen && "bg-accent text-foreground"
        )}
        title="Drag to reorder, click for options"
        draggable
        onClick={() => openMenu('options', optsBtnRef)}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.setData('application/x-block-id', id);
          e.dataTransfer.effectAllowed = 'move';
          closeMenu();
        }}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Add Block Menu */}
      <FloatingMenu 
        open={isAddMenuOpen} 
        onClose={closeMenu} 
        position={positionRef.current}
      >
        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
          Add Block
        </div>
        <div className="py-1">
          <MenuItem icon={<Type className="w-4 h-4" />} label="Paragraph" onClick={() => handleAddBlock('paragraph')} />
          <MenuItem icon={<Heading2 className="w-4 h-4" />} label="Heading" onClick={() => handleAddBlock('heading')} />
          <MenuItem icon={<Minus className="w-4 h-4" />} label="Divider" onClick={() => handleAddBlock('divider')} />
        </div>
      </FloatingMenu>

      {/* Options Menu */}
      <FloatingMenu 
        open={isOptionsMenuOpen} 
        onClose={closeMenu} 
        position={positionRef.current}
      >
        {/* Block Type Header */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          {block?.type === 'paragraph' && <><Type className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Paragraph</span></>}
          {block?.type === 'heading' && <><Heading2 className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Heading {(block as any)?.level || 2}</span></>}
          {block?.type === 'divider' && <><Minus className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Divider</span></>}
        </div>

        {/* Paragraph: Columns */}
        {block?.type === 'paragraph' && (
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Columns</div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  type="button"
                  className={cn(
                    "flex-1 h-7 rounded text-xs font-medium border",
                    n === ((block as any)?.columns || 1)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-accent"
                  )}
                  onClick={() => { setParagraphColumns(id, n); closeMenu(); }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Heading: Level */}
        {block?.type === 'heading' && (
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Level</div>
            <div className="flex gap-1">
              {[1, 2, 3].map(l => (
                <button
                  key={l}
                  type="button"
                  className={cn(
                    "flex-1 h-7 rounded text-xs font-bold border",
                    l === ((block as any)?.level || 2)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-accent"
                  )}
                  onClick={() => { setHeadingLevel(id, l as 1|2|3); closeMenu(); }}
                >
                  H{l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Insert Below */}
        <div className="py-1 border-b border-border">
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Insert Below</div>
          <MenuItem icon={<Type className="w-3.5 h-3.5" />} label="Paragraph" onClick={() => handleAddBlock('paragraph')} />
          <MenuItem icon={<Heading2 className="w-3.5 h-3.5" />} label="Heading" onClick={() => handleAddBlock('heading')} />
          <MenuItem icon={<Minus className="w-3.5 h-3.5" />} label="Divider" onClick={() => handleAddBlock('divider')} />
        </div>

        {/* Actions */}
        <div className="py-1">
          <MenuItem
            icon={(block as any)?.aiHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            label={(block as any)?.aiHidden ? 'Show to AI' : 'Hide from AI'}
            onClick={() => { toggleAiHidden(id); closeMenu(); }}
            className={(block as any)?.aiHidden ? 'text-pink-400' : ''}
          />
          <MenuItem
            icon={(block as any)?.locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            label={(block as any)?.locked ? 'Unlock' : 'Lock'}
            onClick={() => { toggleLocked(id); closeMenu(); }}
            className={(block as any)?.locked ? 'text-amber-400' : ''}
          />
          <MenuItem
            icon={(block as any)?.collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            label={(block as any)?.collapsed ? 'Expand' : 'Collapse'}
            onClick={() => { toggleCollapsed(id); closeMenu(); }}
          />
          <MenuItem
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="Delete"
            onClick={() => { removeBlock(id); closeMenu(); }}
            className="text-destructive hover:bg-destructive/10"
          />
        </div>
      </FloatingMenu>
    </div>
  );
}

// Simple menu item component
function MenuItem({ 
  icon, 
  label, 
  onClick, 
  className 
}: { 
  icon: React.ReactNode; 
  label: string; 
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left",
        "hover:bg-accent transition-colors",
        className
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
