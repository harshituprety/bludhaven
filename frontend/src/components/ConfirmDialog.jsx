import Modal from './Modal'
import Button from './Button'
import FormAlert from './FormAlert'

/** "Are you sure?" dialog for destructive actions. `error` shows the API's reason if the action fails. */
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger = false, pending = false, error, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-ink-soft">{message}</p>
      <FormAlert className="mt-4">{error}</FormAlert>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={pending} className={danger ? 'bg-danger hover:bg-danger' : undefined}>
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
