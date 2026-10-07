import { useState } from 'react'
import Modal from '../Modal'
import Button from '../Button'
import FormAlert from '../FormAlert'
import TextField from '../TextField'
import { createAmenity, createDestination, updateAmenity, updateDestination } from '../../services/catalog'
import useSubmit from './useSubmit'

const str = (v) => (v === null || v === undefined ? '' : String(v))

function FormActions({ pending, label, onClose }) {
  return (
    <div className="flex justify-end gap-3">
      <Button variant="secondary" onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  )
}

export function DestinationFormModal({ destination, onClose, onSaved }) {
  const editing = Boolean(destination)
  const [form, setForm] = useState({
    name: str(destination?.name),
    state: str(destination?.state),
    tagline: str(destination?.tagline),
    imageUrl: str(destination?.image_url),
    displayOrder: str(destination?.display_order),
  })
  const [local, setLocal] = useState({})
  const { run, pending, error, fields } = useSubmit((body) => (editing ? updateDestination(destination.id, body) : createDestination(body)), ['name', 'state', 'tagline', 'image_url', 'display_order'])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const problems = {}
    if (!form.name.trim()) problems.name = 'Enter a name.'
    if (!form.state.trim()) problems.state = 'Enter a state.'
    if (form.displayOrder.trim() !== '' && !/^\d+$/.test(form.displayOrder.trim())) problems.display_order = 'Use a whole number, 0 or more.'
    setLocal(problems)
    if (Object.keys(problems).length) return
    const body = { name: form.name.trim(), state: form.state.trim(), tagline: form.tagline.trim(), image_url: form.imageUrl.trim() }
    if (form.displayOrder.trim() !== '') body.display_order = Number(form.displayOrder)
    const res = await run(body)
    if (res.ok) onSaved(res.data)
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${destination.name}` : 'New destination'}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" value={form.name} onChange={set('name')} error={local.name || fields.name} />
          <TextField label="State" value={form.state} onChange={set('state')} error={local.state || fields.state} />
        </div>
        <TextField label="Tagline" value={form.tagline} onChange={set('tagline')} error={fields.tagline} />
        <TextField label="Image URL" type="url" inputMode="url" value={form.imageUrl} onChange={set('imageUrl')} error={fields.image_url} hint="A link to a picture. Leave blank to use the standard artwork." />
        <TextField label="Display order" inputMode="numeric" value={form.displayOrder} onChange={set('displayOrder')} error={local.display_order || fields.display_order} hint="Lower numbers appear first." />
        <FormAlert>{error}</FormAlert>
        <FormActions pending={pending} label={editing ? 'Save changes' : 'Create destination'} onClose={onClose} />
      </form>
    </Modal>
  )
}

export function AmenityFormModal({ amenity, onClose, onSaved }) {
  const editing = Boolean(amenity)
  const [name, setName] = useState(str(amenity?.name))
  const { run, pending, error, fields } = useSubmit((body) => (editing ? updateAmenity(amenity.id, body) : createAmenity(body)), ['name'])
  async function submit(e) {
    e.preventDefault()
    const res = await run({ name: name.trim() })
    if (res.ok) onSaved(res.data)
  }
  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${amenity.name}` : 'New amenity'}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
        <FormAlert>{error}</FormAlert>
        <FormActions pending={pending} label={editing ? 'Save changes' : 'Create amenity'} onClose={onClose} />
      </form>
    </Modal>
  )
}
