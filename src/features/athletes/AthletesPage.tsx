import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { ageOn } from '../../domain/categories';
import { Button, Card, EmptyState, Input, Modal, Select, Spinner, Table, useConfirm, useToast } from '../../components/ui';
import type { AthleteRow } from '../../lib/types';
import { AthleteForm } from './AthleteForm';
import { ImportDialog } from './ImportDialog';

const TZ = 'America/Sao_Paulo';

/** Today's date, in Brasília, as 'aaaa-mm-dd' — the app-wide rule that every date is shown in
 * America/Sao_Paulo applies here too, even though "idade hoje" has nothing to do with an event. */
function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function ageToday(birthDate: string | null): number | null {
  return birthDate ? ageOn(birthDate, todayIsoBrasilia(), 'event_date') : null;
}

function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const SEX_FILTER_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'M', label: 'Masculino' },
  { value: 'F', label: 'Feminino' },
];

type ModalState = 'new' | AthleteRow | null;

export default function AthletesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const query = useQuery({ queryKey: ['athletes'], queryFn: () => api.admin.listAthletes() });

  const [search, setSearch] = useState('');
  const [sexFilter, setSexFilter] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [importOpen, setImportOpen] = useState(false);

  const athletes = query.data ?? [];
  const filtered = useMemo(() => {
    const term = foldAccents(search.trim());
    return athletes.filter((a) => {
      if (sexFilter && a.sex !== sexFilter) return false;
      if (!term) return true;
      const haystack = foldAccents(`${a.name} ${a.city ?? ''} ${a.team_club ?? ''}`);
      return haystack.includes(term);
    });
  }, [athletes, search, sexFilter]);

  function refreshList() {
    return queryClient.invalidateQueries({ queryKey: ['athletes'] });
  }

  function handleSaved() {
    setModal(null);
    void refreshList();
  }

  async function handleDelete(a: AthleteRow) {
    const ok = await confirm({
      title: 'Excluir atleta',
      message: `Excluir ${a.name}? Essa ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteAthlete(a.id);
      toast.show({ message: 'Atleta excluído.', tone: 'success' });
      void refreshList();
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="brand-title text-xl font-semibold">Atletas</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)} data-testid="import-athletes">
            Importar planilha
          </Button>
          <Button onClick={() => setModal('new')} data-testid="new-athlete">
            Novo atleta
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Input
          label="Buscar"
          placeholder="Nome, cidade ou equipe"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="athlete-search"
        />
        <Select label="Sexo" value={sexFilter} onChange={(e) => setSexFilter(e.target.value)} options={SEX_FILTER_OPTIONS} />
      </div>

      <div className="mt-4">
        {query.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : query.error ? (
          <Card>
            <p role="alert" className="text-sm text-danger">
              {query.error instanceof Error ? query.error.message : 'Erro inesperado'}
            </p>
          </Card>
        ) : filtered.length === 0 ? (
          <EmptyState title="Nenhum atleta encontrado" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="px-3 py-2" scope="col">Nome</th>
                <th className="px-3 py-2" scope="col">Sexo</th>
                <th className="px-3 py-2" scope="col">Idade hoje</th>
                <th className="px-3 py-2" scope="col">Cidade</th>
                <th className="px-3 py-2" scope="col">Equipe</th>
                <th className="px-3 py-2" scope="col">Participações</th>
                <th className="px-3 py-2" scope="col">Vitórias</th>
                <th className="px-3 py-2" scope="col">Pódios</th>
                <th className="px-3 py-2" scope="col" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link to={`/atletas/${a.id}`} className="text-fg underline underline-offset-2 hover:text-muted">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{a.sex}</td>
                  <td className="px-3 py-2 tabular">{ageToday(a.birth_date) ?? '—'}</td>
                  <td className="px-3 py-2">{a.city ?? '—'}</td>
                  <td className="px-3 py-2">{a.team_club ?? '—'}</td>
                  <td className="px-3 py-2 tabular">{a.participations ?? 0}</td>
                  <td className="px-3 py-2 tabular">{a.wins ?? 0}</td>
                  <td className="px-3 py-2 tabular">{a.podiums ?? 0}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setModal(a)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleDelete(a)}>
                        Excluir
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === 'new' ? 'Novo atleta' : 'Editar atleta'} size="lg">
        {modal !== null && (
          <AthleteForm initial={modal === 'new' ? undefined : modal} onSaved={handleSaved} onCancel={() => setModal(null)} />
        )}
      </Modal>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => void refreshList()} />
    </div>
  );
}
