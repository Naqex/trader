import DataTable, { SortResetColumn } from './DataTable.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import ChartIcon from './ChartIcon.jsx'
import { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import { TradeJournalToolbar, TradeJournalActionDialog } from './TradeJournalPreview.jsx'

// Training and live trades deliberately share this grid contract. Each surface
// owns only its row adapter, columns and data actions; borders, states and
// interaction geometry stay identical.
export default function TradeLedgerGrid({
  rows, current, size, shownColumns, columnHeader, renderCell, cellClass, rowKey,
  sortResetActive = false, onClearSort, disabled = false,
  pending = false, selected = '', onSelect, checked = new Set(), onToggle,
  allChecked = false, mixedChecked = false, selectPage, onTogglePage,
  totalCount, pages, onPageChange, onPageSizeChange, paginationLabel,
  tableLabel = 'Giao dịch, cuộn ngang để xem các cột', dataTestId, pageSizeOptions, rowNumberOffset = 0, sourceKind='practice',
  journalView: controlledJournalView, onJournalView, showJournalToolbar = true, showBulkActions = false,
}) {
  const { t } = useTestingLocale()
  const [localJournalView,setLocalJournalView]=useState('active'),[journalAction,setJournalAction]=useState(null)
  const journalView=controlledJournalView ?? localJournalView
  const changeJournalView=value=>{ (onJournalView || setLocalJournalView)(value); onSelect?.(''); checked.forEach(key=>onToggle?.(key)) }
  const displayRows=rows.filter(row=>journalView==='all' || (journalView==='deleted')===(row.journal_deleted===true))
  const selectable = typeof onToggle === 'function'
  const actionable = typeof onSelect === 'function'
  useEffect(() => { if (selectPage?.current) selectPage.current.indeterminate = mixedChecked }, [selectPage, mixedChecked, pending, rows])
  return <>
    {showJournalToolbar && <TradeJournalToolbar sourceKind={sourceKind} view={journalView} onView={changeJournalView} checkedCount={checked.size} showBulkActions={showBulkActions} onAction={(action,count)=>setJournalAction({action,count})}/>}
    <DataTable contained className="fxa-table-scroll" label={t(tableLabel)} data-testid={dataTestId}>
      <thead><tr>
        <SortResetColumn active={sortResetActive} disabled={disabled} onClear={onClearSort} />
        {selectable && <th className="is-center"><input ref={selectPage} disabled={pending || !displayRows.length} aria-checked={mixedChecked ? 'mixed' : allChecked} aria-label={t('Chọn các lệnh trên trang')} type="checkbox" checked={allChecked} onChange={onTogglePage} /></th>}
        {actionable && <th className="is-center">{t('Actions')}</th>}
        {shownColumns.map(columnHeader)}
      </tr></thead>
      <tbody>{pending ? <tr><td colSpan={shownColumns.length + 1 + Number(selectable) + Number(actionable)}><TestingSkeleton rows={3} /></td></tr> : !displayRows.length ? <tr><td colSpan={shownColumns.length + 1 + Number(selectable) + Number(actionable)}><div className="wm-journal-preview-empty">{journalView==='deleted'?<><p>{t('Xóa/khôi phục nhật ký chưa được bật.')}</p><p>{t('Giao dịch đã xóa sẽ xuất hiện tại đây khi tính năng được bật.')}</p></>:t('Chưa có giao dịch trong bộ lọc này.')}</div></td></tr> : displayRows.map((row, index) => {
        const key = rowKey(row)
        const isSelected = selected === key
        const activate = () => onSelect(isSelected ? '' : key)
        return <tr key={key} data-checked={selectable && checked.has(key) || undefined} className={[isSelected && 'is-selected', actionable && 'is-actionable'].filter(Boolean).join(' ') || undefined}
          tabIndex={actionable ? 0 : undefined} aria-selected={actionable ? isSelected : undefined}
          onClick={actionable ? event => {
            if (!event.currentTarget.contains(event.target) || event.target.closest('button,a,input,select,textarea,label,[role="button"],[role="checkbox"],[contenteditable="true"]')) return
            const selection = window.getSelection()
            if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return
            event.currentTarget.focus({preventScroll:true}); activate()
          } : undefined}
          onKeyDown={actionable ? event => { if (event.target === event.currentTarget && ['Enter',' '].includes(event.key)) { event.preventDefault(); activate() } } : undefined}>
          <td className="wm-table-row-number" data-column="row_number">{rowNumberOffset + index + 1}</td>
          {selectable && <td className="is-center"><input type="checkbox" aria-label={t('Chọn lệnh {id}', { id: key })} checked={checked.has(key)} onChange={() => onToggle(key)} /></td>}
          {actionable && <td className="is-center"><div className="wm-trade-row-actions"><button className="fxa-detail-button wm-table-row-action" type="button" aria-label={t('Chi tiết {id}', { id: key })} data-note-state={row.has_notes===true?'with':row.has_notes===false?'without':'unknown'} title={t(row.has_notes===true?'Có ghi chú':row.has_notes===false?'Chưa có ghi chú':'Chưa xác minh ghi chú')} aria-pressed={isSelected} onClick={() => onSelect(isSelected ? '' : key)}><ChartIcon name={row.has_notes===true?'note-filled':'note-empty'} width={18} height={18}/></button><button type="button" className="wm-table-row-action wm-trade-journal-action" aria-label={t(row.journal_deleted?'Khôi phục giao dịch {id}':'Xóa giao dịch {id}',{id:key})} data-tooltip={t(row.journal_deleted?'Khôi phục':'Xóa khỏi nhật ký')} onClick={()=>setJournalAction({action:row.journal_deleted?'restore':'delete',count:1})}><ChartIcon name={row.journal_deleted?'history-restore':'trash'}/></button></div></td>}
          {shownColumns.map(([column]) => <td key={column} data-column={column} className={cellClass?.(column)}>{renderCell(row, column)}</td>)}
        </tr>
      })}</tbody>
    </DataTable>
    {journalView!=='deleted' && <PaginationFooter showCount={false} totalCount={totalCount} label={paginationLabel} data-testid={dataTestId ? `${dataTestId}-pagination` : undefined} page={current + 1} pages={pages} onPageChange={onPageChange} pageSize={size} onPageSizeChange={onPageSizeChange} pending={pending} unknown={totalCount === null} sizes={pageSizeOptions} />}
    {journalAction && <TradeJournalActionDialog {...journalAction} onClose={()=>setJournalAction(null)}/>}
  </>
}
