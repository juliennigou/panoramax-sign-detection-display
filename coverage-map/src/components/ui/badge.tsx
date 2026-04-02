import * as React from 'react'

import { cn } from '../../lib/utils'

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'muted' | 'strong'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <span className={cn('ui-badge', `ui-badge-${variant}`, className)} {...props} />
}
