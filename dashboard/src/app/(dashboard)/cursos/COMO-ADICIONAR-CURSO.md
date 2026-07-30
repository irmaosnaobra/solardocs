# Como adicionar um curso novo

**Regra da casa: todo curso usa a mesma casca.** Você declara módulos e lições num
arquivo de configuração — trilha, XP, níveis, conquistas, progresso, tela de lição
e navegação vêm prontos, no mesmo padrão visual. **Não se cria tela nova, não se
copia CSS.**

## As regras que não mudam

1. **O conteúdo mora na plataforma.** Nada de arquivo para baixar — o aluno entra,
   lê e marca a lição. É isso que faz ele voltar e ver o resto do produto. Quando a
   lição precisar de uma ferramenta, aponte para a ferramenta que já existe aqui
   dentro (calculadora, gerador de documentos, vistoria).
2. **Ícones lucide, nunca emoji.** Precisam estar declarados em `NomeIcone`
   (`_conteudo/cursos.config.ts`) e no mapa `ICONES` da página do curso.
3. **Cada módulo declara a sua conquista.** A casca gera automaticamente
   "Primeira lição" + uma conquista por módulo + "Curso completo".
4. **Os 4 níveis são proporcionais** ao XP total (0 / 25% / 55% / 85%), então
   mudar o conteúdo nunca quebra a escada de progressão. Dá para trocar só os
   nomes por curso.
5. **XP por tipo de lição é fixo:** leitura 100 · ferramenta 120 · prática 150.
   Bônus de módulo entre 200 e 250.
6. **Canvas escuro.** O app é claro; o curso é escuro de propósito — entrar nele é
   sair da ferramenta e entrar no treinamento.

## Passo a passo

### 1. Escreva o conteúdo
Um arquivo por assunto em `_conteudo/`, exportando dados (não JSX):

```ts
// _conteudo/instalacao.ts
export const CHECKLIST_TELHADO = [ /* … */ ];
```

### 2. Declare o curso
`_conteudo/meu-curso.ts` — só módulos e lições:

```ts
// Importe da CASCA (curso-tipos), nunca do registro — senão vira ciclo e o build quebra.
import { XP_POR_TIPO as XP, type Curso } from './curso-tipos';

export const INSTALACAO_SEGURA: Curso = {
  slug: 'instalacao-segura',
  nome: 'Instalação Segura',
  descricao: 'Do checklist de telhado ao comissionamento, sem retrabalho.',
  niveis: ['Ajudante', 'Instalador', 'Líder de equipe', 'Mestre de obra'], // opcional
  modulos: [
    {
      slug: 'telhado',
      numero: 1,
      titulo: 'Antes de subir',
      subtitulo: 'O que conferir para a obra não voltar',
      icone: 'ClipboardCheck',
      cor: '#5cb8f7',
      bonusXp: 200,
      conquista: { nome: 'Telhado sob controle', icone: 'ShieldCheck' },
      licoes: [
        {
          id: 'telhado:checklist',   // a chave gravada no progresso: 'modulo:licao'
          titulo: 'O checklist de 12 itens',
          resumo: 'O que olhar na estrutura antes de encostar a escada',
          minutos: 7,
          xp: XP.leitura,
          tipo: 'leitura',
        },
      ],
    },
  ],
};
```

### 3. Registre
Em `_conteudo/cursos.config.ts`:

```ts
import { INSTALACAO_SEGURA } from './instalacao-segura';
export const CURSOS: Curso[] = [KIT_FECHAMENTO, INSTALACAO_SEGURA];
```

### 4. Renderize o conteúdo das lições
Em `_componentes/ConteudoLicao.tsx`, trate os ids novos usando as classes que já
existem (`cardConteudo`, `script`, `zap`, `lista`, `missao`, `tabela`…):

```tsx
if (id === 'telhado:checklist') {
  return (
    <div className={styles.leitura}>
      <p className={styles.intro}>…</p>
      <div className={styles.cardConteudo}>
        <ul className={styles.checklist}>{/* … */}</ul>
      </div>
    </div>
  );
}
```

### 5. Ponha no menu
Em `dashboard/src/components/Sidebar/Sidebar.tsx`, adicione ao array
`cursosItems` (a seção "Cursos" fica acima do "Menu"):

```ts
{ href: '/cursos/instalacao-segura', icon: HardHat, label: 'Instalação Segura' },
```

### 6. Quem pode ver
Hoje o acesso é o do Kit: **teve pedido pago** (`kit_pedidos`), lido de
`GET /kit/meu-acesso`. Se o curso novo tiver regra própria, é aí que muda — a tela
usa um único booleano `liberado`.

Assinar **não** libera (mudou em 30/jul/2026): o curso voltou a ser produto vendido à
parte, e assinante que clica nele cai na tela bloqueada com CTA de compra. A única
inclusão que existe é a oferta `vip_curso` — e ali o acesso é **entregue de fato** por
`concederCursoPorAssinatura()`, que grava o pedido pago que este gate lê. O mesmo vale
pra reativação por Pix de R$67. Se você prometer o curso em alguma oferta nova, chame
essa função no fechamento dela: prometer sem gravar o pedido = cliente pago no cadeado.

## O que você NÃO precisa fazer

- Criar rota (`/cursos/[slug]` serve qualquer curso do registro)
- Escrever CSS (tudo em `curso.module.css`)
- Criar tabela (o progresso usa `kit_progresso`, chave `modulo:licao`)
- Definir níveis, conquistas ou cálculo de XP à mão
