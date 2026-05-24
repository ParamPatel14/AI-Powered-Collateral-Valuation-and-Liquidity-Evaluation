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
      'glass flex h-11 w-full rounded-xl px-3 py-2 text-sm font-medium text-white outline-none placeholder:text-white/45 shadow-[0_16px_46px_-32px_rgba(0,0,0,0.85)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--brand),0.55)] disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
