import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Seo from '../../components/Seo'
import Button from '../../components/Button'
import CheckEmail from '../../components/CheckEmail'
import FormAlert from '../../components/FormAlert'
import LoadingState from '../../components/LoadingState'
import PasswordField from '../../components/PasswordField'
import SelectField from '../../components/SelectField'
import TextAreaField from '../../components/TextAreaField'
import TextField from '../../components/TextField'
import ImageManager from '../../components/host/ImageManager'
import PlanPicker from '../../components/host/PlanPicker'
import Progress from '../../components/onboarding/Progress'
import useApiQuery from '../../hooks/useApiQuery'
import useAuth from '../../hooks/useAuth'
import { getCurrentSubscription } from '../../services/billing'
import { createProperty, getProperty, listAmenities, listDestinations, listImages, listProperties, publishProperty, updateProperty } from '../../services/catalog'
import { apiError, fieldErrors, userMessage } from '../../services/errors'
import { formatPrice } from '../../utils/format'
import { PROPERTY_TYPES, typeLabel } from '../../utils/mappers'
import { ROLES } from '../../utils/roles'

const STEPS = [
  { id: 'place', label: 'Your place' },
  { id: 'location', label: 'Location' },
  { id: 'details', label: 'Description' },
  { id: 'photos', label: 'Photos' },
  { id: 'amenities', label: 'Amenities' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'review', label: 'Review' },
  { id: 'plan', label: 'Plan and payment' },
]

const BLANK = {
  property_type: '', bedrooms: '1', bathrooms: '1', max_guests: '2',
  destination: '', locality: '', address_line1: '', address_line2: '', postal_code: '',
  title: '', description: '', amenities: [], price_per_night: '',
}

const whole = (v, min) => /^\d+$/.test(String(v).trim()) && Number(v) >= min

/** Local checks to save a round trip. The backend validates every one of these again and decides. */
function validate(stepId, v) {
  const e = {}
  if (stepId === 'place') {
    if (!v.property_type) e.property_type = 'Choose a property type.'
    if (!whole(v.max_guests, 1)) e.max_guests = 'Enter how many guests it sleeps (1 or more).'
    if (!whole(v.bedrooms, 0)) e.bedrooms = 'Enter a whole number.'
    if (!whole(v.bathrooms, 0)) e.bathrooms = 'Enter a whole number.'
  }
  if (stepId === 'location') {
    if (!v.destination) e.destination = 'Choose the city.'
    if (!v.address_line1.trim()) e.address_line1 = 'Enter the street address.'
    if (!/^\d{6}$/.test(v.postal_code.trim())) e.postal_code = 'Enter the 6-digit postal code.'
  }
  if (stepId === 'details') {
    if (!v.title.trim()) e.title = 'Give your place a title.'
    if (!v.description.trim()) e.description = 'Describe your place for guests.'
  }
  if (stepId === 'pricing') {
    if (!(Number(v.price_per_night) > 0)) e.price_per_night = 'Enter a price per night greater than 0.'
  }
  return e
}

const toPayload = (v, { draft }) => ({
  ...(draft ? { status: 'DRAFT' } : {}),
  property_type: v.property_type,
  bedrooms: Number(v.bedrooms),
  bathrooms: Number(v.bathrooms),
  max_guests: Number(v.max_guests),
  destination: Number(v.destination),
  locality: v.locality.trim(),
  address_line1: v.address_line1.trim(),
  address_line2: v.address_line2.trim(),
  postal_code: v.postal_code.trim(),
  title: v.title.trim(),
  description: v.description.trim(),
  amenities: v.amenities,
  ...(Number(v.price_per_night) > 0 ? { price_per_night: String(v.price_per_night).trim() } : {}),
})

const fromProperty = (p) => ({
  property_type: p.property_type ?? '',
  bedrooms: String(p.bedrooms ?? 1),
  bathrooms: String(p.bathrooms ?? 1),
  max_guests: String(p.max_guests ?? 2),
  destination: String(p.destination?.id ?? ''),
  locality: p.locality ?? '',
  address_line1: p.address_line1 ?? '',
  address_line2: p.address_line2 ?? '',
  postal_code: p.postal_code ?? '',
  title: p.title ?? '',
  description: p.description ?? '',
  amenities: (p.amenities ?? []).map((a) => a.id),
  price_per_night: Number(p.price_per_night) > 0 ? String(p.price_per_night) : '',
})

