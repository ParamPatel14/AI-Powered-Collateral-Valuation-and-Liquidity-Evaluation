import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold tracking-tight text-white shadow-[0_18px_42px_-28px_rgba(0,0,0,0.9)] transition will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--brand),0.55)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'border border-white/10 bg-[linear-gradient(135deg,rgba(var(--brand),0.95),rgba(var(--brand-2),0.78))] hover:brightness-110',
        secondary:
          'glass border-white/14 hover:bg-[rgba(var(--glass),0.12)]',
        outline:
          'border border-white/18 bg-transparent hover:bg-[rgba(var(--glass),0.08)]',
        ghost:
          'border border-transparent bg-transparent shadow-none hover:bg-[rgba(var(--glass),0.08)]',
      },
      size: {
        default: 'h-11',
        sm: 'h-10 px-3 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
