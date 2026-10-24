export const searchText = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').trim().replace(/\s+/g, ' ')
export const matchesSearch = (value, query) => searchText(query).split(' ').every(word => searchText(value).includes(word))