// --- account ----------------------------------------------------------------------------------------------------------

function AccountStep() {
  const { registerHost } = useAuth()
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [doneFor, setDoneFor] = useState('')

  async function submit(e) {
    e.preventDefault()
    const local = {}
    if (!form.fullName.trim()) local.full_name = 'Enter your name.'
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = 'Enter a valid email address.'
    if (form.password.length < 8) local.password = 'Use 8 or more characters.'
    setErrors(local)
    if (Object.keys(local).length) return
    setBusy(true)
    try {
      const email = form.email.trim()
      await registerHost({ email, fullName: form.fullName.trim(), password: form.password })
      setDoneFor(email) // the account cannot be used until the emailed link is opened, so no login yet
    } catch (err) {
      setErrors(fieldErrors(err))
      setBusy(false)
    }
  }

  if (doneFor) {
    return (
      <CheckEmail email={doneFor} loginPath="/host/login" loginState={{ from: '/host/onboarding' }}>
        <p className="text-ink-soft">Once you’re verified, log in as a Host and you’ll pick up right where you left off.</p>
      </CheckEmail>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-105 flex-col gap-4">
      <h1 className="text-display">Create your Host account</h1>
      <p className="text-ink-soft">First, a few details so you can manage your listing, bookings and payouts. You’ll add your place next.</p>
      <FormAlert>{errors._ || errors.role}</FormAlert>
      <TextField label="Full name" autoComplete="name" required value={form.fullName} error={errors.full_name} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
      <TextField label="Email" type="email" autoComplete="email" required value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <PasswordField autoComplete="new-password" minLength={8} required hint="Use 8 or more characters." value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
        {busy ? 'Creating your account…' : 'Create account'}
      </Button>
      <p className="text-ink-soft">
        Already a Host? <Link to="/host/login" state={{ from: '/host/onboarding' }} className="font-bold text-brand">Host Login</Link>
      </p>
    </form>
  )
}

// --- steps ------------------------------------------------------------------------------------------------------------

function Field({ v, set, errors, name, label, ...rest }) {
  return <TextField label={label} value={v[name]} onChange={set(name)} error={errors[name]} {...rest} />
}

function PlaceStep({ v, set, errors }) {
  return (
    <>
      <SelectField label="Property type" value={v.property_type} onChange={set('property_type')} error={errors.property_type} placeholder="Choose a type" options={PROPERTY_TYPES} required />
      <div className="grid gap-5 sm:grid-cols-3">
        <Field v={v} set={set} errors={errors} name="bedrooms" label="Bedrooms" type="number" min="0" step="1" />
        <Field v={v} set={set} errors={errors} name="bathrooms" label="Bathrooms" type="number" min="0" step="1" />
        <Field v={v} set={set} errors={errors} name="max_guests" label="Maximum guests" type="number" min="1" step="1" required />
      </div>
    </>
  )
}

function LocationStep({ v, set, errors, destinations }) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Country" value="India" readOnly hint="Blüdhaven lists stays in India." />
        <SelectField
          label="City"
          value={v.destination}
          onChange={set('destination')}
          error={errors.destination}
          placeholder="Choose a city"
          options={destinations.map((d) => ({ value: String(d.id), label: `${d.name}, ${d.state}` }))}
          required
        />
      </div>
      <Field v={v} set={set} errors={errors} name="locality" label="Area or neighbourhood" hint="Shown to guests, e.g. Candolim." />
      <Field v={v} set={set} errors={errors} name="address_line1" label="Street address" autoComplete="address-line1" required hint="Private. Guests see only the area, never your street address." />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field v={v} set={set} errors={errors} name="address_line2" label="Unit or apartment (optional)" autoComplete="address-line2" />
        <Field v={v} set={set} errors={errors} name="postal_code" label="Postal code" autoComplete="postal-code" inputMode="numeric" maxLength={6} required />
      </div>
    </>
  )
}

function DetailsStep({ v, set, errors }) {
  return (
    <>
      <Field v={v} set={set} errors={errors} name="title" label="Listing title" maxLength={150} required hint="A short, specific name, e.g. “Pine cabin with a valley view”." />
      <TextAreaField label="Description" rows={7} value={v.description} onChange={set('description')} error={errors.description} hint="What makes the stay special? Mention the space, the surroundings and anything guests should know." />
    </>
  )
}

