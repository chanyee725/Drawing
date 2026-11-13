// shadcn/ui (MIT) new-york Toggle + ToggleGroup, adapted: relative imports, one file, the variants this app uses.
// Single-choice groups keep toggle-button semantics (role="button" + aria-pressed, design doc 6 §5) instead of
// Radix's default radio role for type="single".
import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
        // Tabs-like: a muted track with the pressed item raised (what the old Segmented control drew).
        segmented: 'border border-transparent text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:border-border aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs',
      },
      size: {
        default: 'h-8 min-w-8 px-2',
        sm: 'h-7 min-w-7 px-2.5',
        lg: 'h-9 min-w-9 px-2.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants> & { value?: string }>({ size: 'default', variant: 'default' });

/** One choice out of several, shown as pressed toggle buttons. Picking the pressed item again keeps it. */
function ToggleGroup({
  className,
  variant,
  size,
  value,
  onValueChange,
  children,
  ...props
}: Omit<React.ComponentProps<typeof ToggleGroupPrimitive.Root>, 'type' | 'value' | 'defaultValue' | 'onValueChange'> &
  VariantProps<typeof toggleVariants> & { value: string; onValueChange: (value: string) => void }) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      data-slot="toggle-group"
      data-variant={variant}
      value={value}
      onValueChange={(v: string) => v && onValueChange(v)}
      className={cn('group/toggle-group flex w-fit items-center rounded-md', variant === 'segmented' && 'h-8 bg-muted p-0.5', className)}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, value }}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({ className, children, variant, size, value, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const ctx = React.useContext(ToggleGroupContext);
  const pressed = ctx.value === value;
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      value={value}
      // Toggle-button semantics (Radix makes single-choice items radios): later props win over Radix's own.
      role="button"
      aria-checked={undefined}
      aria-pressed={pressed}
      className={cn(toggleVariants({ variant: ctx.variant || variant, size: ctx.size || size }), className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
