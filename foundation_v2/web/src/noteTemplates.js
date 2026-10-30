const paragraph = text => ({ type:'paragraph', content:text })
const heading = text => ({ type:'heading', props:{level:2}, content:text })
const bullet = text => ({ type:'bulletListItem', content:text })

// Starter content; the template catalog UI does not write a shared library yet.
export const NOTE_TEMPLATES = [
  {id:'beginner',name:'Beginner',blocks:[
    heading('GOAL/FOCUS'),bullet('What is your goal/focus for this week?'),bullet('Write here'),
    heading('REMINDERS'),bullet('One Good Trade'),bullet('Be Present with Price'),bullet('Process Oriented Thinking'),
  ]},
  {id:'daily-report',name:'Daily report card',blocks:[
    heading('KẾ HOẠCH TRONG NGÀY'),paragraph('Tài sản, phiên giao dịch và điều kiện vào lệnh:'),
    heading('ĐÁNH GIÁ GIAO DỊCH'),{type:'checkListItem',props:{checked:false},content:'Tuân thủ kế hoạch và mức rủi ro đã đặt'},
    paragraph('Điều đã làm tốt:'),paragraph('Điều cần cải thiện:'),heading('BÀI HỌC'),paragraph('Một việc sẽ làm khác ở phiên tiếp theo:'),
  ]},
]
