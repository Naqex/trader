import './data-table.css'

// Keep one native table inside one viewport so horizontal scrolling cannot
// separate column headings from the rows they describe.
export default function DataTable({ children, label, className = '', tableClassName = '', tableProps, viewportRef, ...props }) {
  return <div {...props} ref={viewportRef} className={`wm-table-scroll ${className}`} role="region" tabIndex={0} aria-label={label}>
    <table {...tableProps} className={`wm-data-table ${tableClassName}`}>{children}</table>
  </div>
}

export function SortableColumn({ children, active = false, direction = 'asc', onSort, onClear, priority, clearLabel, sortLabel, disabled = false, className = '', ...props }) {
  const multi = Boolean(onClear)
  const button = <button type="button" className="wm-table-sort" onClick={onSort} aria-label={sortLabel} disabled={disabled}>
      <span className="wm-table-heading-label">{children}</span>
      <span className="wm-table-sort-indicator">
      <svg className={`wm-table-sort-icon${active ? ' is-active' : ''}`} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {active ? direction === 'asc' ? <path d="m4 7 4-4 4 4M8 3v10" /> : <path d="m4 9 4 4 4-4M8 13V3" /> : <path d="m3 6 3-3 3 3M6 3v10m1-3 3 3 3-3M10 13V3" />}
      </svg>
      {active && priority && <span className="wm-table-sort-priority" aria-hidden="true">{priority}</span>}
      </span>
    </button>
  return <th {...props} scope="col" className={className} data-sort-active={active || undefined} aria-sort={active && (!priority || priority === 1) ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
    {multi ? <div className="wm-table-sort-control">{button}{active ? <button type="button" className="wm-table-sort-clear" onClick={onClear} aria-label={clearLabel} title={clearLabel} disabled={disabled}>×</button> : <span className="wm-table-sort-clear-space" aria-hidden="true" />}</div> : button}
  </th>
}
