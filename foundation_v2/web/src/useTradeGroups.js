import {useEffect,useRef,useState} from 'react'
import {scopedMutation} from './scopedMutation.js'

const path='/api/v2/trade-groups'
const errors={group_same_account_required:'Các giao dịch phải cùng tài khoản hoặc cùng phiên.',group_same_symbol_required:'Các giao dịch phải cùng tài sản.',group_same_side_required:'Các giao dịch phải cùng hướng lệnh.',group_requires_closed_trades:'Chỉ gộp các giao dịch đã đóng và có đủ lịch sử.',group_trade_incomplete:'Chưa có đầy đủ lịch sử giao dịch.',group_trade_not_found:'Giao dịch không còn trong dữ liệu nguồn. Tải lại rồi chọn lại.',group_revision_conflict:'Danh sách nhóm đã thay đổi. Tải lại rồi mở lại thao tác.',group_member_already_grouped:'Giao dịch đã thuộc nhóm gộp. Tải lại rồi chọn lại.'}
function decode(data){
  if(data.version!=='trade-groups-v1' || !Number.isInteger(data.revision) || !Array.isArray(data.items) || data.items.some(group=>typeof group.id!=='string'||!Array.isArray(group.members)||group.members.length<2))throw new Error('Dữ liệu nhóm giao dịch không hợp lệ.')
  return data
}
export default function useTradeGroups(workspace,enabled=true){
  const [state,setState]=useState({workspace:null,status:'loading',revision:0,items:[],error:''}),[reload,setReload]=useState(0)
  const current=useRef(workspace);current.current=workspace
  useEffect(()=>{
    if(!workspace||!enabled)return
    const controller=new AbortController()
    setState(previous=>({...(previous.workspace===workspace?previous:{items:[],revision:0}),workspace,status:'loading',error:''}))
    fetch(path,{headers:{'X-Workspace-Id':workspace},signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Không đọc được nhóm giao dịch.');return decode(await response.json())}).then(data=>setState({workspace,status:'ready',...data,error:''})).catch(error=>{if(!controller.signal.aborted)setState({workspace,status:'error',revision:0,items:[],error:error.message})})
    return()=>controller.abort()
  },[workspace,enabled,reload])
  const refresh=()=>setReload(value=>value+1)
  const mutate=async change=>{
    const owner=workspace
    const response=await scopedMutation(path,owner,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:state.revision,...change})})
    const data=await response.json()
    if(!response.ok){const error=new Error(errors[data.detail]||'Không lưu được nhóm giao dịch. Thử lại sau.');error.conflict=response.status===409;if(error.conflict&&current.current===owner)refresh();throw error}
    const next=decode(data)
    if(current.current===owner)setState({workspace:owner,status:'ready',...next,error:''})
    return next
  }
  return {...(state.workspace===workspace?state:{status:'loading',revision:0,items:[],error:''}),refresh,mutate}
}
