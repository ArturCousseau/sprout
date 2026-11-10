# 0003: commits sem lock, compare-and-swap e política de reparent

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

Vários agentes enviam `POST /changesets` ao mesmo tempo, quase sempre a
partir da mesma cabeça da `main`. O servidor precisa decidir, para cada
pedido, se cria o changeset, sobre qual pai, ou se recusa, sem lock e sem
fila (princípio 7 do CLAUDE.md). A #11 criou o changeset e avançou a `main`
com compare-and-swap, mas recusava com um `409` provisório todo pedido cujo
`parent` não fosse a cabeça.

**O que vem do artigo** ("Redesigning source control for agents",
anthropic.com/engineering/redesigning-source-control):

- No Scion, commits, rebases e merges acontecem no servidor, e não existe
  push (seção "Principles for agent-scale source control", item "Commits must
  be cheap, incremental, and lock-free"). Os changesets são criados no
  servidor (seção "How Scion works", "Data structures").
- Um changeset guarda os arquivos alterados em relação ao primeiro pai
  ("Data structures" e nota 1).
- Mover uma ref é um compare-and-swap numa única linha do Spanner, separado
  da criação dos changesets, sem lock nem coordenação entre servidores
  ("Data structures").
- Mudanças concorrentes podem conflitar, e o Claude costuma resolver esses
  conflitos (seção "What we learned building Scion").
- Uma merge queue com lock global do repositório não funcionou na escala de
  agentes; eles passaram a testar depois do merge e antes do deploy ("What we
  learned building Scion").

**O que o artigo não descreve:** o que o Scion faz quando o compare-and-swap
falha, se tenta de novo, como troca o pai de um changeset e como detecta
conflitos. Tudo isso, neste ADR, é decisão do Sprout, inspirada no artigo.

## Decisão

1. **A `main` avança por compare-and-swap.** O `createChangeset` grava o
   changeset e, na mesma transação, roda:

   ```sql
   UPDATE refs SET value = ? WHERE name = 'main' AND value = ?
   ```

   Se a `main` não estiver mais na cabeça esperada, nada é gravado
   (`stale-head`). Não há lock, mutex nem fila.

   Criar o changeset e fazer o CAS na mesma transação é decisão do Sprout,
   desde a #11, e não vem do artigo. No artigo, mover a ref é um CAS separado
   da criação dos changesets ("Data structures"). No Sprout, um changeset só
   existe se entrou na `main`: se o CAS falha, o changeset também não é
   gravado. É isso que mantém a história em linha única (decisão 6).
   Alternativa considerada: gravar o changeset primeiro e mover a `main`
   depois, como no artigo. Rejeitada porque deixaria changesets fora da
   `main`, e o intervalo de ids da decisão 6 passaria a contá-los.

2. **O gatilho do reparent é o `parent` desatualizado, não a falha do CAS.**
   O cliente lê a `main`, outro commit entra, e só depois ele envia o pedido.
   Ler a cabeça e fazer o CAS no mesmo trecho síncrono nunca vê o CAS falhar
   num processo só (ADR 0004, decisão 5).
3. **Uma troca de pai por pedido, direto para a cabeça.** Se nenhum caminho
   do pedido foi alterado pelos changesets depois do `parent` até a cabeça
   (inclusive), o changeset é criado com a cabeça como pai, num salto só, sem
   passar pelos changesets intermediários. O cliente percebe a troca
   comparando o `parent` da resposta com o que enviou. Não há campo novo na
   resposta.
4. **Sem laço de tentativas e sem `503`.** Alternativa considerada: tentar de
   novo até um limite fixo e responder `503` ao estourar. Rejeitada porque,
   num processo só, ler a cabeça, decidir e fazer o CAS acontecem sem nenhum
   `await` no meio, então o CAS não falha, e o laço nunca rodaria uma segunda
   vez. O laço só seria necessário com vários processos gravando, o que está
   fora do escopo (ADR 0004). Se o CAS falhar, é bug do servidor e a resposta
   é `500`.
5. **Sem merge de conteúdo.** Se algum caminho do pedido foi alterado depois
   do `parent`, a resposta é `409` com `conflicts`: os caminhos em conflito,
   normalizados, sem repetição e em ordem. Vale para modificação e remoção
   dos dois lados. Alternativa considerada: juntar o conteúdo dos dois lados.
   Rejeitada por escopo (`docs/escopo.md` §7). No artigo, quem resolve
   conflitos é o Claude, não o servidor.
6. **Conflito = interseção de caminhos no intervalo de ids
   `(parent, cabeça]`.** O `readChangedPaths` faz
   `SELECT DISTINCT path FROM changes WHERE changeset_id > ? AND changeset_id <= ? ORDER BY path`,
   e o handler filtra essa lista pelos caminhos do pedido. A premissa é que a
   história seja uma linha só, com ids crescentes. Ela é garantida porque o
   `writeChangeset` grava `expectedHead` como pai e não lê nenhum `parent` do
   input: todo changeset é criado sobre a cabeça que ele substitui. O tipo
   `NewChangeset` sem `parent` não é a garantia, porque, com tipagem
   estrutural, um objeto com campos a mais também é aceito. Alternativa
   considerada: seguir os ponteiros `parent` com `WITH RECURSIVE`. Rejeitada
   porque, na linha única, dá o mesmo resultado (experimento E2, abaixo), com
   recursão. A consulta por ids usa o índice da chave primária de `changes`.
7. **`CHECK (parent < id)` na tabela `changesets`.** Isso reverte a decisão 6
   do ADR 0004. O motivo da recusa era que o reparent poderia dar a um
   changeset já criado um pai com id maior. No desenho desta decisão, o pai é
   escolhido antes do `INSERT` e é a cabeça, que já existe e tem id menor que
   o id novo. Evidência (experimento E1, SQLite 3.53.4 do better-sqlite3 do
   repo, num `INSERT` sem `id` explícito, com a raiz em 1):
   - `parent` 1: aceito, com id 2;
   - `parent` 2 (o próximo id): recusado, `CHECK constraint failed`;
   - `parent` 3: recusado, `CHECK constraint failed`.

   Os resultados são os mesmos com as chaves estrangeiras ligadas ou
   desligadas. Ou seja, o CHECK enxerga o id que o SQLite atribui; ele não
   compara com `NULL`. Sem o CHECK, o mesmo `INSERT` com `parent` 2 cria um
   changeset que é pai de si mesmo. A raiz, com `parent NULL`, continua
   entrando.

Experimento E2: a história é 2 {a, x}, 3 {b}, 4 {a, c}, 5 {a removido, d}.
A consulta por ids e a por ponteiros devolvem o mesmo resultado nos
intervalos (3,5], (2,3], (4,5], (1,5] e (5,5]. Elas só divergem com um
changeset fora da linha, gravado por `INSERT` direto.

## Consequências

- O cenário da demo com arquivos diferentes vira 10 × `201` em cadeia, com no
  máximo 9 trocas de pai para 10 agentes. Com o mesmo arquivo, vira 1 × `201`
  e 9 × `409`.
- A precedência do `POST /changesets` é 415 → 400 → 404 → 400 (blobs) → 409
  (`conflicts`). Toda conferência assíncrona termina antes de ler a cabeça.
- O `readChangedPaths` só está certo enquanto a história for uma linha. Um
  `INSERT` direto fora do `createChangeset`, que hoje só os testes fazem, pode
  sair da linha, e então o intervalo de ids devolve caminhos de changesets
  que não são ancestrais, sem erro.
- O `createChangeset` não normaliza caminhos: depende de o chamador passar
  pelo `parseChangesetBody`. Hoje o único chamador de produção é o handler.
- Um `sprout.db` que já existe não ganha o CHECK, porque o schema usa
  `CREATE TABLE IF NOT EXISTS` (ADR 0004, decisão 8). É preciso apagar o
  diretório de dados.
- Com vários processos gravando, a decisão 4 teria de ser revista: o CAS
  poderia falhar de verdade, e um laço com limite passaria a fazer sentido.
