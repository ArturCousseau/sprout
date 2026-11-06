# Changelog

Todas as mudanças relevantes do Sprout ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/). Cada item aponta
para a issue e para o PR de onde veio. O processo de release está no
[CONTRIBUTING.md](CONTRIBUTING.md#release).

## [Não lançado]

### Adicionado

- Core do domínio: tipos `Changeset` e `Change`, hash SHA-256 do conteúdo,
  normalização e validação de caminhos e o ADR 0002, sobre o modelo de dados
  ([#8](https://github.com/ArturCousseau/sprout/issues/8),
  [#29](https://github.com/ArturCousseau/sprout/pull/29)).

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

[Não lançado]: https://github.com/ArturCousseau/sprout/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ArturCousseau/sprout/releases/tag/v0.1.0
