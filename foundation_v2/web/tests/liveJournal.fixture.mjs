// Synthetic ledger for production-build UI journeys. No broker, DB or credentials.
export const fixtureAccount = '00000000-0000-4000-8000-000000000002'
export const fixtureConnection = '00000000-0000-4000-8000-000000000001'
export function completedDealFills(rows) {
  return rows.flatMap((row, index) => {
    const close = { volume: .01, price: 1.1, ...row, position_id: index + 1, entry: 1 }
    return [{ ...close, ticket: 100000 + index, entry: 0, type: row.type === 0 ? 1 : 0, time_msc: row.time_msc - 1000, profit: 0, commission: 0, swap: 0, fee: 0 }, close]
  })
}
const stamp = '2026-10-22T12:00:00Z'
const record = (id,kind,payload) => ({record_id:id,revision:1,kind,payload,created_at_utc:stamp,updated_at_utc:stamp})
export const fixtureStrategies = [record('fixture-strategy','playbook',{name:'Synthetic breakout',status:'frozen'})]
export function journalRecords() {
  return [record(fixtureAccount,'account',{name:'SYNTHETIC JOURNAL',currency:'USD',opening_balance:'10000',account_type:'demo',opening_at_utc:'2026-10-01T00:00:00Z'}),
    ...Array.from({length:65},(_,i)=>record(`trade-${i}`,'trade',{
      account_id:fixtureAccount,symbol:i%2?'EURUSD':'GBPUSD',side:i%2?'BUY':'SELL',quantity:'0.01',
      opened_at_utc:`2026-10-${String(i%20+1).padStart(2,'0')}T10:00:00Z`,closed_at_utc:`2026-10-${String(i%20+1).padStart(2,'0')}T12:00:00Z`,
      entry_price:'1.10',exit_price:'1.11',gross_pnl:i%2?'10':'-5',commission:'-1',swap:'0',fee:'0',
      playbook_id:'fixture-strategy',playbook_revision:1,tags:[`Tag ${i%45}`],note:`Synthetic trade ${i}`})),
    ...Array.from({length:31},(_,i)=>record(`note-${i}`,'note',{
      title:`Synthetic note ${String(i).padStart(2,'0')}`,note:`Synthetic observation ${i}`,tags:[i%2?'London':'New York'],account_id:fixtureAccount,
      playbook_id:'fixture-strategy',playbook_revision:1}))]
}
export function brokerSnapshot() {
  return {status:'ready',source:'SYNTHETIC MT5',connection_id:fixtureConnection,captured_at_utc:stamp,
    history_from_utc:'2026-10-01T00:00:00Z',account:{account_ref:'…0111',currency:'USD',balance:10000,equity:10002,margin:20,margin_free:9982},
    deals:Array.from({length:65},(_,i)=>({ticket:i+1,position_id:100+i,symbol:'EURUSD',type:i%2,entry:1,time_msc:Date.parse(`2026-10-${String(i%20+1).padStart(2,'0')}T12:00:00Z`),
      volume:0.01,price:1.1,profit:i%2?10:-5,commission:-1,swap:0,fee:0})),cashflows:[],positions:[],orders:[],quotes:[],
    connections:[{id:fixtureConnection,name:'SYNTHETIC MT5',login_hint:'…0111',status:'connected',requested_mode:'trading',last_synced_at:new Date().toISOString(),account:{currency:'USD',balance:10000}}]}
}
