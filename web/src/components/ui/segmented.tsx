// A segmented control styled like shadcn/ui (MIT) Tabs (TabsList / TabsTrigger), built from plain toggle
// buttons (aria-pressed) so the view switch keeps its button role.
import * as React from 'react';
import { cn } from '../../lib/utils';

function Segmented({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="group" data-slot="segmented" className={cn('inline-flex h-8 items-center rounded-md bg-muted p-0.5 text-muted-foreground', className)} {...props} />;
}

function SegmentedItem({ className, active, ...props }: React.ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-state={active ? 'active' : 'inactive'}
      className={cn(
        'inline-flex h-7 items-center justify-center whitespace-nowrap rounded-[calc(var(--radius)-2px)] border border-transparent px-2.5 text-sm font-medium transition-[color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export { Segmented, SegmentedItem };
