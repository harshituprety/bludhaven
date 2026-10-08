import Seo from '../../components/Seo'
import PageHeader from '../../components/PageHeader'
import PlanPicker from '../../components/host/PlanPicker'

export default function HostPlans() {
  return (
    <div>
      <Seo title="Plans" noindex />
      <PageHeader title="Choose a plan" lead="Pick a plan, pay securely, and it starts as soon as the payment is verified." />
      <PlanPicker />
    </div>
  )
}
