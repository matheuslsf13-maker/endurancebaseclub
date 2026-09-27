import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { parseCsv } from '../../lib/csv';
import { readXlsxFirstSheet } from '../../lib/xlsx/reader';
import { mapImportRows } from '../../lib/importMapping';
import type { MappedImport } from '../../lib/importMapping';
import { formatDateBR } from '../../lib/format';
import { sexLabel } from '../../domain/categories';
import { Button, EmptyState, Modal, Select, Table } from '../../components/ui';
import type { ImportResult } from '../../lib/types';

export interface ImportDialogProps {
  open: boolean;
  onClose(): void;
  /** Called once `admin_import_athletes` succeeds, so the caller can refresh its athlete list. */
  onImported(): void;
}

const TEMPLATE_HEADER = 'Nome;Sexo;Data de nascimento;E-mail;Telefone;Cidade;Equipe;Prova';
const PREVIEW_LIMIT = 20;

/** Reads a spreadsheet File into a raw string table. `.xlsx` goes through the XLSX reader;
 * anything else is read as CSV, decoded UTF-8 first and re-decoded as Windows-1252 (the common
 * Brazilian-Excel export encoding) when the UTF-8 pass leaves replacement characters behind. */
async function readTable(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    return readXlsxFirstSheet(new Uint8Array(buf));
  }
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const text = utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
  return parseCsv(text);
}

export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapped, setMapped] = useState<MappedImport | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [eventId, setEventId] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const eventsQuery = useQuery({ queryKey: ['events', 'summary'], queryFn: () => api.admin.listEvents(), enabled: open });

  // Start clean every time the dialog opens, so a previous import's preview/result never bleeds
  // into the next one.
  useEffect(() => {
    if (!open) return;
    setFileName(null);
    setMapped(null);
    setReadError(null);
    setEventId('');
    setResult(null);
    setImportError(null);
  }, [open]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-selected later (e.g. after fixing it)
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setImportError(null);
    try {
      const table = await readTable(file);
      setMapped(mapImportRows(table));
      setReadError(null);
    } catch {
      setMapped(null);
      setReadError('Não foi possível ler o arquivo. Verifique se é uma planilha .csv ou .xlsx válida.');
    }
  }

  async function handleConfirm() {
    if (!mapped || mapped.rows.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await api.admin.importAthletes(eventId || null, mapped.rows);
      setResult(res);
      onImported();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Erro inesperado');
    } finally {
      setImporting(false);
    }
  }

  const eventOptions = [
    { value: '', label: 'Nenhum — só cadastrar atletas' },
    ...(eventsQuery.data ?? []).map((ev) => ({ value: ev.id, label: ev.name })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar atletas"
      size="xl"
      footer={
        result ? (
          <Button onClick={onClose}>Fechar</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => void handleConfirm()}
              loading={importing}
              disabled={!mapped || mapped.rows.length === 0}
              data-testid="import-confirm"
            >
              Confirmar importação
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Planilha com colunas Nome, Sexo, Data de nascimento, E-mail, Telefone, Cidade, Equipe e Prova. Quando o
          nome da coluna Prova bater com uma prova individual do evento escolhido abaixo, o atleta já entra inscrito.
        </p>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(`${TEMPLATE_HEADER}\r\n`)}`}
          download="modelo-atletas.csv"
          className="self-start text-sm text-fg underline underline-offset-2 hover:text-muted"
        >
          Baixar modelo
        </a>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="import-file-input" className="text-sm font-medium text-fg">
            Arquivo (.csv ou .xlsx)
          </label>
          <input
            id="import-file-input"
            type="file"
            accept=".csv,.xlsx"
            data-testid="import-file"
            onChange={(e) => void handleFile(e)}
            className="text-sm text-fg"
          />
        </div>

        {!result && (
          <Select
            label="Inscrever na prova da coluna Prova do evento"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            options={eventOptions}
          />
        )}

        {readError && (
          <p role="alert" className="text-sm text-danger">
            {readError}
          </p>
        )}

        {result ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-fg">
              {result.inserted} novos, {result.updated} atualizados, {result.entries_created} inscrições
            </p>
            {result.errors.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-danger">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Linha {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          mapped && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg">
                {fileName} — {mapped.rows.length} atleta(s) válido(s), {mapped.errors.length} erro(s)
              </p>
              {mapped.errors.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-danger">
                  {mapped.errors.map((e, i) => (
                    <li key={i}>
                      Linha {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {mapped.rows.length === 0 ? (
                <EmptyState title="Nenhuma linha válida para importar" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th className="px-3 py-2" scope="col">Nome</th>
                      <th className="px-3 py-2" scope="col">Sexo</th>
                      <th className="px-3 py-2" scope="col">Nascimento</th>
                      <th className="px-3 py-2" scope="col">E-mail</th>
                      <th className="px-3 py-2" scope="col">Telefone</th>
                      <th className="px-3 py-2" scope="col">Cidade</th>
                      <th className="px-3 py-2" scope="col">Equipe</th>
                      <th className="px-3 py-2" scope="col">Prova</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapped.rows.slice(0, PREVIEW_LIMIT).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2">{sexLabel(r.sex)}</td>
                        <td className="px-3 py-2 tabular">{r.birth_date ? formatDateBR(r.birth_date) : ''}</td>
                        <td className="px-3 py-2">{r.email ?? ''}</td>
                        <td className="px-3 py-2">{r.phone ?? ''}</td>
                        <td className="px-3 py-2">{r.city ?? ''}</td>
                        <td className="px-3 py-2">{r.team_club ?? ''}</td>
                        <td className="px-3 py-2">{r.race_name ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )
        )}

        {importError && (
          <p role="alert" className="text-sm text-danger">
            {importError}
          </p>
        )}
      </div>
    </Modal>
  );
}
