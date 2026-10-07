import { useState } from 'react'
import Button from './Button'
import FormAlert from './FormAlert'
import { customerCare } from '../config/site'

/**
 * "Contact Customer Care": how a Host starts or changes a subscription plan. Plans are never bought through Razorpay.
 * Opens an email to the configured Customer Care address (or, with only a phone number, shows it). When the site has
 * no contact details configured yet, it says so rather than linking nowhere.
 */
export default function CustomerCareAction({ subject = 'Subscription plan enquiry', size = 'md', variant = 'primary' }) {
  const { email, phone } = customerCare()
  const [shown, setShown] = useState(false)
  if (email) {
    return (
      <Button size={size} variant={variant} href={`mailto:${email}?subject=${encodeURIComponent(subject)}`} aria-label={`Contact Customer Care about ${subject}`}>
        Contact Customer Care
      </Button>
    )
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button size={size} variant={variant} onClick={() => setShown(true)} aria-expanded={shown}>
        Contact Customer Care
      </Button>
      {shown && (phone ? <FormAlert tone="info">Call Customer Care on {phone}.</FormAlert> : <FormAlert tone="info">Customer Care contact details aren’t available yet. Please check back soon.</FormAlert>)}
    </div>
  )
}
