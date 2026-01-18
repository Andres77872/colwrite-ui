import * as React from 'react';
import { cn } from '@/lib/utils';

/* ============================================
   RESIZABLE PANEL SYSTEM
   Modern resizable panels with drag handles
   ============================================ */

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  className?: string;
}

/**
 * ResizeHandle - Draggable handle for resizing panels
 * Provides visual feedback and smooth drag interaction
 */
export function ResizeHandle({ direction, onResize, className }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const startPos = React.useRef(0);
  const onResizeRef = React.useRef(onResize);
  
  // Keep onResize ref updated
  React.useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const currentPos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
      const delta = currentPos - startPos.current;
      startPos.current = currentPos;
      onResizeRef.current(delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction]);

  return (
    <div
      className={cn(
        "group/handle relative flex-shrink-0 select-none",
        // Larger hit area for easier grabbing
        direction === 'horizontal' && [
          "w-3 cursor-col-resize",
          "flex items-center justify-center",
        ],
        direction === 'vertical' && [
          "h-3 cursor-row-resize",
          "flex items-center justify-center",
        ],
        className
      )}
      onMouseDown={handleMouseDown}
      style={{ touchAction: 'none' }}
    >
      {/* Visual indicator line */}
      <div
        className={cn(
          "transition-all duration-150 rounded-full",
          direction === 'horizontal' && [
            "w-1 h-8",
            "bg-border",
            "group-hover/handle:bg-primary/60 group-hover/handle:h-12",
            isDragging && "bg-primary h-16",
          ],
          direction === 'vertical' && [
            "h-1 w-8",
            "bg-border",
            "group-hover/handle:bg-primary/60 group-hover/handle:w-12",
            isDragging && "bg-primary w-16",
          ],
        )}
      />
    </div>
  );
}

/* ----------------------------------------
   Panel Container Types
   ---------------------------------------- */

