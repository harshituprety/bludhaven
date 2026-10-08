import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2, UploadCloud } from 'lucide-react'
import Badge from '../Badge'
import Button from '../Button'
import ConfirmDialog from '../ConfirmDialog'
import DataState from '../DataState'
import FormAlert from '../FormAlert'
import useApiQuery from '../../hooks/useApiQuery'
import { deleteImage, listImages, reorderImages, updateImage, uploadImage } from '../../services/catalog'
import { apiError, fieldErrors, userMessage } from '../../services/errors'

// These mirror the backend defaults (IMAGE_MAX_BYTES, IMAGE_ALLOWED_FORMATS) only to save a round trip;
// the backend decides from the file content and stays authoritative.
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/** Pre-upload checks; returns a message or null. */
function checkFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) return 'Only JPEG, PNG or WebP photos can be uploaded.'
  if (file.size > MAX_BYTES) return `This photo is ${mb(file.size)}; the limit is ${mb(MAX_BYTES)}.`
  return null
}

function uploadMessage(error) {
  const e = apiError(error)
  if (e.code === 'validation_error') {
    const f = fieldErrors(error)
    return f.image || f.alt_text || f.position || f._ || e.message
  }
  // userMessage() maps every 5xx to a generic line; this one has a specific, useful meaning.
  if (e.code === 'storage_unavailable') return 'Photo storage is unavailable right now. Please try again shortly.'
  if (e.status === 413) return `This photo is too large; the limit is ${mb(MAX_BYTES)}.`
  return userMessage(e)
}

