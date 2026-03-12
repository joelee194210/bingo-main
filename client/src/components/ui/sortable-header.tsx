import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { SortState } from '@/hooks/useTableControls';

interface SortableHeaderProps {
  label: string;
  column: string;
  sort: SortState;
  onSort: (column: string) => void;
}

export function SortableHeader({ label, column, sort, onSort }: SortableHeaderProps) {
  return (
    <button
      onClick={() => onSort(column)}
      className="flex items-center gap-1 hover:text-foreground transition-colors font-medium"
    >
      {label}
      {sort.column === column ? (
        sort.direction === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/40" />
      )}
    </button>
  );
}