function PhotosStep({ propertyId, maxImages, onCount, error }) {
  return (
    <>
      <FormAlert>{error}</FormAlert>
      <ImageManager propertyId={propertyId} maxImages={maxImages} onCount={onCount} />
    </>
  )
}

function AmenitiesStep({ v, setV, amenities, premiumAllowed }) {
  const toggle = (id) => setV((s) => ({ ...s, amenities: s.amenities.includes(id) ? s.amenities.filter((x) => x !== id) : [...s.amenities, id] }))
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Amenities</legend>
      {amenities.length === 0 && <p className="text-sm text-ink-soft">No amenities are available yet.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {amenities.map((a) => {
          const locked = a.is_premium && !premiumAllowed && !v.amenities.includes(a.id)
          return (
            <label key={a.id} className={`flex items-center gap-2 rounded-card border border-line px-3 py-2 text-sm ${locked ? 'opacity-60' : 'hover:border-ink-faint'}`}>
              <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={v.amenities.includes(a.id)} disabled={locked} onChange={() => toggle(a.id)} />
              <span className="flex-1">{a.name}</span>
              {a.is_premium && <span className="text-xs font-semibold text-ink-soft">{premiumAllowed || v.amenities.includes(a.id) ? 'Premium' : 'Premium plan'}</span>}
            </label>
          )
        })}
      </div>
      {!premiumAllowed && amenities.some((a) => a.is_premium) && <p className="text-sm text-ink-soft">Premium amenities come with some plans. You can add them later after choosing a plan that includes them.</p>}
    </fieldset>
  )
}

function PricingStep({ v, set, errors }) {
  return (
    <>
      <Field v={v} set={set} errors={errors} name="price_per_night" label="Price per night (₹)" type="number" inputMode="decimal" min="0" step="0.01" required hint="Guests pay this for each night they stay." />
      <p className="text-sm text-ink-soft">Your place opens for booking as soon as you publish. Nights that guests book are blocked automatically.</p>
    </>
  )
}

function Row({ label, step, onEdit, children }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line py-3 first:border-0">
      <div>
        <dt className="text-sm text-ink-soft">{label}</dt>
        <dd className="font-semibold">{children}</dd>
      </div>
      <button type="button" onClick={() => onEdit(step)} aria-label={`Edit ${label}`} className="text-sm font-semibold text-brand underline">Edit</button>
    </div>
  )
}

function ReviewStep({ v, destinations, amenities, photos, onEdit }) {
  const dest = destinations.find((d) => String(d.id) === v.destination)
  const chosen = amenities.filter((a) => v.amenities.includes(a.id)).map((a) => a.name)
  return (
    <dl>
      <Row onEdit={onEdit} label="Property" step="place">{typeLabel(v.property_type)} · {v.bedrooms} bedrooms · {v.bathrooms} bathrooms · up to {v.max_guests} guests</Row>
      <Row onEdit={onEdit} label="Location" step="location">
        {[v.address_line2, v.address_line1].filter(Boolean).join(', ')}, {v.locality ? `${v.locality}, ` : ''}{dest ? `${dest.name}, ${dest.state}` : ''} {v.postal_code}
        <span className="block text-sm font-normal text-ink-soft">Guests see only the area, not the street address.</span>
      </Row>
      <Row onEdit={onEdit} label="Title and description" step="details">
        {v.title}
        <span className="block max-w-prose text-sm font-normal text-ink-soft">{v.description}</span>
      </Row>
      <Row onEdit={onEdit} label="Photos" step="photos">{photos} {photos === 1 ? 'photo' : 'photos'} (the first is the cover)</Row>
      <Row onEdit={onEdit} label="Amenities" step="amenities">{chosen.length ? chosen.join(', ') : 'None selected'}</Row>
      <Row onEdit={onEdit} label="Price" step="pricing">{formatPrice(Number(v.price_per_night))} per night</Row>
    </dl>
  )
}

// --- the wizard -------------------------------------------------------------------------------------------------------

