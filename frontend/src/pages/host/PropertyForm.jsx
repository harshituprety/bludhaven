import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Seo from '../../components/Seo'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import FormAlert from '../../components/FormAlert'
import SelectField from '../../components/SelectField'
import TextField from '../../components/TextField'
import TextAreaField from '../../components/TextAreaField'
import ImageManager from '../../components/host/ImageManager'
import useApiQuery from '../../hooks/useApiQuery'
import { createProperty, getProperty, listAmenities, listDestinations, updateProperty } from '../../services/catalog'
import { getCurrentSubscription } from '../../services/billing'
import { apiError, fieldErrors } from '../../services/errors'
import { PROPERTY_TYPES } from '../../utils/mappers'

const EMPTY = { title: '', description: '', property_type: '', destination: '', locality: '', price_per_night: '', max_guests: '1', bedrooms: '1', bathrooms: '1', amenities: [] }

function fromProperty(p) {
  return {
    title: p.title ?? '',
    description: p.description ?? '',
    property_type: p.property_type ?? '',
    destination: String(p.destination?.id ?? ''),
    locality: p.locality ?? '',
    price_per_night: p.price_per_night != null ? String(p.price_per_night) : '',
    max_guests: String(p.max_guests ?? 1),
    bedrooms: String(p.bedrooms ?? 0),
    bathrooms: String(p.bathrooms ?? 0),
    amenities: (p.amenities ?? []).map((a) => a.id),
  }
}

/** The request body: exactly the writable fields. The owner is the signed-in Host, set by the server. */
function toBody(v) {
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    property_type: v.property_type,
    destination: v.destination ? Number(v.destination) : null,
    locality: v.locality.trim(),
    price_per_night: v.price_per_night.trim(),
    max_guests: v.max_guests === '' ? null : Number(v.max_guests),
    bedrooms: v.bedrooms === '' ? null : Number(v.bedrooms),
    bathrooms: v.bathrooms === '' ? null : Number(v.bathrooms),
    amenities: v.amenities,
  }
}

