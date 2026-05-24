import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-tight',
  {
    variants: {
      variant: {
        default:
          'border-white/18 bg-[rgba(var(--brand),0.18)] text-white',
        warning:
          'border-white/18 bg-[rgba(255,255,255,0.10)] text-white',
        danger:
          'border-white/18 bg-[rgba(255,95,95,0.18)] text-white',
        neutral:
          'border-white/14 bg-[rgba(var(--glass),0.08)] text-white/90',
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