function ImageRow({ image, index, count, busy, onMove, onCover, onDelete, onSaveAlt }) {
  const id = useId()
  const [draft, setDraft] = useState(image.alt_text ?? '')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)
  const dirty = draft !== (image.alt_text ?? '')

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setNote(null)
    try {
      await onSaveAlt(image, draft)
      setNote({ tone: 'success', text: 'Saved.' })
    } catch (err) {
      setNote({ tone: 'error', text: fieldErrors(err).alt_text || userMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-card border border-line p-3 sm:flex-row sm:items-center">
      <img src={image.url} alt={image.alt_text || `Photo ${index + 1}`} loading="lazy" className="h-24 w-full flex-none rounded-lg bg-tint object-cover sm:w-36" />
      <form onSubmit={save} className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          {index === 0 ? <Badge tone="soft">Cover</Badge> : <span className="text-sm text-ink-soft">Photo {index + 1}</span>}
          {index > 0 && onCover && (
            <button type="button" disabled={busy} onClick={() => onCover(index)} aria-label={`Make photo ${index + 1} the cover`} className="text-sm font-semibold text-brand underline disabled:opacity-40">
              Make cover
            </button>
          )}
        </div>
        <label htmlFor={id} className="sr-only">
          Alt text for photo {index + 1}
        </label>
        <div className="flex gap-2">
          <input
            id={id}
            value={draft}
            maxLength={255}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe the photo (alt text)"
            className="min-w-0 flex-1 rounded-card border-[1.5px] border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-faint hover:border-ink-faint focus:border-primary"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save alt text'}
          </Button>
        </div>
        {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
      </form>
      <div className="flex items-center gap-1 sm:flex-col">
        <button
          type="button"
          aria-label={`Move photo ${index + 1} up`}
          disabled={busy || index === 0}
          onClick={() => onMove(index, -1)}
          className="grid size-9 place-items-center rounded-full border border-line hover:border-ink disabled:opacity-40"
        >
          <ArrowUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Move photo ${index + 1} down`}
          disabled={busy || index === count - 1}
          onClick={() => onMove(index, 1)}
          className="grid size-9 place-items-center rounded-full border border-line hover:border-ink disabled:opacity-40"
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Delete photo ${index + 1}`}
          disabled={busy}
          onClick={() => onDelete(image)}
          className="grid size-9 place-items-center rounded-full border border-line text-danger hover:border-danger disabled:opacity-40"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

/**
 * Photos of one property: upload (multipart), alt text, reorder (position 0 = cover) and delete.
 * `maxImages` is `usage.max_images_per_property` from the current subscription (missing = no limit stated).
 */
export default function ImageManager({ propertyId, maxImages, onCount }) {
  const { data, error, loading, reload } = useApiQuery((signal) => listImages(propertyId, signal), [propertyId])
  const inputId = useId()
  const count = data?.results?.length
  useEffect(() => {
    if (count !== undefined) onCount?.(count)
  }, [count, onCount])
  const fileInput = useRef(null)
  const [uploads, setUploads] = useState([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [deleteState, setDeleteState] = useState({ pending: false, error: null })

  const images = [...(data?.results ?? [])].sort((a, b) => a.position - b.position || a.id - b.id)
  const limited = typeof maxImages === 'number'

  async function onFiles(event) {
    const files = Array.from(event.target.files ?? [])
    if (fileInput.current) fileInput.current.value = ''
    if (!files.length) return
    setUploading(true)
    setUploads(files.map((file, i) => ({ key: `${Date.now()}-${i}`, name: file.name, status: 'queued', progress: 0 })))
    const patch = (i, change) => setUploads((list) => list.map((u, j) => (j === i ? { ...u, ...change } : u)))
    for (const [i, file] of files.entries()) {
      const problem = checkFile(file)
      if (problem) {
        patch(i, { status: 'error', message: problem })
        continue
      }
      patch(i, { status: 'uploading' })
      try {
        await uploadImage(propertyId, file, { altText: '', onProgress: (progress) => patch(i, { progress }) })
        patch(i, { status: 'done', progress: 100 })
      } catch (err) {
        patch(i, { status: 'error', message: uploadMessage(err) })
        if (['plan_limit_reached', 'subscription_required', 'storage_unavailable'].includes(apiError(err).code)) {
          // The same answer would come back for the rest of the batch.
          setUploads((list) => list.map((u, j) => (j > i && u.status === 'queued' ? { ...u, status: 'error', message: 'Skipped.' } : u)))
          break
        }
      }
    }
    setUploading(false)
    reload()
  }

  async function move(index, delta) {
    const a = images[index]
    const b = images[index + delta]
    if (!a || !b) return
    setBusy(true)
    setActionError(null)
    try {
      // Positions are unique per property, so a plain swap would clash: park `a` on a free slot first.
      const free = Math.max(...images.map((i) => i.position)) + 1
      const [pa, pb] = [a.position, b.position]
      await updateImage(propertyId, a.id, { position: free })
      await updateImage(propertyId, b.id, { position: pa })
      await updateImage(propertyId, a.id, { position: pb })
    } catch (err) {
      setActionError(fieldErrors(err).position || userMessage(err))
    } finally {
      setBusy(false)
      reload()
    }
  }

  async function makeCover(index) {
    setBusy(true)
    setActionError(null)
    try {
      await reorderImages(propertyId, [images[index].id, ...images.filter((_, i) => i !== index).map((i) => i.id)])
    } catch (err) {
      setActionError(userMessage(err))
    } finally {
      setBusy(false)
      reload()
    }
  }

  async function saveAlt(image, altText) {
    await updateImage(propertyId, image.id, { alt_text: altText })
    reload()
  }

  async function confirmDelete() {
    setDeleteState({ pending: true, error: null })
    try {
      await deleteImage(propertyId, toDelete.id)
      setToDelete(null)
      setDeleteState({ pending: false, error: null })
      reload()
    } catch (err) {
      setDeleteState({ pending: false, error: userMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft" aria-live="polite">
          {data ? (limited ? `${images.length} of ${maxImages} images` : `${images.length} ${images.length === 1 ? 'image' : 'images'} (no limit stated)`) : ''}
          {data && ' · The first photo is the cover.'}
        </p>
        <div>
          <input
            ref={fileInput}
            id={inputId}
            type="file"
            multiple
            accept={ALLOWED_TYPES.join(',')}
            onChange={onFiles}
            disabled={uploading}
            className="sr-only"
          />
          <label
            htmlFor={inputId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-transparent bg-primary px-4 py-1.5 text-sm font-semibold text-white has-[:disabled]:opacity-55 has-[:focus-visible]:outline-3 [&:has(input:disabled)]:cursor-not-allowed"
          >
            <UploadCloud size={16} aria-hidden="true" /> {uploading ? 'Uploading…' : 'Upload photos'}
          </label>
        </div>
      </div>
      <p className="text-xs text-ink-faint">JPEG, PNG or WebP, up to {mb(MAX_BYTES)} each. GIF, SVG and animated images are not accepted.</p>

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Upload progress">
          {uploads.map((u) => (
            <li key={u.key} className="rounded-card bg-mist px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">{u.name}</span>
                <span className="flex-none text-ink-soft">{u.status === 'done' ? 'Uploaded' : u.status === 'error' ? 'Failed' : u.status === 'uploading' ? `${u.progress}%` : 'Waiting'}</span>
              </div>
              {u.status === 'uploading' && (
                <div role="progressbar" aria-label={`Uploading ${u.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.progress} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tint">
                  <div className="h-full bg-primary" style={{ width: `${u.progress}%` }} />
                </div>
              )}
              {u.status === 'error' && <p role="alert" className="mt-1 font-semibold text-danger">{u.message}</p>}
            </li>
          ))}
        </ul>
      )}

      <FormAlert>{actionError}</FormAlert>

      <DataState loading={loading && !data} error={error} empty={data && images.length === 0} onRetry={reload} emptyTitle="No photos yet" emptyMessage="Add at least one photo; the first one becomes the cover." rows={2}>
        <ul className="flex flex-col gap-3">
          {images.map((image, index) => (
            <ImageRow key={image.id} image={image} index={index} count={images.length} busy={busy} onMove={move} onCover={makeCover} onDelete={(img) => { setDeleteState({ pending: false, error: null }); setToDelete(img) }} onSaveAlt={saveAlt} />
          ))}
        </ul>
      </DataState>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this photo?"
        message="The photo is removed from the property permanently."
        confirmLabel="Delete photo"
        danger
        pending={deleteState.pending}
        error={deleteState.error}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
