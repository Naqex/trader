import './data-table.css'

// Keep one native table inside one viewport so horizontal scrolling cannot
// separate column headings from the rows they describe.
export default function DataTable({ children, label, className = '', tableClassName = '', tableProps, viewportRef, ...props }) {
  return <div {...props} ref={viewportRef} className={`wm-table-scroll ${className}`} role="region" tabIndex={0} aria-label={label}>
    <table {...tableProps} className={`wm-data-table ${tableClassName}`}>{children}</table>
  </div>
}

export function SortableColumn({ children, active = false, direction = 'asc', onSort, disabled = false, className = '', ...props }) {
  return <th {...props} scope="col" className={className} aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
    <button type="button" className="wm-table-sort" onClick={onSort} disabled={disabled}>
      <span className="wm-table-heading-label">{children}</span>
      <svg className={`wm-table-sort-icon${active ? ' is-active' : ''}`} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {active ? direction === 'asc' ? <path d="m4 7 4-4 4 4M8 3v10" /> : <path d="m4 9 4 4 4-4M8 13V3" /> : <path d="m3 6 3-3 3 3M6 3v10m1-3 3 3 3-3M10 13V3" />}
      </svg>
    </button>
  </th>
}