function FormBody({ initial, propertyId, destinations, amenities, notice, admin, ownerName }) {
  const navigate = useNavigate()
  const editing = propertyId != null
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState({})
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(null)
  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }))
  const toggleAmenity = (id) => setValues((v) => ({ ...v, amenities: v.amenities.includes(id) ? v.amenities.filter((a) => a !== id) : [...v.amenities, id] }))

  async function submit(e) {
    e.preventDefault()
    setPending(true)
    setErrors({})
    setSaved(null)
    try {
      const body = toBody(values)
      if (editing) {
        await updateProperty(propertyId, body)
        setSaved('Changes saved.')
      } else {
        const created = await createProperty(body)
        navigate(`/host/properties/${created.id}/edit`, { replace: true, state: { created: true } })
      }
    } catch (err) {
      const f = fieldErrors(err)
      const code = apiError(err).code
      // A field the form has no input for (or a non-field error) is shown at the top.
      const known = new Set(Object.keys(EMPTY))
      const loose = Object.entries(f).filter(([k]) => !known.has(k))
      setErrors({ ...f, _: code === 'validation_error' ? loose.map(([, m]) => m).join(' ') || undefined : f._ })
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FormAlert tone="success">{notice}</FormAlert>
      <FormAlert tone="success">{saved}</FormAlert>
      <FormAlert>{errors._}</FormAlert>
      {admin && ownerName && (
        <p className="text-sm text-ink-soft">
          Owner: <span className="font-semibold text-ink">{ownerName}</span>
        </p>
      )}
      <TextField label="Title" value={values.title} onChange={set('title')} error={errors.title} required maxLength={160} />
      <TextAreaField label="Description" rows={6} value={values.description} onChange={set('description')} error={errors.description} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Property type" value={values.property_type} onChange={set('property_type')} error={errors.property_type} placeholder="Choose a type" options={PROPERTY_TYPES} required />
        <SelectField
          label="Destination"
          value={values.destination}
          onChange={set('destination')}
          error={errors.destination}
          placeholder="Choose a destination"
          options={destinations.map((d) => ({ value: String(d.id), label: `${d.name}, ${d.state}` }))}
          required
        />
      </div>
      <TextField label="Locality" value={values.locality} onChange={set('locality')} error={errors.locality} hint="The area or neighbourhood, e.g. Candolim." />
      <div className="grid gap-5 sm:grid-cols-4">
        <TextField label="Price per night (₹)" type="number" inputMode="decimal" min="0" step="0.01" value={values.price_per_night} onChange={set('price_per_night')} error={errors.price_per_night} required />
        <TextField label="Max guests" type="number" min="1" step="1" value={values.max_guests} onChange={set('max_guests')} error={errors.max_guests} required />
        <TextField label="Bedrooms" type="number" min="0" step="1" value={values.bedrooms} onChange={set('bedrooms')} error={errors.bedrooms} />
        <TextField label="Bathrooms" type="number" min="0" step="1" value={values.bathrooms} onChange={set('bathrooms')} error={errors.bathrooms} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Amenities</legend>
        {amenities.length === 0 && <p className="text-sm text-ink-soft">No amenities are available yet.</p>}
        <div className="grid gap-2 sm:grid-cols-3">
          {amenities.map((a) => (
            <label key={a.id} className="flex items-center gap-2 rounded-card border border-line px-3 py-2 text-sm hover:border-ink-faint">
              <input type="checkbox" checked={values.amenities.includes(a.id)} onChange={() => toggleAmenity(a.id)} className="size-4 accent-[var(--color-primary)]" />
              {a.name}
            </label>
          ))}
        </div>
        {errors.amenities && (
          <small role="alert" className="font-semibold text-danger">
            {errors.amenities}
          </small>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Create property'}
        </Button>
        <Button to={admin ? '/admin/properties' : '/host/properties'} variant="secondary">
          Back to properties
        </Button>
      </div>
    </form>
  )
}

/** Host: create/edit own properties. `admin` (Super Admin route): edit any property, no create, no owner change. */
export default function PropertyForm({ admin = false }) {
  const { id } = useParams()
  const location = useLocation()
  const editing = Boolean(id)
  const prop = useApiQuery((signal) => getProperty(id, signal), [id], { enabled: editing })
  const dest = useApiQuery((signal) => listDestinations({}, signal), [])
  const amen = useApiQuery((signal) => listAmenities({}, signal), [])
  // /subscriptions/current/ is Host-only; plan limits for an admin edit come from the backend's errors.
  const sub = useApiQuery((signal) => getCurrentSubscription(signal), [], { enabled: !admin })

  const loading = (editing && prop.loading) || dest.loading || amen.loading
  const error = (editing && prop.error) || dest.error || amen.error
  const reload = () => {
    if (editing) prop.reload()
    dest.reload()
    amen.reload()
  }
  const ready = !loading && !error && dest.data && amen.data && (!editing || prop.data)
  const noSub = !admin && sub.data && !sub.data.subscription

  return (
    <div>
      <Seo title={editing ? 'Edit property' : 'Add property'} noindex />
      <PageHeader title={editing ? 'Edit property' : 'Add property'} lead={admin ? 'Edit any listing on behalf of the platform. The owner stays the same.' : editing ? 'Update the details and manage the photos.' : 'Add the details first; you can upload photos right after.'} />
      {!editing && noSub && (
        <FormAlert tone="info" className="mb-4">
          <span>
            You don’t have an active subscription, so creating a property will be refused.{' '}
            <Link to="/host/subscription" className="font-semibold underline">
              View your subscription
            </Link>
            .
          </span>
        </FormAlert>
      )}
      <Panel title="Details">
        <DataState loading={loading} error={error} onRetry={reload} rows={5}>
          {ready && (
            <FormBody
              key={editing ? `${id}-${prop.data.updated_at}` : 'new'}
              initial={editing ? fromProperty(prop.data) : EMPTY}
              propertyId={editing ? Number(id) : null}
              destinations={dest.data.results}
              amenities={amen.data.results}
              admin={admin}
              ownerName={prop.data?.owner?.full_name}
              notice={location.state?.created ? 'Property created. Add some photos below.' : null}
            />
          )}
        </DataState>
      </Panel>
      {editing && (
        <Panel title="Photos" className="mt-6">
          <ImageManager propertyId={id} maxImages={admin ? undefined : sub.data?.usage?.max_images_per_property} />
        </Panel>
      )}
    </div>
  )
}
