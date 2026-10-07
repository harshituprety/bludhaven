import { useState } from 'react'
import { Star } from 'lucide-react'
import Button from '../Button'
import FormAlert from '../FormAlert'
import TextAreaField from '../TextAreaField'
import VerifyEmailNotice from '../booking/VerifyEmailNotice'
import useMutation from '../../hooks/useMutation'
import { createReview, updateReview } from '../../services/bookings'
import { apiError, fieldErrors, userMessage } from '../../services/errors'
import { cx } from '../../utils/ui'

const MAX_COMMENT = 2000

/**
 * Rating (1-5) and an optional comment for a completed stay. The server enforces every rule (completed stay,
 * one review per booking, verified email), so its answer is shown as it comes.
 * Pass `review` ({ id, rating, comment }) to edit an existing review instead of creating one.
 */
export default function ReviewForm({ bookingId, review, propertyTitle, onSubmitted, onCancel }) {
  const [rating, setRating] = useState(review?.rating ?? 0)
  const [comment, setComment] = useState(review?.comment ?? '')
  const [problems, setProblems] = useState({})
  const [notVerified, setNotVerified] = useState(false)
  const { run, pending, error } = useMutation(review ? ({ rating: r, comment: c }) => updateReview(review.id, { rating: r, comment: c }) : createReview)

  const submit = async (event) => {
    event.preventDefault()
    setNotVerified(false)
    if (!rating) {
      setProblems({ rating: 'Choose a rating from 1 to 5 stars.' })
      return
    }
    setProblems({})
    try {
      const saved = await run({ bookingId, rating, comment: comment.trim() })
      onSubmitted?.(saved)
    } catch (err) {
      if (apiError(err).code === 'email_not_verified') {
        setNotVerified(true)
        return
      }
      const f = fieldErrors(err)
      setProblems({ rating: f.rating, comment: f.comment, general: f._ || f.booking || f.non_field_errors || f.detail })
    }
  }

  const general = problems.general || (error && !problems.rating && !problems.comment && !notVerified ? userMessage(error) : '')

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label={`Review ${propertyTitle}`}>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-semibold">Your rating</legend>
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`} />
              <Star
                size={30}
                aria-hidden="true"
                strokeWidth={1.5}
                fill={n <= rating ? 'currentColor' : 'none'}
                className={cx('rounded transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-marigold/80', n <= rating ? 'text-marigold-600' : 'text-ink-faint')}
              />
            </label>
          ))}
        </div>
        {problems.rating && (
          <small role="alert" className="mt-1 block font-semibold text-danger">
            {problems.rating}
          </small>
        )}
      </fieldset>
      <TextAreaField
        label="Your review (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={MAX_COMMENT}
        hint={`${comment.length} / ${MAX_COMMENT}`}
        error={problems.comment}
        placeholder="What was it like to stay here?"
      />
      {notVerified && <VerifyEmailNotice action="write reviews" />}
      <FormAlert>{general}</FormAlert>
      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : review ? 'Save changes' : 'Post review'}
        </Button>
      </div>
    </form>
  )
}
