import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { formatDateBR, parseDateInput } from '../../lib/format';
import { Button, Checkbox, Input, Select, Textarea } from '../../components/ui';
import type { AthleteRow, Sex } from '../../lib/types';

export interface AthleteFormProps {
  /** Present when editing: pre-fills the fields and makes the save an update of this athlete. */
  initial?: AthleteRow;
  /** Called with the row `admin_save_athlete` returned once the save succeeds. */
  onSaved(a: AthleteRow): void;
  onCancel(): void;
}

const SEX_OPTIONS = [
  { value: 'M', label: 'Masculino' },
  { value: 'F', label: 'Feminino' },
];

/** Athlete create/edit form. Owns its own save (calls `api.admin.saveAthlete` itself and reports
 * the saved row through `onSaved`) so it can be dropped in as-is by the entries form (Task 21) to
 * create an athlete on the fly, without that caller needing to know about the mutation. */
export function AthleteForm({ initial, onSaved, onCancel }: AthleteFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'M');
  const [birthText, setBirthText] = useState(initial?.birth_date ? formatDateBR(initial.birth_date) : '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [teamClub, setTeamClub] = useState(initial?.team_club ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [publicProfile, setPublicProfile] = useState(initial?.public_profile ?? true);

  const [nameError, setNameError] = useState<string | undefined>();
  const [birthError, setBirthError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmedName = name.trim();
    const hasNameError = trimmedName === '';

    let birthDate: string | null = null;
    let hasBirthError = false;
    const trimmedBirth = birthText.trim();
    if (trimmedBirth !== '') {
      birthDate = parseDateInput(trimmedBirth);
      hasBirthError = birthDate === null;
    }

    setNameError(hasNameError ? 'Nome é obrigatório' : undefined);
    setBirthError(hasBirthError ? 'Data inválida — use dd/mm/aaaa' : undefined);
    if (hasNameError || hasBirthError) return;

    setSaving(true);
    setFormError(null);
    try {
      const saved = await api.admin.saveAthlete({
        id: initial?.id,
        name: trimmedName,
        sex,
        birth_date: birthDate,
        email: email.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
        team_club: teamClub.trim() || null,
        notes: notes.trim(),
        public_profile: publicProfile,
      });
      onSaved(saved);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erro inesperado');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <Input
        label="Nome"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="athlete-name"
        error={nameError}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Sexo"
          value={sex}
          onChange={(e) => setSex(e.target.value as Sex)}
          options={SEX_OPTIONS}
          data-testid="athlete-sex"
        />
        <Input
          label="Data de nascimento"
          placeholder="dd/mm/aaaa"
          inputMode="numeric"
          value={birthText}
          onChange={(e) => setBirthText(e.target.value)}
          data-testid="athlete-birth"
          error={birthError}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="E-mail" type="email" value={email ?? ''} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Telefone" type="tel" value={phone ?? ''} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Cidade" value={city ?? ''} onChange={(e) => setCity(e.target.value)} />
        <Input label="Equipe / assessoria" value={teamClub ?? ''} onChange={(e) => setTeamClub(e.target.value)} />
      </div>
      <Textarea label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Checkbox
        label="Perfil público"
        hint="Aparece nos resultados públicos do clube, sem e-mail, telefone ou data de nascimento."
        checked={publicProfile}
        onChange={(e) => setPublicProfile(e.target.checked)}
      />
      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving} data-testid="athlete-save">
          Salvar
        </Button>
      </div>
    </form>
  );
}
