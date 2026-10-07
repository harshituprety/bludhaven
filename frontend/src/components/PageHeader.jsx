/** Title + lead line + optional right-aligned actions, used at the top of dashboard pages. */
export default function PageHeader({ title, lead, actions, as: Heading = 'h1' }) {
  return (
    <header data-reveal="heading" className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Heading className="text-display">{title}</Heading>
        {lead && <p className="mt-1 text-ink-soft">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
