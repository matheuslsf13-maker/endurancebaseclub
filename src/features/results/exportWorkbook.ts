import { buildEventWorkbook, workbookFileName } from '../../domain/workbook';
import type { EventTiming } from '../../domain/consolidation';
import type { RaceClassification } from '../../domain/ranking';
import { writeXlsx } from '../../lib/xlsx/writer';
import type { EventAggregate } from '../../lib/types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Builds the whole event's "planilha de conferência" (spec §11) and downloads it as
 * `workbookFileName(agg.event)` through a temporary `<a download>`, then revokes the object URL
 * (Controller Ruling: exact filename, exact MIME, revoke after the click).
 */
export function exportWorkbook(agg: EventAggregate, timing: EventTiming, classifications: RaceClassification[]): void {
  const model = buildEventWorkbook(agg, timing, classifications, Date.now());
  const bytes = writeXlsx(model);
  // `Blob`'s DOM typings want a plain `ArrayBuffer` `BlobPart`, not `Uint8Array<ArrayBufferLike>`
  // (TS 5.7's stricter typed-array generics) — slice into a fresh, exactly-sized `ArrayBuffer`.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = workbookFileName(agg.event);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
