import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        warning: 'border-amber-200 bg-amber-50 text-amber-950',
        danger: 'border-red-200 bg-red-50 text-red-900',
        neutral: 'border-slate-200 bg-slate-50 text-slate-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

