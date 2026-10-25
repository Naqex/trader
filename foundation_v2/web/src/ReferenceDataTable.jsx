import { useState } from 'react'
import DataTable, { SortableColumn } from './DataTable.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import FxSelect from './FxSelect.jsx'
import SearchInput from './SearchInput.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { matchesSearch } from './searchText.js'
import { compareTableValues, nextTableSort } from './tableModel.js'

const samples=Array.from({length:35},(_,i)=>({id:i,name:`Mẫu ${String(i+1).padStart(2,'0')}`,group:i===34?'Nhóm B':'Nhóm A',value:i===2?null:(i-10)*20}))

export default function ReferenceDataTable() {
  const [state,setState]=useState('ready'),[search,setSearch]=useState(''),[groups,setGroups]=useState([]),[sort,setSort]=useState({key:'name',direction:'asc'}),[page,setPage]=useState(1),[size,setSize]=useState(10)
  const rows=(state==='empty'?[]:samples).filter(row=>(!groups.length||groups.includes(row.group))&&matchesSearch(row.name,search)).sort((a,b)=>compareTableValues(a[sort.key],b[sort.key],sort.direction)||a.id-b.id)
  const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages),pending=state==='loading'
  return <section id="data-table"><h2>Bảng dữ liệu</h2><p>Dữ liệu minh hoạ · 35 dòng. Nhóm B nằm ở trang cuối khi chưa lọc.</p>
    <div className="wm-reference-control-row">
      <SearchInput aria-label="Tìm trong bảng minh hoạ" placeholder="Tìm mẫu…" value={search} onChange={event=>{setSearch(event.target.value);setPage(1)}} />
      <FxSelect multiple searchable label="Nhóm minh hoạ" value={groups} onChange={value=>{setGroups(value);setPage(1)}} options={['Nhóm A','Nhóm B'].map(value=>({value,label:value}))} />
      <FxSelect label="Trạng thái bảng minh hoạ" value={state} onChange={value=>{setState(value);setPage(1)}} options={['ready','loading','empty','error','stale','unknown'].map(value=>({value,label:value}))} />
    </div>
    {state==='error'?<TestingReadState error message="Không tải được bảng minh hoạ." onRetry={()=>setState('ready')} />:<>
      {state==='stale'&&<TestingReadState message="Dữ liệu minh hoạ có thể đã cũ." />}
      <DataTable label="Bảng dữ liệu minh hoạ" style={{maxHeight:300}} aria-busy={pending}>
        <thead><tr>{[['name','Tên'],['group','Nhóm'],['value','Giá trị']].map(([key,label])=><SortableColumn key={key} className={key==='value'?'is-numeric':undefined} active={sort.key===key} direction={sort.direction} disabled={pending} onSort={()=>{setSort(nextTableSort(sort,key));setPage(1)}}>{label}</SortableColumn>)}</tr></thead>
        <tbody>{pending?<tr><td colSpan={3}><TestingSkeleton rows={3} /></td></tr>:rows.length?rows.slice((current-1)*size,current*size).map(row=><tr key={row.id}><td>{row.name}</td><td>{row.group}</td><td className="is-numeric">{state==='unknown'||row.value===null?'-':row.value}</td></tr>):<tr><td colSpan={3}>Không có kết quả phù hợp.</td></tr>}</tbody>
      </DataTable>
      <PaginationFooter label="Trang bảng minh hoạ" page={current} pages={pages} pageSize={size} totalCount={rows.length} pending={pending} unknown={state==='unknown'} onPageChange={setPage} onPageSizeChange={value=>{setSize(value);setPage(1)}} />
    </>}
  </section>
}
