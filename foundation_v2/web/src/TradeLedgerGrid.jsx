import DataTable, { SortResetColumn } from './DataTable.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import TestingIcon from './TestingIcon.jsx'
import { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'

// Training and live trades deliberately share this grid contract. Each surface
// owns only its row adapter, columns and data actions; borders, states and
// interaction geometry stay identical.
export default function TradeLedgerGrid({
  rows, current, size, shownColumns, columnHeader, renderCell, cellClass, rowKey,
  sortResetActive = false, onClearSort, disabled = false,
  pending = false, selected = '', onSelect, checked = new Set(), onToggle,
  allChecked = false, mixedChecked = false, selectPage, onTogglePage,
  totalCount, pages, onPageChange, onPageSizeChange, paginationLabel,
  tableLabel = 'Giao dịch, cuộn ngang để xem các cột', dataTestId, pageSizeOptions, rowNumberOffset = 0,
}) {
  const { t } = useTestingLocale()
  const selectable = typeof onToggle === 'function'
  const actionable = typeof onSelect === 'function'
  return <>
    <DataTable contained className="fxa-table-scroll" label={t(tableLabel)} data-testid={dataTestId}>
      <thead><tr>
        <SortResetColumn active={sortResetActive} disabled={disabled} onClear={onClearSort} />
        {selectable && <th className="is-center"><input ref={selectPage} disabled={pending} aria-checked={mixedChecked ? 'mixed' : allChecked} aria-label={t('Chọn các lệnh trên trang')} type="checkbox" checked={allChecked} onChange={onTogglePage} /></th>}
        {actionable && <th className="is-center">{t('Actions')}</th>}
        {shownColumns.map(columnHeader)}
      </tr></thead>
      <tbody>{pending ? <tr><td colSpan={shownColumns.length + 1 + Number(selectable) + Number(actionable)}><TestingSkeleton rows={3} /></td></tr> : rows.map((row, index) => {
        const key = rowKey(row)
        const isSelected = selected === key
        return <tr key={key} data-checked={selectable && checked.has(key) || undefined} className={isSelected ? 'is-selected' : undefined}>
          <td className="wm-table-row-number" data-column="row_number">{rowNumberOffset + index + 1}</td>
          {selectable && <td className="is-center"><input type="checkbox" aria-label={t('Chọn lệnh {id}', { id: key })} checked={checked.has(key)} onChange={() => onToggle(key)} /></td>}
          {actionable && <td className="is-center"><button className="fxa-detail-button wm-table-row-action" type="button" aria-label={t('Chi tiết {id}', { id: key })} aria-pressed={isSelected} onClick={() => onSelect(isSelected ? '' : key)}><TestingIcon kind="journal" size={16} /></button></td>}
          {shownColumns.map(([column]) => <td key={column} data-column={column} className={cellClass?.(column)}>{renderCell(row, column)}</td>)}
        </tr>
      })}</tbody>
    </DataTable>
    <PaginationFooter showCount={false} totalCount={totalCount} label={paginationLabel} data-testid={dataTestId ? `${dataTestId}-pagination` : undefined} page={current + 1} pages={pages} onPageChange={onPageChange} pageSize={size} onPageSizeChange={onPageSizeChange} pending={pending} unknown={totalCount === null} sizes={pageSizeOptions} />
  </>
}
