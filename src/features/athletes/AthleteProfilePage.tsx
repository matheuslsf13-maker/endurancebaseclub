import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { sexLabel } from '../../domain/categories';
import { Badge, Button, Card, Modal, Spinner, useConfirm, useToast } from '../../components/ui';
import { AthleteForm } from './AthleteForm';
import { StatsView } from './StatsView';
import { ageToday } from './athleteHelpers';

export default function AthleteProfilePage() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);

  const query = useQuery({
    queryKey: ['athlete-profile', athleteId],
    queryFn: () => api.admin.athleteProfile(athleteId as string),
    enabled: athleteId !== undefined,
  });

  async function handleDelete() {
    if (!query.data) return;
    const { athlete } = query.data;
    const ok = await confirm({
      title: 'Excluir atleta',
      message: `Excluir ${athlete.name}? Essa ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteAthlete(athlete.id);
      void queryClient.invalidateQueries({ queryKey: ['athletes'] });
      toast.show({ message: 'Atleta excluído.', tone: 'success' });
      navigate('/atletas');
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    }
  }

  function handleSaved() {
    setEditing(false);
    void queryClient.invalidateQueries({ queryKey: ['athlete-profile', athleteId] });
    void queryClient.invalidateQueries({ queryKey: ['athletes'] });
  }

  if (query.isLoading) {
    return (
      <div className="flex justify-center px-4 py-16">
        <Spinner size={32} />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12">
        <Card className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-danger">
            {query.error instanceof Error ? query.error.message : 'Atleta não encontrado'}
          </p>
          <Link to="/atletas" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
            Voltar para atletas
          </Link>
        </Card>
      </div>
    );
  }

  const { athlete, results } = query.data;
  const age = ageToday(athlete.birth_date);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link to="/atletas" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
        ← Atletas
      </Link>

      <Card className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="brand-title text-xl font-semibold">{athlete.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {sexLabel(athlete.sex)}
              {age !== null ? ` · ${age} anos` : ''}
              {athlete.city ? ` · ${athlete.city}` : ''}
              {athlete.team_club ? ` · ${athlete.team_club}` : ''}
            </p>
            {athlete.public_profile && (
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="info">Perfil público</Badge>
                <Link
                  to={`/atleta/${athlete.id}`}
                  className="text-sm text-fg underline underline-offset-2 hover:text-muted"
                >
                  Ver perfil público
                </Link>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()}>
              Excluir
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <StatsView athlete={athlete} results={results} />
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Editar atleta" size="lg">
        <AthleteForm initial={athlete} onSaved={handleSaved} onCancel={() => setEditing(false)} />
      </Modal>
    </div>
  );
}
