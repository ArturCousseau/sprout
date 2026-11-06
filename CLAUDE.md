# Sprout

Mini clone do Scion (controle de versão da Anthropic), feito para uma única
demonstração acadêmica: git × Sprout com vários agentes fazendo commit ao mesmo
tempo. Não é um sistema de controle de versão completo. Escopo completo em
`docs/escopo.md`; leia quando a tarefa tocar em API, demo ou prioridades.

## Princípios de arquitetura (NÃO VIOLAR)

1. O servidor é dono de tudo. Changesets, árvores e decisões de commit são
   calculados no servidor. Os agentes da demo só enviam pedidos e mostram
   respostas.
2. Não existe push. O agente envia os arquivos alterados e o servidor cria o
   changeset. Nada de commit local nem fila de envio.
3. Changeset é diff em relação ao primeiro pai, não foto da árvore:
   `{ id, parent, author, message, timestamp, changes: [{ path, blobHash | null }] }`.
   `null` = arquivo removido. `id` é inteiro sequencial atribuído pelo servidor.
4. Objetos são imutáveis e content-addressed: SHA-256 do conteúdo, gravados com
   zlib. Um objeto existente nunca é sobrescrito.
5. Derived data é recursiva: a árvore de um changeset é a árvore do pai com as
   mudanças aplicadas, calculada sob demanda e cacheada.
6. Só existe a ref `main`, atualizada com compare-and-swap
   (`UPDATE ... WHERE value = <esperado>`). Sem branches nem tags no Sprout.
7. Commits sem lock. Se o CAS falhar: arquivos diferentes → troca o pai para a
   nova cabeça e tenta de novo; algum arquivo em comum → `409`. Limite fixo de
   tentativas → `503`. Nada de lock, mutex, fila ou merge de conteúdo.

Se uma tarefa parecer exigir quebrar um princípio, PARE e pergunte antes.

## Fora de escopo

CLI completa, interface web, cache local, blame, histórico por caminho,
branches, merge/rebase de conteúdo, autenticação. Não implemente sem eu pedir.

## Stack e estrutura

Pacote único (não é monorepo). Node LTS (`.node-version`) + TypeScript strict,
pnpm, Fastify, better-sqlite3, vitest, ESLint + Prettier, tsx.

- `src/core/`: tipos do domínio, hashing, normalização de caminhos
- `src/server/`: Fastify + SQLite + blob store em disco
- `demo/`: agentes do git e do Sprout, cenários, placar
- `docs/adr/`: decisões de arquitetura

## Comandos

- `pnpm install`
- `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `pnpm test` ·
  `pnpm build`

Antes de considerar uma tarefa concluída, rode format:check, lint, typecheck,
test e build e corrija o que falhar.

## Convenções

- Código, identificadores e commits em inglês. Documentação em português.
- Conventional Commits. Use o escopo (`core`, `server`, `demo`) quando a
  mudança for de uma dessas áreas: `feat(server): add blob store (#9)`.
  Mudanças que atravessam o projeto (setup, CI, processo, docs gerais) ficam
  sem escopo. Sempre referencie a issue. O título do PR segue o mesmo formato
  (`feat(server): add blob store (#9)`), porque o squash merge usa o título do
  PR como mensagem do commit na `main`.
- Uma issue por branch e por PR. Branch: `feat/9-blob-store`. Nunca commite na
  `main`.
- Toda feature nova tem testes; cada critério de aceitação da issue, um teste.
- Prefira a solução mais simples. Sem abstrações "para o futuro".
- Decisão de arquitetura relevante: sugira um ADR em `docs/adr/NNNN-titulo.md`.
- Não instale ferramentas globais nem altere configurações fora do repositório
  (mise, `~/.config`, shell) sem perguntar.
- Antes de editar arquivos de configuração ou o workflow de CI, leia as seções
  "Comentários em arquivos de configuração" e "CI e o ruleset da `main`" do
  `CONTRIBUTING.md`.
- Estou aprendendo TypeScript e backend: ao terminar, explique o que mudou de
  forma que alguém que sabe JavaScript básico e Java entenda.
