import { useState } from 'react'
import Modal from '../Modal'
import Button from '../Button'
import FormAlert from '../FormAlert'
import TextAreaField from '../TextAreaField'
import TextField from '../TextField'
import { createPlan, updatePlan } from '../../services/billing'
import { buildFeatures } from './adminFormat'
import useSubmit from './useSubmit'

const blank = (v) => (v === null || v === undefined ? '' : String(v))
const isWhole = (v) => /^\d+$/.test(v.trim())

export default function PlanFormModal({ plan, onClose, onSaved }) {
  const editing = Boolean(plan)
  const [form, setForm] = useState({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price: blank(plan?.price),
    durationDays: blank(plan?.duration_days),
    maxProperties: blank(plan?.features?.max_properties),
    maxImages: blank(plan?.features?.max_images_per_property),
    premiumAmenities: Boolean(plan?.features?.premium_amenities),
    isActive: plan?.is_active ?? true,
    isTrial: plan?.is_trial ?? false,
  })
  const [local, setLocal] = useState({})
  const { run, pending, error, fields } = useSubmit((body) => (editing ? updatePlan(plan.id, body) : createPlan(body)), ['name', 'description', 'price', 'duration_days', 'features', 'is_active', 'is_trial'])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const problems = {}
    if (!form.name.trim()) problems.name = 'Enter a name.'
    if (form.price.trim() === '' || !(Number(form.price) >= 0)) problems.price = 'Enter a price.'
    else if (form.isTrial && Number(form.price) !== 0) problems.price = 'A free trial plan must cost 0.'
    if (!isWhole(form.durationDays) || Number(form.durationDays) < 1) problems.duration_days = 'Enter the number of days (a whole number, 1 or more).'
    if (form.maxProperties.trim() !== '' && !isWhole(form.maxProperties)) problems.maxProperties = 'Use a whole number, or leave blank for no limit.'
    if (form.maxImages.trim() !== '' && !isWhole(form.maxImages)) problems.maxImages = 'Use a whole number, or leave blank for no limit.'
    setLocal(problems)
    if (Object.keys(problems).length) return
    const res = await run({
      name: form.name.trim(),
      description: form.description.trim(),
      price: form.price.trim(),
      duration_days: Number(form.durationDays),
      features: buildFeatures({ ...form, hadPremiumFlag: Boolean(plan?.features && 'premium_amenities' in plan.features) }),
      is_active: form.isActive,
      is_trial: form.isTrial,
    })
    if (res.ok) onSaved(res.data)
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${plan.name}` : 'New plan'}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Name" value={form.name} onChange={set('name')} error={local.name || fields.name} />
        <TextAreaField label="Description" value={form.description} onChange={set('description')} error={fields.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Price (₹)" inputMode="decimal" value={form.price} onChange={set('price')} error={local.price || fields.price} />
          <TextField label="Duration (days)" inputMode="numeric" value={form.durationDays} onChange={set('durationDays')} error={local.duration_days || fields.duration_days} />
        </div>
        <fieldset className="flex flex-col gap-3 rounded-card border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Limits (optional)</legend>
          <p className="text-sm text-ink-soft">Leave a field blank for no limit.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Max properties" inputMode="numeric" value={form.maxProperties} onChange={set('maxProperties')} error={local.maxProperties} />
            <TextField label="Max photos per property" inputMode="numeric" value={form.maxImages} onChange={set('maxImages')} error={local.maxImages} />
          </div>
          {fields.features && <small role="alert" className="font-semibold text-danger">{fields.features}</small>}
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={form.premiumAmenities} onChange={(e) => setForm((f) => ({ ...f, premiumAmenities: e.target.checked }))} className="size-4" />
            Allow premium amenities (the ones marked premium)
          </label>
        </fieldset>
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="size-4" />
          Active (available to assign and visible on the public plans page)
        </label>
        <label className="flex items-start gap-2 font-semibold">
          <input type="checkbox" checked={form.isTrial} onChange={(e) => setForm((f) => ({ ...f, isTrial: e.target.checked }))} className="mt-1 size-4" />
          <span>
            Free trial plan <span className="block text-sm font-normal text-ink-soft">Price must be 0. Each Host can start it once, and only before they have a paid plan.</span>
          </span>
        </label>
        {fields.is_trial && <small role="alert" className="font-semibold text-danger">{fields.is_trial}</small>}
        <FormAlert>{error}</FormAlert>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
