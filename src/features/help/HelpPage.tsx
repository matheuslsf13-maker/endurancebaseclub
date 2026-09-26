import { Card } from '../../components/ui';

/**
 * Static field manual for the organizer: what to do before, during and after an event, plus
 * why the official time comes from a median (not an average) of the timekeepers' marks.
 */
export default function HelpPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="brand-title text-xl font-semibold">Ajuda</h1>
        <p className="mt-1 text-sm text-muted">Guia rápido para organizar e cronometrar um evento.</p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Antes do evento</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Crie o evento (nome, data, local).</li>
          <li>Configure as provas: pernas (modalidade, rótulo, distância), ondas e, se precisar, níveis.</li>
          <li>Cadastre os atletas, um a um ou importando uma planilha.</li>
          <li>Faça as inscrições nas provas, atribuindo cada perna a um atleta.</li>
          <li>
            Teste o link do cronometrista <strong>no local da prova</strong>, com os celulares que vão ser
            usados de verdade.
          </li>
        </ol>
        <p className="text-sm text-muted">
          Se o projeto no Supabase estiver há dias sem uso, ele pode ter pausado sozinho — reative-o antes
          de precisar dele (veja o checklist no fim desta página).
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Durante o evento</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            Na aba Cronometragem, toque <strong>Largar agora</strong> para cada onda no momento da largada.
          </li>
          <li>
            Cada cronometrista abre o link no celular, toca <strong>MARCAR</strong> na hora da passagem e
            informa o número do atleta (ou deixa para atribuir depois, na lista "Sem atleta").
          </li>
          <li>
            O revezamento é automático: o app já sabe qual é a próxima perna de cada equipe, ninguém
            escolhe nome no meio da prova.
          </li>
          <li>
            Acompanhe a aba <strong>Revisão</strong> de vez em quando: é lá que aparecem divergências e
            marcações sem atleta.
          </li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Depois do evento</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Resolva as pendências que sobraram na aba Revisão.</li>
          <li>Finalize cada prova em Resultados (isso trava a classificação e os pódios).</li>
          <li>Exporte a planilha de conferência (XLSX).</li>
          <li>Desative o link do cronometrista.</li>
        </ol>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Como o tempo oficial é escolhido</h2>
        <p className="text-sm">
          Cada passagem pode ter mais de uma marcação — vários cronometristas apertando MARCAR para a
          mesma chegada. O tempo do sistema é a <strong>mediana</strong> delas, nunca a média: um toque
          atrasado por distração puxa a média para longe, mas não muda a mediana.
        </p>
        <p className="text-sm">
          Exemplo: três cronometristas marcam a mesma chegada em <span className="tabular">10:00:05</span>,{' '}
          <span className="tabular">10:00:06</span> e <span className="tabular">10:00:19</span>. A mediana
          fica em <span className="tabular">10:00:06</span> — o valor do meio. A média seria{' '}
          <span className="tabular">10:00:10</span>, puxada pelo toque atrasado do terceiro cronometrista.
        </p>
        <p className="text-sm">
          Quando as marcações estão muito espalhadas, o app avisa como <strong>divergência</strong> na aba
          Revisão. Lá você escolhe o tempo oficial: manter o <strong>Sistema</strong> (a mediana), escolher
          uma <strong>marcação</strong> específica, ou digitar um <strong>tempo manual</strong>.
        </p>
      </Card>

      <Card className="flex flex-col gap-3 border-accent/40">
        <h2 className="font-semibold">Checklist do dia do evento</h2>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex gap-2">
            <span aria-hidden="true">☐</span>
            <span>
              <strong>1 dia antes</strong>: abra o painel do Supabase e reative o projeto se ele estiver
              pausado (projetos grátis pausam sozinhos depois de cerca de 7 dias sem uso).
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">☐</span>
            <span>Teste o link do cronometrista no local da prova, com os celulares que serão usados.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">☐</span>
            <span>Confira que as largadas estão sem horário — ninguém apertou "Largar agora" antes da hora.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">☐</span>
            <span>Ao final, exporte a planilha e desative o link do cronometrista.</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
