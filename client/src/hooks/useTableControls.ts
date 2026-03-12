import { useState, useMemo } from 'react';

export interface SortState {
  column: string | null;
  direction: 'asc' | 'desc' | null;
}

export interface TableControls<T> {
  // Search
  search: string;
  setSearch: (value: string) => void;
  // Sort
  sort: SortState;
  toggleSort: (column: string) => void;
  // Pagination
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  setPageSize: (size: number) => void;
  totalPages: number;
  totalFiltered: number;
  from: number;
  to: number;
  // Data
  paginatedData: T[];
  allFilteredData: T[];
}

export function useTableControls<T extends Record<string, unknown>>(
  data: T[],
  searchFields: string[],
  defaultPageSize = 25,
): TableControls<T> {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setPage(1);
  };

  const toggleSort = (column: string) => {
    setSort(prev => {
      if (prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return { column: null, direction: null };
    });
  };

  // Filter
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(item =>
      searchFields.some(field => {
        const val = field.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), item as Record<string, unknown>);
        return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, search, searchFields]);

  // Sort
  const sortedData = useMemo(() => {
    if (!sort.column || !sort.direction) return filteredData;
    const col = sort.column;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...filteredData].sort((a, b) => {
      const aVal = col.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), a as Record<string, unknown>);
      const bVal = col.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), b as Record<string, unknown>);
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
      return String(aVal).localeCompare(String(bVal)) * dir;
    });
  }, [filteredData, sort]);

  // Pagination
  const totalFiltered = sortedData.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, totalFiltered);
  const paginatedData = sortedData.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    search, setSearch,
    sort, toggleSort,
    page: safePage, setPage, pageSize, setPageSize,
    totalPages, totalFiltered, from, to,
    paginatedData,
    allFilteredData: sortedData,
  };
}
