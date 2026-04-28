import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap border-2 border-black bg-white px-4 py-2 text-sm font-black text-black shadow-[4px_4px_0_0_#000] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000] disabled:pointer-events-none disabled:opacity-60 ring-offset-white',
  {
    variants: {
      variant: {
        default:
          'bg-[#00E5FF] hover:bg-[#00D0E8]',
        secondary:
          'bg-[#FFE600] hover:bg-[#F2D800]',
        outline:
          'bg-white hover:bg-slate-50',
        ghost: 'border-transparent bg-transparent shadow-none hover:bg-slate-100 active:shadow-none',
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
