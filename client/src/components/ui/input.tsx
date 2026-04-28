import * as React from 'react'

import { cn } from '../../lib/utils'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-11 w-full border-2 border-black bg-white px-3 py-2 text-sm font-medium text-black shadow-[4px_4px_0_0_#000] outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ring-offset-white',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
