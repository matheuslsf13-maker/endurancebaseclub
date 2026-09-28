import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RankingDef } from '../../lib/types';
import { RankingsEditor } from './RankingsEditor';

function Harness({ initial }: { initial: RankingDef[] }) {
  const [rankings, setRankings] = useState(initial);
  return (
    <>
      <RankingsEditor rankings={rankings} cumulative={false} hasLevels={false} onChange={setRankings} onCumulativeChange={() => {}} />
      <output data-testid="dims">{JSON.stringify(rankings.map((r) => r.dims))}</output>
    </>
  );
}

describe('RankingsEditor: overall podium (no division)', () => {
  it('labels the dimensions "Dividir por:" and shows no overall note while a division is set', () => {
    render(<Harness initial={[{ id: 'g', name: 'Geral por sexo', dims: ['sex'], size: 3 }]} />);
    expect(screen.getByText('Dividir por:')).toBeInTheDocument();
    expect(screen.queryByTestId('ranking-overall-0')).toBeNull();
  });

  it('unchecking every dimension keeps the podium and says it is the overall one', async () => {
    render(<Harness initial={[{ id: 'g', name: 'Geral', dims: ['sex'], size: 3 }]} />);
    await userEvent.click(screen.getByTestId('ranking-dim-sex-0'));
    expect(screen.getByTestId('dims')).toHaveTextContent('[[]]');
    expect(screen.getByTestId('ranking-overall-0')).toHaveTextContent('Pódio geral: todos juntos, sem divisão');
  });

  it('a new podium starts as the overall one', async () => {
    render(<Harness initial={[]} />);
    await userEvent.click(screen.getByTestId('ranking-add'));
    expect(screen.getByTestId('dims')).toHaveTextContent('[[]]');
    expect(screen.getByTestId('ranking-overall-0')).toBeInTheDocument();
  });
});
