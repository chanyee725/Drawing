// A dense native <select> in the shadcn/ui (MIT) Select look: the browser's own control (keyboard, mobile pickers,
// form semantics) with the app's border, height and chevron. Used where tests and a11y rely on a real <select>.
import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <span data-slot="native-select" className="relative inline-flex">
      <select
        className={cn(
          'h-7 appearance-none rounded-md border border-input bg-transparent py-0 pr-6 pl-2 text-xs text-foreground transition-[color,border-color,box-shadow] outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export { NativeSelect };
