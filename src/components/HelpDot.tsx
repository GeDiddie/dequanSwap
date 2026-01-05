import { type ReactNode } from 'react'

type HelpDotProps = {
  href?: string
  title?: string
  label?: string
  children?: ReactNode
}

export function HelpDot({ href, title, label = 'Help', children }: HelpDotProps) {
  if (!href) return null
  return (
    <a
      className="helpDot"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={title || label}
      onClick={(e) => e.stopPropagation()}
    >
      {children || '?'}
    </a>
  )
}
