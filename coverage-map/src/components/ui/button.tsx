import * as React from 'react'

import { cn } from '../../lib/utils'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'ghost' | 'outline'
  size?: 'default' | 'sm'
}

export function Button({ className, variant = 'default', size = 'default', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)} {...props} />
}
