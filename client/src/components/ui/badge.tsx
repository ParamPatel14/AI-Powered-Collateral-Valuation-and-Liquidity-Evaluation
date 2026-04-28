import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center border-2 border-black px-2.5 py-0.5 text-xs font-black text-black',
  {
    variants: {
      variant: {
        default: 'bg-[#00E5FF]',
        warning: 'bg-[#FFE600]',
        danger: 'bg-[#FF4D4D]',
        neutral: 'bg-white',
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
