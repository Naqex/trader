import { useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { nextTableSorts, sortTableRows } from './tableModel.js'

export default function useTableSort(onChange) {
  const { t, locale } = useTestingLocale()
  const [sorts, setState] = useState([])
  const setSorts = value => { setState(value); onChange?.() }
  const clear = () => setSorts([])
  const columnProps = (key, label) => {
    const index = sorts.findIndex(sort => sort.key === key), sort = sorts[index]
    return {
      active:Boolean(sort), direction:sort?.direction, priority:index + 1,
      onSort:() => setSorts(nextTableSorts(sorts, key)),
      onClear:() => setSorts(sorts.filter(sort => sort.key !== key)),
      clearLabel:t('Bỏ sắp xếp: {column}', { column:label }),
      sortLabel:sort ? t('{column}, ưu tiên {priority}, {direction}. Nhấn để đổi chiều.', { column:label, priority:index + 1, direction:t(sort.direction === 'asc' ? 'tăng dần' : 'giảm dần') }) : t('Thêm sắp xếp: {column}', { column:label }),
    }
  }
  return { sorts, setSorts, clear, columnProps, rows:(rows, valueOf, defaults = []) => sortTableRows(rows, sorts.length ? sorts : defaults, valueOf, locale) }
}
