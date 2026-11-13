// shadcn/ui (MIT) new-york Sidebar, adapted and trimmed for the app shell (design doc 6 §2.1, §3.1):
// relative imports, no desktop collapse (the sidebar is always shown from 768px; below that it is a Sheet drawer),
// SidebarInset has two frames: `floating` (inset panel on the frame, layout B) and `attached` (flush, 1px left line,
// layout A, used by the document screen). Sizes follow doc 6 §4.2: 264px wide, 30px rows, 44px rows in the drawer.
import * as React from 'react';
import { Slot as SlotPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';
import { FOCUS_RING } from '../../lib/focus';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';

const SIDEBAR_WIDTH = '264px';
const MOBILE_QUERY = '(max-width: 767px)';

// Sidebar colours. The shell and sidebar sit on --sidebar; the inset panel stays on --background.
const C = {
  bg: 'bg-sidebar text-sidebar-foreground',
  hover: 'hover:bg-accent hover:text-foreground',
  active: 'aria-[current=page]:bg-muted aria-[current=page]:text-foreground',
  border: 'border-sidebar-border',
};

type SidebarContextValue = { isMobile: boolean; openMobile: boolean; setOpenMobile: (open: boolean) => void; toggleSidebar: () => void };
const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider.');
  return ctx;
}

export function useIsMobile() {
  const [mobile, setMobile] = React.useState(() => window.matchMedia(MOBILE_QUERY).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

/** `openMobile` / `onOpenMobileChange` make the drawer controlled (the app closes it after opening a file). */
function SidebarProvider({
  className,
  style,
  children,
  openMobile: openProp,
  onOpenMobileChange,
  ...props
}: React.ComponentProps<'div'> & { openMobile?: boolean; onOpenMobileChange?: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  const [openState, setOpenState] = React.useState(false);
  const openMobile = openProp ?? openState;
  const setOpenMobile = React.useCallback((o: boolean) => (onOpenMobileChange ? onOpenMobileChange(o) : setOpenState(o)), [onOpenMobileChange]);
  const toggleSidebar = React.useCallback(() => setOpenMobile(!openMobile), [setOpenMobile, openMobile]);
  const value = React.useMemo(() => ({ isMobile, openMobile, setOpenMobile, toggleSidebar }), [isMobile, openMobile, toggleSidebar]);
  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        style={{ '--sidebar-width': SIDEBAR_WIDTH, ...style } as React.CSSProperties}
        className={cn('flex h-full w-full', C.bg, className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

/** Desktop: a column on the frame. Mobile: a left drawer with its own (screen-reader) title. */
function Sidebar({ className, children, label, ...props }: React.ComponentProps<'nav'> & { label: string }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const nav = (
    <nav data-slot="sidebar" aria-label={label} className={cn('flex h-full w-(--sidebar-width) shrink-0 flex-col', C.bg, className)} {...props}>
      {children}
    </nav>
  );
  if (!isMobile) return nav;
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent side="left" className={cn('w-[min(var(--sidebar-width),85vw)] p-0', C.bg, C.border)} aria-describedby={undefined}>
        <SheetTitle className="sr-only">{label}</SheetTitle>
        <SheetDescription className="sr-only">보기, 프로젝트, 모델 연결</SheetDescription>
        {nav}
      </SheetContent>
    </Sheet>
  );
}

/** The main panel next to the sidebar. */
function SidebarInset({ className, frame = 'floating', ...props }: React.ComponentProps<'main'> & { frame?: 'floating' | 'attached' }) {
  return (
    <div data-slot="sidebar-inset-wrap" className={cn('flex min-w-0 flex-1', frame === 'floating' && 'md:py-2 md:pr-2')}>
      <main
        data-slot="sidebar-inset"
        data-frame={frame}
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-hidden bg-background',
          frame === 'floating' ? 'md:rounded-xl md:border md:shadow-xs' : 'md:border-l',
          C.border,
          className,
        )}
        {...props}
      />
    </div>
  );
}

const SidebarHeader = ({ className, ...props }: React.ComponentProps<'div'>) => <div data-slot="sidebar-header" className={cn('flex flex-col gap-0.5 p-2', className)} {...props} />;
const SidebarContent = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-2', className)} {...props} />
);
const SidebarFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot="sidebar-footer" className={cn('mx-2 mb-2 flex flex-col gap-0.5 border-t pt-2', C.border, className)} {...props} />
);
const SidebarGroup = ({ className, ...props }: React.ComponentProps<'div'>) => <div data-slot="sidebar-group" className={cn('relative flex flex-col', className)} {...props} />;
const SidebarGroupLabel = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot="sidebar-group-label" className={cn('flex h-[30px] items-center px-2 text-xs font-medium text-muted-foreground', className)} {...props} />
);
function SidebarGroupAction({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="sidebar-group-action"
      className={cn('absolute top-0.5 right-1 flex size-[26px] items-center justify-center rounded-md text-muted-foreground outline-none max-md:size-11 max-md:top-[-7px] [&>svg]:size-[15px]', C.hover, FOCUS_RING, className)}
      {...props}
    />
  );
}

const SidebarMenu = ({ className, ...props }: React.ComponentProps<'ul'>) => <ul data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-px', className)} {...props} />;
const SidebarMenuItem = ({ className, ...props }: React.ComponentProps<'li'>) => <li data-slot="sidebar-menu-item" className={cn('group/menu-item relative', className)} {...props} />;

const MENU_BUTTON =
  'flex h-[30px] w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm font-medium text-sidebar-foreground/80 outline-none select-none max-md:h-11 disabled:opacity-50 [&>svg]:size-[17px] [&>svg]:shrink-0';

function SidebarMenuButton({ asChild = false, className, ...props }: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? SlotPrimitive.Root : 'button';
  return <Comp data-slot="sidebar-menu-button" {...(asChild ? {} : { type: 'button' as const })} className={cn(MENU_BUTTON, C.hover, C.active, FOCUS_RING, className)} {...props} />;
}

/** A small button at the right end of a menu row (expand, more). Shown always on touch, on hover/focus otherwise. */
function SidebarMenuAction({ className, showOnHover = false, ...props }: React.ComponentProps<'button'> & { showOnHover?: boolean }) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-action"
      className={cn(
        'absolute top-[3px] right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none max-md:top-0 max-md:size-11 [&>svg]:size-[15px]',
        C.hover,
        FOCUS_RING,
        showOnHover && 'md:opacity-0 md:group-hover/menu-item:opacity-100 md:group-focus-within/menu-item:opacity-100 md:data-[state=open]:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

const SidebarMenuBadge = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span data-slot="sidebar-menu-badge" className={cn('pointer-events-none ml-auto shrink-0 text-xs text-muted-foreground tabular-nums', className)} {...props} />
);

const SidebarMenuSub = ({ className, ...props }: React.ComponentProps<'ul'>) => <ul data-slot="sidebar-menu-sub" className={cn('flex min-w-0 flex-col gap-px', className)} {...props} />;

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      className={cn('flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none max-md:size-11', C.hover, FOCUS_RING, className)}
      onClick={(e) => {
        onClick?.(e);
        toggleSidebar();
      }}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarProvider,
  SidebarTrigger,
};
