import { describe, it, expect } from 'vitest';
import { mapImportRows } from './importMapping';
describe('mapImportRows', () => {
  it('maps Brazilian headers and values, reporting bad rows by spreadsheet row number', () => {
    const table = [
      ['Nome Completo', 'Gênero', 'Data de Nascimento', 'E-mail', 'Celular', 'Cidade', 'Assessoria', 'Prova'],
      ['  Ana   Souza ', 'Feminino', '15/06/1990', 'ANA@X.COM', '27 99999-0000', 'Vitória', 'EBC Team', 'Corrida 5K'],
      ['Beto', 'masc', '33039', '', '', '', '', ''],
      ['', 'F', '', '', '', '', '', ''],
      ['Caio', 'X', '', '', '', '', '', ''],
      ['Dani', 'fem', '31/02/1990', '', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
    ];
    const r = mapImportRows(table);
    expect(r.rows).toEqual([
      { name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', email: 'ana@x.com', phone: '27 99999-0000', city: 'Vitória', team_club: 'EBC Team', race_name: 'Corrida 5K' },
      { name: 'Beto', sex: 'M', birth_date: '1990-06-15', email: null, phone: null, city: null, team_club: null, race_name: null },
    ]);
    expect(r.errors).toEqual([
      { row: 4, message: 'Nome vazio' },
      { row: 5, message: 'Sexo inválido: "X"' },
      { row: 6, message: 'Data de nascimento inválida: "31/02/1990"' },
    ]);
  });
  it('requires name and sex columns', () => {
    expect(mapImportRows([['Atleta', 'Cidade'], ['Ana', 'X']]).errors).toEqual([{ row: 1, message: 'Coluna obrigatória não encontrada: Sexo' }]);
  });
});
