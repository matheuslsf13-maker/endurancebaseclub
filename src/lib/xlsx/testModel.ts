// Shared fixture for writer.test.ts and reader.test.ts (Ruling 3: not exported from a *.test.ts file).
import type { WorkbookModel } from './writer';

export const sampleModel: WorkbookModel = { sheets: [
  { name: 'Tempos – Corrida 5K', freezeHeader: true,
    columns: [{ header: 'Nº' }, { header: 'Atleta', width: 30 }, { header: 'Largada', style: 'time' }, { header: 'Chegada', style: 'time' }, { header: 'Tempo', style: 'duration' }],
    rows: [['101', 'Ana & Bia <3>', 46306.4583, 46306.4722, { formula: 'D2-C2', result: 0.0139 }], [null, true, 1, 2, { v: 'Total', s: 'bold' }]] },
  { name: 'Tempos – Corrida 5K', columns: [{ header: 'x' }], rows: [] },
] };
