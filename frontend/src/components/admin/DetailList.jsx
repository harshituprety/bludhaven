/** A label / value list used inside detail modals. Rows with an empty value are skipped. */
export default function DetailList({ items }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items
        .filter((i) => i.value !== undefined && i.value !== null && i.value !== '')
        .map((i) => (
          <div key={i.label}>
            <dt className="text-sm font-semibold text-ink-soft">{i.label}</dt>
            <dd className="mt-0.5 break-words">{i.value}</dd>
          </div>
        ))}
    </dl>
  )
}
