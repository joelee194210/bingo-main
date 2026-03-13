export interface ExportColumn {
  key: string;
  label: string;
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function buildRows(data: Record<string, unknown>[], columns: ExportColumn[]): string[][] {
  const header = columns.map(c => c.label);
  const rows = data.map(item =>
    columns.map(c => {
      const val = getNestedValue(item, c.key);
      if (val === null || val === undefined) return '';
      if (typeof val === 'boolean') return val ? 'Si' : 'No';
      return String(val);
    })
  );
  return [header, ...rows];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportToCSV(data: Record<string, unknown>[], columns: ExportColumn[], filename: string) {
  const rows = buildRows(data, columns);
  const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

export async function exportToExcel(data: Record<string, unknown>[], columns: ExportColumn[], filename: string) {
  const XLSX = await import('xlsx');
  const rows = buildRows(data, columns);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = columns.map((_, i) => ({
    wch: Math.max(
      columns[i].label.length,
      ...rows.slice(1).map(r => (r[i] || '').length)
    ) + 2,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToJSON(data: Record<string, unknown>[], filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${filename}.json`);
}