export default function HostOnboarding() {
  const { status, role, user, logout, refreshUser } = useAuth()
  const navigate = useNavigate()
  const isHost = status === 'authenticated' && role === ROLES.HOST
  const [step, setStep] = useState('place')
  const [v, setV] = useState(BLANK)
  const [propertyId, setPropertyId] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(true)
  const [photos, setPhotos] = useState(0)
  const [published, setPublished] = useState(null)
  const [publishError, setPublishError] = useState('')
  const [paid, setPaid] = useState(false)

  const destinations = useApiQuery((signal) => listDestinations({}, signal), [])
  const amenities = useApiQuery((signal) => listAmenities({}, signal), [])
  const current = useApiQuery((signal) => (isHost ? getCurrentSubscription(signal) : Promise.resolve(null)), [isHost])
  const features = current.data?.subscription?.plan?.features ?? {}
  const maxImages = current.data?.usage?.max_images_per_property
  const premiumAllowed = Boolean(features.premium_amenities)

  // Resume the most recent draft, so leaving halfway loses nothing.
  useEffect(() => {
    if (!isHost) {
      setLoadingDraft(false) // eslint-disable-line react-hooks/set-state-in-effect
      return undefined
    }
    let live = true
    ;(async () => {
      try {
        const list = await listProperties({ mine: true, status: 'DRAFT', page_size: 1 })
        const draft = list.results?.[0]
        if (draft && live) {
          const full = await getProperty(draft.id)
          const imgs = await listImages(draft.id)
          if (!live) return
          setV(fromProperty(full))
          setPropertyId(full.id)
          setPhotos(imgs.results?.length ?? 0)
          setResumed(true)
        }
      } catch {
        /* a failed lookup just starts a fresh draft */
      } finally {
        if (live) setLoadingDraft(false)
      }
    })()
    return () => {
      live = false
    }
  }, [isHost])

  const set = (name) => (e) => setV((s) => ({ ...s, [name]: e.target.value }))
  const go = useCallback((id) => {
    setErrors({})
    setStep(id)
  }, [])
  const index = STEPS.findIndex((s) => s.id === step)

  async function saveDraft() {
    if (propertyId) return updateProperty(propertyId, toPayload(v, { draft: false }))
    const created = await createProperty(toPayload(v, { draft: true }))
    setPropertyId(created.id)
    return created
  }

  async function next() {
    const local = validate(step, v)
    if (step === 'photos' && photos < 1) local._ = 'Add at least one photo.'
    setErrors(local)
    if (Object.keys(local).length) return
    // From the location step on there is something to keep: save the draft on the server at every Next.
    if (['location', 'details', 'photos', 'amenities', 'pricing'].includes(step) && step !== 'photos') {
      setBusy(true)
      try {
        await saveDraft()
      } catch (err) {
        setErrors({ ...fieldErrors(err), _: fieldErrors(err)._ ?? undefined })
        setBusy(false)
        return
      }
      setBusy(false)
    }
    go(STEPS[index + 1].id)
  }

  const back = () => go(STEPS[Math.max(0, index - 1)].id)

  async function publish() {
    setBusy(true)
    setPublishError('')
    try {
      const prop = await publishProperty(propertyId)
      setPublished(prop)
    } catch (err) {
      setPublishError(userMessage(apiError(err)))
    } finally {
      setBusy(false)
    }
  }

  const hasPlan = Boolean(current.data?.subscription)
  const header = useMemo(() => ({
    place: ['Tell us about your place', 'The basics help guests know what to expect.'],
    location: ['Where is it?', 'Your street address stays private. Guests only see the area.'],
    details: ['Describe your place', 'A clear title and description help your listing stand out.'],
    photos: ['Add photos', 'Upload JPEG, PNG or WebP photos. The first one is your cover photo; you can reorder them or pick another cover.'],
    amenities: ['What does it offer?', 'Choose the amenities guests will find.'],
    pricing: ['Set your price', 'You can change it any time.'],
    review: ['Review your listing', 'Check everything before choosing a plan. Select Edit to change a step.'],
    plan: ['Choose a plan to publish', 'Pick a plan and pay securely. Your listing stays a draft until the payment is verified.'],
  }), [])

  if (status === 'loading' || (isHost && loadingDraft)) return <LoadingState label="Getting your listing ready" />

  const shell = (children) => (
    <div className="page-container max-w-3xl pt-12 pb-24">
      <Seo title="List your property" description="Create a Host account, add your property and start welcoming guests on Blüdhaven." path="/host/onboarding" noindex />
      {children}
    </div>
  )

  if (status === 'authenticated' && role === ROLES.END_USER)
    return shell(
      <div className="flex max-w-prose flex-col gap-4">
        <h1 className="text-display">You’re signed in as a guest</h1>
        <p className="text-ink-soft">Host accounts are separate from guest accounts, so your guest account doesn’t become a Host account automatically. Log out to create a Host account with a new email address, or log in as a Host.</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={async () => { await logout(); navigate('/host/onboarding') }}>Log out and create a Host account</Button>
          <Button variant="secondary" to="/">Back to browsing</Button>
        </div>
      </div>,
    )
  if (status === 'authenticated' && role === ROLES.SUPER_ADMIN)
    return shell(
      <div className="flex max-w-prose flex-col gap-4">
        <h1 className="text-display">Admins don’t list properties here</h1>
        <p className="text-ink-soft">Use the Admin area to manage properties.</p>
        <div><Button to="/admin">Go to Admin</Button></div>
      </div>,
    )
  if (!isHost) return shell(<AccountStep />)

  if (published)
    return shell(
      <div className="flex max-w-prose flex-col gap-4" role="status">
        <h1 className="text-display">Your listing is live</h1>
        <p className="text-ink-soft">“{published.title}” is published and guests can now book it.</p>
        <div className="flex flex-wrap gap-3">
          <Button to={`/properties/${published.id}`}>View your listing</Button>
          <Button variant="secondary" to="/host">Go to Host dashboard</Button>
        </div>
      </div>,
    )

  const [title, lead] = header[step]
  const stepBody = {
    place: <PlaceStep v={v} set={set} errors={errors} />,
    location: <LocationStep v={v} set={set} errors={errors} destinations={destinations.data?.results ?? []} />,
    details: <DetailsStep v={v} set={set} errors={errors} />,
    photos: propertyId ? <PhotosStep propertyId={propertyId} maxImages={maxImages} onCount={setPhotos} error={errors._} /> : null,
    amenities: <AmenitiesStep v={v} setV={setV} amenities={amenities.data?.results ?? []} premiumAllowed={premiumAllowed} />,
    pricing: <PricingStep v={v} set={set} errors={errors} />,
    review: <ReviewStep v={v} destinations={destinations.data?.results ?? []} amenities={amenities.data?.results ?? []} photos={photos} onEdit={go} />,
    plan: null,
  }[step]

  return shell(
    <>
      {resumed && step === 'place' && <FormAlert tone="info">We found your unfinished listing and loaded it. Carry on where you left off.</FormAlert>}
      <Progress steps={STEPS} current={step} onGo={go} />
      <h1 className="text-display">{title}</h1>
      <p className="mt-2 mb-8 max-w-prose text-ink-soft">{lead}</p>

      {step !== 'plan' ? (
        <div className="flex flex-col gap-5">
          {step !== 'photos' && <FormAlert>{errors._}</FormAlert>}
          {stepBody}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" onClick={back} disabled={index === 0 || busy}>Back</Button>
            <Button onClick={next} disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : step === 'review' ? 'Continue to plan' : 'Next'}
            </Button>
          </div>
          {propertyId && <p className="text-sm text-ink-soft">Your progress is saved as a draft. You can leave and come back any time.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {!user?.is_email_verified && (
            <FormAlert tone="info">
              Confirm your email address to pay. We sent a link to {user?.email}. After you open it, press{' '}
              <button type="button" className="font-semibold underline" onClick={() => refreshUser().catch(() => {})}>I’ve confirmed</button>.
            </FormAlert>
          )}
          {hasPlan && (
            <div className="flex flex-col gap-3 rounded-panel bg-tint p-5">
              <p>
                {paid ? 'Payment verified. ' : ''}You’re on the <strong>{current.data.subscription.plan.name}</strong> plan. Publish your listing now, or choose a different plan below.
              </p>
              <FormAlert>{publishError}</FormAlert>
              <div><Button onClick={publish} disabled={busy}>{busy ? 'Publishing…' : 'Publish my listing'}</Button></div>
            </div>
          )}
          <PlanPicker onActivated={() => { setPaid(true); current.reload() }} />
          <div><Button variant="secondary" onClick={back}>Back</Button></div>
        </div>
      )}
    </>,
  )
}
