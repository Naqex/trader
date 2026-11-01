import { useId, useMemo, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { matchesSearch } from './searchText.js'
import { tagAnalysis, tagCurves, tagColorValue } from './tagAnalysisModel.js'
import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import SearchInput from './SearchInput.jsx'
import ChartIcon from './ChartIcon.jsx'
import { AnalyticsCurve } from './AnalyticsCharts.jsx'
import { displayDate } from './dateFormat.js'

export default function LiveTagAnalytics({catalog,deals,currency,readable=true}) {
  const {t,fmt,timezone}=useTestingLocale(),id=useId()
  const [search,setSearch]=useState(''),[selected,setSelected]=useState([]),[hidden,setHidden]=useState(false)
  const [expanded,setExpanded]=useState(true),[openGroups,setOpenGroups]=useState(new Set()),sorting=useTableSort()
  const model=useMemo(()=>tagAnalysis(deals,catalog),[deals,catalog.items,catalog.groups])
  const selection=selected.filter(name=>model.tags.some(tag=>tag.name===name))
  const curve=useMemo(()=>tagCurves(model.tagged,selection),[model.tagged,JSON.stringify(selection)])
  const meta=[{label:t('Overall'),color:'var(--report-blue)'},...selection.map(name=>({label:name,color:tagColorValue(model.tags.find(tag=>tag.name===name)?.color)}))]
  const groupName=group=>group.name || t('Chưa phân nhóm')
  const toggle=name=>setSelected(current=>current.includes(name)?current.filter(value=>value!==name):[...current,name])
  const groupTags=group=>matchesSearch(groupName(group),search)?group.children:group.children.filter(tag=>matchesSearch(tag.name,search))
  const groups=catalog.status==='ready'?model.groups.filter(group=>groupTags(group).length):[]
  const sortRows=rows=>sorting.rows(rows,(row,key)=>key==='name'?row.name || t('Chưa phân nhóm'):row[key])
  const toggleGroup=id=>setOpenGroups(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})
  const expander=(name,open,onClick)=><button type="button" className="live-tag-expander" aria-label={t(open?'Thu gọn nhóm {name}':'Mở rộng nhóm {name}',{name})} aria-expanded={open} onClick={onClick}><ChartIcon name={open?'down':'collapse'}/></button>
  const cells=row=><><td>{fmt(row.count)}</td><td><span className={`live-tag-badge ${row.net<0?'is-red':'is-blue'}`}>{row.winRate===null?'N/A':fmt(row.winRate,'%')}</span></td><td>{row.net===null?'N/A':fmt(row.net,currency?` ${currency}`:'')}</td></>
  const tableRows=expanded?sortRows(groups).flatMap(group=>[{...group,kind:'group'},...(openGroups.has(group.id)?sortRows(groupTags(group)).map(tag=>({...tag,kind:'tag',groupNet:group.net})):[])]):[]
  return <section className="live-journal-tags" aria-label={t('Tag analytics')}>
    {readable && catalog.status==='error' && <p role="alert">{t('Không tải được nhãn.')}<button type="button" className="fxa-button" onClick={catalog.refresh}>{t('Thử lại')}</button></p>}
    {readable && catalog.status==='loading' && <p role="status">{t('Đang tải…')}</p>}
    {readable && <div className={`live-tag-analytics-grid${hidden?' is-picker-hidden':''}`}>
      <article className="live-tag-card live-tag-chart-card"><header><div><h2>{t('Cumulative PnL in selection')}</h2><small>{t('Over time')}</small></div><button type="button" className="live-tag-visibility" aria-controls={`${id}-picker`} aria-expanded={!hidden} onClick={()=>setHidden(value=>!value)}>{t(hidden?'Show tag list':'Hide tag list')}<ChartIcon name={hidden?'eye':'eye-off'}/></button></header>
        <div className="live-tag-legend"><i/>{t('Overall')}<button type="button" className="live-tag-info" aria-label={t('Tất cả giao dịch gắn nhãn khớp bộ lọc cơ bản.')} data-tooltip={t('Tất cả giao dịch gắn nhãn khớp bộ lọc cơ bản.')}><ChartIcon name="info" width={14} height={14}/></button></div>
        <AnalyticsCurve series={curve.series} seriesMeta={meta} timestamps={curve.timestamps} labels={curve.timestamps.map(time=>displayDate(time,{timeStyle:'short',timeZone:timezone}))} axisLabels={curve.timestamps.map(time=>displayDate(time,{timeZone:timezone}).slice(0,5))} label={t('Cumulative PnL in selection')} suffix={currency?` ${currency}`:''} height={300} controls showPoints={false} timeZone={timezone}/>
      </article>
      <aside id={`${id}-picker`} hidden={hidden} className="live-tag-card live-tag-picker-card" aria-label={t('Danh sách nhãn')}>
        <SearchInput aria-label={t('Tìm nhãn')} placeholder={t('Tìm nhãn…')} value={search} onChange={event=>setSearch(event.target.value)}/>
        {groups.map(group=><section key={group.id}><div className="live-tag-picker-heading"><strong>{groupName(group)}</strong><button type="button" aria-pressed={groupTags(group).every(tag=>selected.includes(tag.name))} onClick={()=>{const names=groupTags(group).map(tag=>tag.name);setSelected(current=>names.every(name=>current.includes(name))?current.filter(name=>!names.includes(name)):[...new Set([...current,...names])])}}>{t('Select all')}</button></div><div className="live-tag-picker-list">{groupTags(group).map(tag=><label key={tag.name}><input type="checkbox" checked={selection.includes(tag.name)} onChange={()=>toggle(tag.name)}/><span className="wm-trade-label" data-color={tag.color}>{tag.name}</span><i className="live-tag-color-dot" style={{background:tagColorValue(tag.color)}}/></label>)}</div></section>)}
        {catalog.status==='ready' && !groups.length && <p className="live-muted">{t(search?'Không tìm thấy nhãn.':'Chưa có nhãn')}</p>}
      </aside>
      <section className="live-tag-card live-tag-table-card"><DataTable className="live-tag-grid-table" label={t('Tag analytics')}><thead><tr><SortResetColumn active={sorting.sorts.length>0} onClear={sorting.clear}/>{[['name','Tag group'],['count','Trades'],['winRate','Win rate'],['net','Total PnL']].map(([key,label])=><SortableColumn key={key} {...sorting.columnProps(key,t(label))}>{t(label)}</SortableColumn>)}</tr></thead><tbody>
        <tr className="is-overall"><td className="wm-table-row-number">1</td><td>{expander(t('Overall'),expanded,()=>setExpanded(value=>!value))}{t('Overall')}</td>{cells(model.overall)}</tr>
        {tableRows.map((row,index)=><tr key={`${row.kind}:${row.id}`} className={`${row.kind==='group'?'is-group':'is-child'} ${(row.kind==='group'?row.net:row.groupNet)<0?'is-loss':(row.kind==='group'?row.net:row.groupNet)>0?'is-gain':''}`}><td className="wm-table-row-number">{index+2}</td><td>{row.kind==='group'?<>{expander(groupName(row),openGroups.has(row.id),()=>toggleGroup(row.id))}{groupName(row)}</>:<span className="wm-trade-label" data-color={row.color}>{row.name}</span>}</td>{cells(row)}</tr>)}
      </tbody></DataTable></section>
    </div>}
    {!readable && <div className="live-empty"><h2>{t('Chưa có phân tích nhãn')}</h2><p>{t('Thêm nhãn vào giao dịch để so sánh kết quả.')}</p></div>}
  </section>
}
