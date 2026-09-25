import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';
describe('parseCsv', () => {
  it('handles BOM, semicolons, escaped quotes and CRLF', () => {
    const text = '﻿Nome;Sexo;Nascimento\r\n"Souza; Ana";F;15/06/1990\r\n"Beto ""Rápido""";M;\r\n';
    expect(parseCsv(text)).toEqual([['Nome', 'Sexo', 'Nascimento'], ['Souza; Ana', 'F', '15/06/1990'], ['Beto "Rápido"', 'M', '']]);
  });
  it('handles commas, tabs and newlines inside quotes', () => {
    expect(parseCsv('a,b\n"x\ny",2\n')).toEqual([['a', 'b'], ['x\ny', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