interface ResizablePanelGroupProps {
  direction: 'horizontal' | 'vertical';
  children: React.ReactNode;
  className?: string;
}

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsed?: boolean;
  collapsedSize?: number;
  onCollapse?: () => void;
  onExpand?: () => void;
  onResize?: (size: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

interface PanelContextValue {
  direction: 'horizontal' | 'vertical';
}

const PanelContext = React.createContext<PanelContextValue | undefined>(undefined);

/**
 * ResizablePanelGroup - Container for resizable panels
 * Manages layout direction and panel relationships
 */
export function ResizablePanelGroup({ direction, children, className }: ResizablePanelGroupProps) {
  return (
    <PanelContext.Provider value={{ direction }}>
      <div
        className={cn(
          "flex h-full",
          direction === 'horizontal' && "flex-row",
          direction === 'vertical' && "flex-col",
          className
        )}
      >
        {children}
      </div>
    </PanelContext.Provider>
  );
}

/**
 * ResizablePanel - Individual resizable panel
 * Supports min/max constraints and collapse functionality
 */
export function ResizablePanel({
  children,
  defaultSize = 300,
  minSize = 200,
  maxSize = 600,
  collapsible = false,
  collapsed = false,
  collapsedSize = 0,
  className,
  style,
}: ResizablePanelProps) {
  const context = React.useContext(PanelContext);
  const direction = context?.direction ?? 'horizontal';
  
  const currentSize = collapsed ? collapsedSize : defaultSize;
  const sizeStyle = direction === 'horizontal' 
    ? { width: currentSize, minWidth: collapsed ? collapsedSize : minSize, maxWidth: collapsed ? collapsedSize : maxSize }
    : { height: currentSize, minHeight: collapsed ? collapsedSize : minSize, maxHeight: collapsed ? collapsedSize : maxSize };

  return (
    <div
      className={cn(
        "flex-shrink-0 overflow-hidden transition-all duration-200 ease-out",
        collapsed && "overflow-hidden",
        className
      )}
      style={{ ...sizeStyle, ...style }}
      data-collapsed={collapsed}
      data-collapsible={collapsible}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------
   Panel Header Component
   ---------------------------------------- */

interface PanelHeaderProps {
  title: string;
  icon?: React.ReactNode;
  collapsed?: boolean;
  onCollapse?: () => void;
  onClose?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * PanelHeader - Consistent header for all panels
 * Minimal, clean design that integrates with panel content
 */
export function PanelHeader({
  title,
  icon,
  collapsed,
  onCollapse,
  onClose,
  actions,
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-3 py-2",
        "border-b border-border/50",
        "flex-shrink-0",
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className="flex-shrink-0 text-primary/70">
            {icon}
          </span>
        )}
        <h3 className="font-medium text-sm truncate text-foreground/90">{title}</h3>
      </div>
      
      <div className="flex items-center gap-0.5">
        {actions}
        {onCollapse && (
          <button
            onClick={onCollapse}
            className={cn(
              "p-1.5 rounded-md text-muted-foreground",
              "hover:bg-muted hover:text-foreground transition-colors",
            )}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(
                "transition-transform duration-200",
                collapsed && "rotate-180"
              )}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className={cn(
              "p-1.5 rounded-md text-muted-foreground",
              "hover:bg-muted hover:text-foreground transition-colors",
            )}
            aria-label="Close panel"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------
   Collapsible Panel Wrapper
   ---------------------------------------- */

interface CollapsiblePanelProps {
  children: React.ReactNode;
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  side: 'left' | 'right';
  width: number;
  minWidth?: number;
  maxWidth?: number;
  collapsedWidth?: number;
  onWidthChange?: (width: number) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * CollapsiblePanel - Full-featured panel with resize and collapse
 * Combines resize handle, header, and content area
 */
export function CollapsiblePanel({
  children,
  title,
  icon,
  defaultOpen = true,
  side,
  width,
  minWidth = 200,
  maxWidth = 600,
  collapsedWidth = 0,
  onWidthChange,
  onCollapsedChange,
  actions,
  className,
}: CollapsiblePanelProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(!defaultOpen);
  const [currentWidth, setCurrentWidth] = React.useState(width);
  const previousWidth = React.useRef(width);

  const handleResize = React.useCallback((delta: number) => {
    setCurrentWidth((prev) => {
      // For left panel, positive delta increases width
      // For right panel, negative delta increases width
      const adjustedDelta = side === 'left' ? delta : -delta;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, prev + adjustedDelta));
      onWidthChange?.(newWidth);
      return newWidth;
    });
  }, [side, minWidth, maxWidth, onWidthChange]);

  const handleCollapse = React.useCallback(() => {
    if (!isCollapsed) {
      previousWidth.current = currentWidth;
    }
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    onCollapsedChange?.(newCollapsed);
    if (!newCollapsed) {
      setCurrentWidth(previousWidth.current);
      onWidthChange?.(previousWidth.current);
    }
  }, [isCollapsed, currentWidth, onCollapsedChange, onWidthChange]);

  const displayWidth = isCollapsed ? collapsedWidth : currentWidth;

  return (
    <div
      className={cn(
        "flex h-full transition-[width] duration-200 ease-out",
        side === 'left' && "flex-row",
        side === 'right' && "flex-row-reverse",
        className
      )}
      style={{ width: displayWidth }}
    >
      {/* Panel content */}
      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden",
          "bg-card border border-border rounded-lg",
          isCollapsed && "opacity-0 invisible"
        )}
      >
        <PanelHeader
          title={title}
          icon={icon}
          collapsed={isCollapsed}
          onCollapse={handleCollapse}
          actions={actions}
        />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
      
      {/* Resize handle - only show when expanded */}
      {!isCollapsed && (
        <ResizeHandle
          direction="horizontal"
          onResize={handleResize}
          className={cn(
            side === 'left' && "ml-1",
            side === 'right' && "mr-1",
          )}
        />
      )}
    </div>
  );
}
