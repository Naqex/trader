import { noteDocument } from './noteDocument.js'

const heading = content => ({type:'heading',props:{level:2},content})
const bullet = content => ({type:'bulletListItem',content})
export const TEMPLATE_CONTEXTS=['testing-trades','live-trades','live-notes']

export function builtinNoteTemplates(language='en') {
  const vi=language==='vi', text=(a,b)=>vi?a:b
  const goal=[heading(text('MỤC TIÊU / TRỌNG TÂM','GOAL/FOCUS')),bullet(text('Mục tiêu / trọng tâm của bạn trong tuần này là gì?','What is your goal/focus for this week?')),bullet(text('Viết tại đây','Write here'))]
  const reminders=[heading(text('NHẮC NHỞ','REMINDERS')),bullet(text('Một giao dịch tốt','One Good Trade')),bullet(text('Tập trung vào diễn biến giá hiện tại','Be Present with Price')),bullet(text('Tư duy theo quy trình','Process Oriented Thinking'))]
  const items=[
    {id:'beginner',name:text('Người mới bắt đầu','Beginner'),blocks:[...goal,...reminders]},
    {id:'daily-report',name:text('Báo cáo hằng ngày','Daily report card'),blocks:[
      heading(text('MỤC TIÊU / TRỌNG TÂM','GOAL/FOCUS')),
      bullet(text('Mục tiêu / trọng tâm của bạn trong tuần này là gì? (tăng khối lượng, chỉ giao dịch thiết lập A+, v.v.)','What is your goal/focus for this week? (increase sizing, A+ only, etc...)')),
      bullet(text('Viết tại đây','Write here')),...reminders,
      heading(text('TIN TỨC','NEWS')),bullet(text('Viết tại đây','Write here')),
      heading(text('CÁC CẶP ĐANG THEO DÕI','IN-PLAY PAIRS')),
      bullet(text('Cặp nào đang có thiết lập rõ ràng nhất? Chúng ta tập trung vào đâu?','Which pairs are offering the cleanest setups? Where is our focus?')),bullet(text('Viết tại đây','Write here')),
      heading(text('SAU PHIÊN GIAO DỊCH','POST-SESSION')),
      bullet(text('Xem lại ghi chú trong ngày và so sánh phân tích của bạn với diễn biến thực tế.','Review intraday notes and compare your analysis with what actually happened')),bullet(text('Viết tại đây','Write here')),
    ]},
  ]
  return items.map(item=>({...item,builtin:true,document:noteDocument(item.blocks)}))
}
