// Keep successful removals out of retries. An ambiguous write stops the batch
// until a fresh read can establish which accounts still exist.
export async function removeLiveAccounts(rows, remove, onRemoved) {
  const failures=[], remaining=[]
  for(let index=0;index<rows.length;index++) {
    const row=rows[index]
    try { await remove(row) }
    catch(error) {
      failures.push({row,error});remaining.push(row)
      if(error.uncertain || error.outcomeKnown===false) return {failures,remaining:[...remaining,...rows.slice(index+1)],uncertain:true}
      continue
    }
    onRemoved(row)
  }
  return {failures,remaining,uncertain:false}
}
