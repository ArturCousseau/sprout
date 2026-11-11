# Changelog

Todas as mudanças relevantes do Sprout ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada item aponta
para a issue e para o PR de onde veio. O processo de release está no
[CONTRIBUTING.md](CONTRIBUTING.md#release).

## [Não lançado]

### Adicionado

- Base comum da demo em `demo/`: `pnpm demo:reset` (apaga só `demo/tmp`),
  cenários A, B e C com `--cenario`, barreira de largada em memória, registro
  por agente e resumo do placar, resultados gravados e lidos em JSON, config
  do git isolada para os agentes, classificação das rejeições do
  `git push --porcelain` (`fetch-first` e `ref-lock`), teto de 3 × N
  tentativas por execução no git e a lista de respostas esperadas do Sprout
  por operação. O `docs/demo.md` documenta a barreira, os tipos de rejeição,
  a largada, o registro e o JSON, e as versões validadas (git 2.56.0, node
  26.12.0, também em `engines`)
  ([#14](https://github.com/ArturCousseau/sprout/issues/14)).

### Alterado

- Regras de processo no repositório: seção "Fluxo de trabalho" no CLAUDE.md,
  bloco pronto para o pedido ao `@claude` no CONTRIBUTING, itens de release e
  de código de saída no template de PR, e `.claude/settings.local.json` no
  `.gitignore`, que fazia o `pnpm format:check` falhar localmente
  ([#39](https://github.com/ArturCousseau/sprout/issues/39),
  [#40](https://github.com/ArturCousseau/sprout/pull/40)).

## [0.2.0] - 2026-11-11

### Adicionado

- Core do domínio: tipos `Changeset` e `Change`, hash SHA-256 do conteúdo,
  normalização e validação de caminhos e o ADR 0002, sobre o modelo de dados
  ([#8](https://github.com/ArturCousseau/sprout/issues/8),
  [#29](https://github.com/ArturCousseau/sprout/pull/29)).
- Servidor Fastify com blob store em disco: `PUT` e `GET /blobs/:hash`,
  blobs comprimidos com zlib e identificados pelo SHA-256 do conteúdo,
  publicados com `link` sem nunca sobrescrever, e o script `pnpm start`
  ([#9](https://github.com/ArturCousseau/sprout/issues/9),
  [#32](https://github.com/ArturCousseau/sprout/pull/32)).
- Metadados em SQLite (`better-sqlite3`): changesets como diff, a ref `main`,
  o changeset raiz criado na primeira abertura, `GET /refs/main`,
  `GET /changesets/:id` e o ADR 0004, sobre SQLite num processo só
  ([#10](https://github.com/ArturCousseau/sprout/issues/10),
  [#34](https://github.com/ArturCousseau/sprout/pull/34)).
- `POST /changesets`: cria o changeset quando `parent` é a cabeça da `main` e
  avança a `main` com compare-and-swap, numa transação só; valida o corpo à
  mão, normaliza os caminhos, confere os blobs (`hasBlob`, sem ler o arquivo),
  responde `404` para pai inexistente e `409` provisório quando `parent` não é
  a cabeça (o reparent fica para a #12)
  ([#11](https://github.com/ArturCousseau/sprout/issues/11),
  [#35](https://github.com/ArturCousseau/sprout/pull/35)).
- Reparent e `409` com conflitos no `POST /changesets`: se nenhum caminho do
  pedido foi alterado depois do `parent`, o changeset é criado sobre a cabeça
  da `main`, numa troca de pai só; se algum foi, responde `409` com
  `conflicts`. Inclui `readChangedPaths`, `CHECK (parent < id)` no schema e o
  ADR 0003, sobre commits sem lock e a política de reparent
  ([#12](https://github.com/ArturCousseau/sprout/issues/12),
  [#36](https://github.com/ArturCousseau/sprout/pull/36)).
- `GET /changesets/:id/tree`: a árvore de arquivos de um changeset (a árvore
  do pai com as mudanças aplicadas), calculada sob demanda, num laço, e
  guardada num cache em memória que nunca é invalidado; a remoção de um
  caminho ausente é ignorada. Inclui `applyChanges` e `treeEntries` no core e
  o ADR 0005, sobre a árvore sob demanda
  ([#13](https://github.com/ArturCousseau/sprout/issues/13),
  [#37](https://github.com/ArturCousseau/sprout/pull/37)).

### Alterado

- `POST /changesets`: o `409` provisório para `parent` desatualizado deixa de
  existir, e o `createChangeset` passa a usar a cabeça esperada como pai, sem
  receber `parent`. O princípio 7 do CLAUDE.md e o `docs/escopo.md` deixam de
  prever o laço de tentativas e o `503`
  ([#12](https://github.com/ArturCousseau/sprout/issues/12),
  [#36](https://github.com/ArturCousseau/sprout/pull/36)).
- Revisão por IA: limite de turnos sobe de 5 para 10, e o CONTRIBUTING orienta
  colar os critérios da issue no comentário do `@claude`
  ([#30](https://github.com/ArturCousseau/sprout/issues/30),
  [#31](https://github.com/ArturCousseau/sprout/pull/31)).

## [0.1.0] - 2026-11-06

### Adicionado

- Setup do projeto: TypeScript strict, pnpm, ESLint, Prettier, vitest, o
  template de ADR (0000) e o ADR 0001, sobre pacote único, stack e versão fixa
  do Node ([#1](https://github.com/ArturCousseau/sprout/issues/1),
  [#2](https://github.com/ArturCousseau/sprout/pull/2)).
- Workflow do GitHub Actions com o check `verify` em todo PR
  ([#3](https://github.com/ArturCousseau/sprout/issues/3),
  [#4](https://github.com/ArturCousseau/sprout/pull/4)).
- CONTRIBUTING e templates de issue e de PR
  ([#5](https://github.com/ArturCousseau/sprout/issues/5),
  [#26](https://github.com/ArturCousseau/sprout/pull/26)).
- Revisão por IA sob demanda, comentando `@claude` no PR
  ([#6](https://github.com/ArturCousseau/sprout/issues/6),
  [#27](https://github.com/ArturCousseau/sprout/pull/27)).
- CHANGELOG e processo de release
  ([#7](https://github.com/ArturCousseau/sprout/issues/7),
  [#28](https://github.com/ArturCousseau/sprout/pull/28)).

[Não lançado]: https://github.com/ArturCousseau/sprout/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ArturCousseau/sprout/releases/tag/v0.2.0
[0.1.0]: https://github.com/ArturCousseau/sprout/releases/tag/v0.1.0
