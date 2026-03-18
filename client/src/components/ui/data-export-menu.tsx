import { Download, FileSpreadsheet, FileJson, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exportToCSV, exportToExcel, exportToJSON, type ExportColumn } from '@/lib/export-utils';

interface DataExportMenuProps {
  data: Record<string, unknown>[];
  columns: ExportColumn[];
  filename: string;
  /** Si se provee, se llama para obtener TODOS los datos antes de exportar (útil con paginación) */
  onFetchAll?: () => Promise<Record<string, unknown>[]>;
}

export function DataExportMenu({ data, columns, filename, onFetchAll }: DataExportMenuProps) {
  if (!data.length && !onFetchAll) return null;

  const getData = async () => {
    if (onFetchAll) return onFetchAll();
    return data;
  };

  const handleExport = async (format: 'csv' | 'excel' | 'json') => {
    const allData = await getData();
    if (format === 'csv') exportToCSV(allData, columns, filename);
    else if (format === 'excel') exportToExcel(allData, columns, filename);
    else exportToJSON(allData, filename);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('csv')}>
          <FileText className="h-4 w-4 mr-2" />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('excel')}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Excel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('json')}>
          <FileJson className="h-4 w-4 mr-2" />
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
