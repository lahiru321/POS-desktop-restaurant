/**
 * Client-side CSV export for dashboard tables that have no server-side export
 * endpoint (customers, suppliers, employees). Menu items use the backend
 * /products/export instead — see inventoryService.exportProducts.
 */

export type CsvColumn<T> = {
  header: string;
  /** Pull the cell value from a row. Return null/undefined for blanks. */
  value: (row: T) => string | number | null | undefined;
};

/** RFC-4180 cell escaping + a light guard against spreadsheet formula injection. */
function escapeCell(input: string | number | null | undefined): string {
  let s = input == null ? '' : String(input);
  // Neutralise a leading formula trigger (=) so a malicious value can't execute
  // when opened in Excel/Sheets. Phone numbers (+…) and negatives are left intact.
  if (s.startsWith('=')) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.value(row))).join(','))
    .join('\r\n');
  return `${header}\r\n${body}`;
}

/** Triggers a browser download of `rows` as a CSV named `<filenameBase>_<ts>.csv`. */
export function exportToCsv<T>(filenameBase: string, columns: CsvColumn<T>[], rows: T[]): void {
  const csv = buildCsv(columns, rows);
  // Prepend a BOM so Excel reads UTF-8 (accents, ₨/£ symbols) correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenameBase}_${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
