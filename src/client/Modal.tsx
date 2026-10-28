/** Minimal modal: backdrop, ESC, focus, click-outside. No dependencies. */

import { useEffect, useRef, type ReactNode } from 'react'

/** Modal props. */
export interface ModalProps {
  /** Heading text, also the dialog's accessible name. */
  title: string
  /** Accessible label for the close control. */
  closeLabel: string
  /** Close request (ESC, backdrop click, close button). */
  onClose: () => void
  /** Dialog content. */
  children: ReactNode
  /** Optional action row pinned under the content. */
  footer?: ReactNode
  /** Width hint in pixels (defaults to the sheet's 720). */
  width?: number
}

/**
 * Render one dialog over the console page.
 *
 * @param props - title, close handler, content.
 * @returns the overlay + panel.
 */
export function Modal({ title, closeLabel, onClose, children, footer, width }: ModalProps): ReactNode {
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div
      className="dmcp-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        className="dmcp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        style={width === undefined ? undefined : { maxWidth: `${width}px` }}
      >
        <header className="dmcp-modal-head">
          <h3 className="dmcp-modal-title">{title}</h3>
          <button type="button" className="dmcp-iconbtn" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="dmcp-modal-body">{children}</div>
        {footer === undefined ? null : <footer className="dmcp-modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
