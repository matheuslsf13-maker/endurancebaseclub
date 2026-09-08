/**
 * ESCRITOR DE ARQUIVO EXCEL (.xlsx), SEM DEPENDENCIA.
 *
 * Um .xlsx e um ZIP com alguns XML dentro. As bibliotecas prontas de Excel
 * pesam algumas centenas de KB -- num app que e aberto no celular na beira da
 * pista, isso e caro para uma funcao que so roda depois da prova.
 *
 * Entao aqui vai o minimo que o Excel, o LibreOffice e o Google Planilhas
 * abrem: ZIP sem compressao (o metodo "store", que o formato aceita e dispensa
 * implementar deflate) e planilhas com texto em linha, sem tabela de strings
 * compartilhadas nem estilos.
 *
 * O que ele NAO faz: formulas, cores, formatos de celula. Nada disso e
 * necessario -- e os tempos saem como TEXTO ("1:24:31") de proposito, para o
 * Excel nao reinterpretar duracao como hora do dia, que e o jeito classico de
 * uma planilha de prova chegar errada do outro lado.
 */

export type Celula = string | number | null | undefined

export type Aba = {
  nome: string
  /** A primeira linha e o cabecalho. */
  linhas: Celula[][]
  /** Largura de cada coluna, em caracteres. Opcional. */
  larguras?: number[]
}

// ------------------------------------------------------------------
//  XML das planilhas
// ------------------------------------------------------------------

function esc(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // caracteres de controle nao sao validos em XML e derrubam o arquivo
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  )
}

/** A1, B1, ... Z1, AA1... */
function ref(coluna: number, linha: number): string {
  let s = ''
  let n = coluna + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s + linha
}

function planilhaXML(aba: Aba): string {
  const cols = aba.larguras?.length
    ? `<cols>${aba.larguras
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''

  const linhas = aba.linhas
    .map((linha, i) => {
      const celulas = linha
        .map((c, j) => {
          if (c === null || c === undefined || c === '') return ''
          const r = ref(j, i + 1)
          if (typeof c === 'number' && Number.isFinite(c)) {
            return `<c r="${r}"><v>${c}</v></c>`
          }
          return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${esc(String(c))}</t></is></c>`
        })
        .join('')
      return `<row r="${i + 1}">${celulas}</row>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${linhas}</sheetData></worksheet>`
}

/** O Excel recusa alguns caracteres e mais de 31 letras no nome da aba. */
function nomeDeAba(nome: string, usados: Set<string>): string {
  let limpo = nome.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Planilha'
  let n = 2
  while (usados.has(limpo.toLowerCase())) {
    const sufixo = ` ${n++}`
    limpo = limpo.slice(0, 31 - sufixo.length) + sufixo
  }
  usados.add(limpo.toLowerCase())
  return limpo
}

// ------------------------------------------------------------------
//  ZIP (metodo "store", sem compressao)
// ------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(dados: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

type Arquivo = { nome: string; dados: Uint8Array<ArrayBuffer> }

function zipar(arquivos: Arquivo[]): Blob {
  const codificador = new TextEncoder()
  // Uint8Array<ArrayBuffer> explicito: o Blob nao aceita o buffer compartilhado
  const partes: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let deslocamento = 0

  // data e hora fixas: assim dois exports do mesmo conteudo geram bytes iguais
  const hora = 0
  const data = ((2020 - 1980) << 9) | (1 << 5) | 1

  for (const a of arquivos) {
    const nome = codificador.encode(a.nome)
    const crc = crc32(a.dados)
    const tam = a.dados.length

    const local = new Uint8Array(30 + nome.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true) // versao necessaria
    dv.setUint16(6, 0x0800, true) // nomes em UTF-8
    dv.setUint16(8, 0, true) // metodo 0 = sem compressao
    dv.setUint16(10, hora, true)
    dv.setUint16(12, data, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, tam, true)
    dv.setUint32(22, tam, true)
    dv.setUint16(26, nome.length, true)
    dv.setUint16(28, 0, true)
    local.set(nome, 30)

    partes.push(local, a.dados)

    const cd = new Uint8Array(46 + nome.length)
    const cdv = new DataView(cd.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0x0800, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, hora, true)
    cdv.setUint16(14, data, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, tam, true)
    cdv.setUint32(24, tam, true)
    cdv.setUint16(28, nome.length, true)
    cdv.setUint32(42, deslocamento, true)
    cd.set(nome, 46)
    central.push(cd)

    deslocamento += local.length + tam
  }

  const tamanhoCentral = central.reduce((s, c) => s + c.length, 0)
  const fim = new Uint8Array(22)
  const fdv = new DataView(fim.buffer)
  fdv.setUint32(0, 0x06054b50, true)
  fdv.setUint16(8, arquivos.length, true)
  fdv.setUint16(10, arquivos.length, true)
  fdv.setUint32(12, tamanhoCentral, true)
  fdv.setUint32(16, deslocamento, true)

  return new Blob([...partes, ...central, fim], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ------------------------------------------------------------------

/** Monta o .xlsx com uma aba por item da lista. */
export function montarXlsx(abas: Aba[]): Blob {
  const codificador = new TextEncoder()
  const usados = new Set<string>()
  const comNome = abas.map((a) => ({ ...a, nome: nomeDeAba(a.nome, usados) }))

  const arquivos: Arquivo[] = [
    {
      nome: '[Content_Types].xml',
      dados: codificador.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${comNome
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`,
      ),
    },
    {
      nome: '_rels/.rels',
      dados: codificador.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      ),
    },
    {
      nome: 'xl/workbook.xml',
      dados: codificador.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${comNome
          .map((a, i) => `<sheet name="${esc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('')}</sheets>
</workbook>`,
      ),
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      dados: codificador.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${comNome
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
</Relationships>`,
      ),
    },
    ...comNome.map((a, i) => ({
      nome: `xl/worksheets/sheet${i + 1}.xml`,
      dados: codificador.encode(planilhaXML(a)),
    })),
  ]

  return zipar(arquivos)
}

/** Salva o arquivo no aparelho de quem clicou. */
export function baixar(blob: Blob, nomeArquivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // o navegador precisa de um instante para comecar o download antes de soltar
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
