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
      'flex h-10 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-emerald-900/5 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ring-offset-white',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

