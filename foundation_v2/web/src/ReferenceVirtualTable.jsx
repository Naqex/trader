import { useMemo, useRef, useState } from 'react'
import DataTable, { SortableColumn } from './DataTable.jsx'
import VirtualTableBody from './VirtualTableBody.jsx'
import SearchInput from './SearchInput.jsx'

const getRowKey = row => row.id

export default function ReferenceVirtualTable() {
  const viewport = useRef(null), [descending, setDescending] = useState(false), [selected, setSelected] = useState(new Set()), [search, setSearch] = useState('')
  const samples = useMemo(() => Array.from({ length:10000 }, (_, index) => ({ id:`sample-${index + 1}`, name:`Dòng ${String(index + 1).padStart(5, '0')}`, value:index === 2 ? null : index - 5000 })), [])
  const rows = useMemo(() => {
    const filtered = samples.filter(row => row.name.includes(search.trim()))
    return descending ? filtered.toReversed() : filtered
  }, [samples, search, descending])
  const columns = [
    { key:'name', render:row => row.name },
    { key:'group', render:() => 'Dữ liệu minh hoạ' },
    { key:'value', className:'is-numeric', render:row => row.value === null ? 'N/A' : row.value },
    { key:'description', render:() => 'Nội dung dài giữ một dòng, không làm thay đổi chiều cao hoặc chiều rộng của cột.' },
    { key:'source', render:row => row.id },
    { key:'action', className:'is-center', render:row => <button type="button" className="wm-button" aria-pressed={selected.has(row.id)} aria-label={`Chọn ${row.name}`} onClick={() => setSelected(current => { const next = new Set(current); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next })}>Chọn</button> },
  ]
  const changeSort = () => { setDescending(value => !value); viewport.current.scrollTop = 0 }
  return <section id="virtual-table"><h2>Bảng dài và cuộn hai chiều</h2>
    <p>10.000 dòng minh hoạ, chỉ dựng các dòng gần vùng xem. Chiều cao dòng cố định; bảng Giao dịch vẫn phân trang tại server.</p>
    <div className="wm-reference-controls">
      <SearchInput aria-label="Tìm dòng trong bảng dài" value={search} onChange={event => { setSearch(event.target.value); viewport.current.scrollTop = 0 }} />
      <button type="button" className="wm-button" onClick={() => { viewport.current.scrollTop = 0 }}>Đầu bảng</button>
      <button type="button" className="wm-button" onClick={() => { viewport.current.scrollTop = viewport.current.scrollHeight }}>Cuối bảng</button>
      <span role="status">{rows.length} dòng · {selected.size} đã chọn</span>
    </div>
    <DataTable contained viewportRef={viewport} label="Bảng dài minh hoạ, cuộn ngang và dọc" style={{ height:360 }} tableProps={{ style:{ tableLayout:'fixed', minWidth:2000 }, 'aria-rowcount':rows.length + 1 }}>
      <colgroup>{[260,240,180,680,360,280].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead><tr><SortableColumn active direction={descending ? 'desc' : 'asc'} onSort={changeSort}>Tên dòng</SortableColumn><th scope="col">Nhóm</th><th scope="col" className="is-numeric">Giá trị</th><th scope="col">Mô tả</th><th scope="col">Nguồn</th><th scope="col" className="is-center">Thao tác</th></tr></thead>
      {rows.length ? <VirtualTableBody rows={rows} columns={columns} getRowKey={getRowKey} viewportRef={viewport} getRowProps={row => ({ 'aria-selected':selected.has(row.id) })} /> : <tbody><tr><td colSpan={6}>Không có kết quả phù hợp.</td></tr></tbody>}
    </DataTable>
  </section>
}
