import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'

interface DialogProps {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}

export function Dialog({ title, children, onClose, busy = false }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog ref={ref} className="store-dialog" aria-labelledby={titleId} onCancel={(event) => {
      event.preventDefault()
      if (!busy) onClose()
    }}>
      <div className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close">
          <X size={21} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  )
}
