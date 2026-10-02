/** `heading` sets the title's level: use "h1" when this is the whole page (404, missing stay). */
export default function EmptyState({ icon: Icon, title, message, action, heading: Heading = 'h2' }) {
  return (
    <div className="mx-auto my-18 flex max-w-110 flex-col items-center gap-3 px-4 text-center">
      {Icon && (
        <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-tint text-brand">
          <Icon size={28} />
        </span>
      )}
      <Heading className="text-[1.75rem]">{title}</Heading>
      {message && <p className="text-ink-soft">{message}</p>}
      {action}
    </div>
  )
}
