import { cx } from '../../utils/ui'

/**
 * A plain responsive table. `columns` is [{ key, header, render?(row), className? }]; rows scroll sideways on narrow screens.
 */
export default function DataTable({ columns, rows, rowKey = 'id', caption }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-160 border-collapse text-left text-[0.9375rem]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-3 py-2 text-sm font-semibold whitespace-nowrap text-ink-soft', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[rowKey]} className="border-t border-line align-top">
              {columns.map((c) => (
                <td key={c.key} className={cx('px-3 py-3', c.className)}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
