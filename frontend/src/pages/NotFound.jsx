import { Compass } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import Button from '../components/Button'
import Seo from '../components/Seo'

export default function NotFound() {
  return (
    <>
      <Seo title="Page not found" noindex />
      <EmptyState
        heading="h1"
        icon={Compass}
        title="This page doesn’t exist"
        message="The link may be broken or the page may have moved."
        action={<Button to="/">Back to home</Button>}
      />
    </>
  )
}
