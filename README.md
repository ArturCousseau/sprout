# Sprout

Mini clone do Scion, o sistema de controle de versão interno da Anthropic,
feito para uma demonstração acadêmica. Não é um sistema de controle de versão
completo: existe para uma única demonstração, que responde a esta pergunta:

> Dez agentes, cada um mudando um arquivo diferente, enviam commits ao mesmo
> tempo. Quanto trabalho é desperdiçado no git, e quanto no Sprout?

## Relação com o Scion

O Scion é descrito no artigo
[Redesigning source control at Anthropic](https://www.anthropic.com/engineering/redesigning-source-control).
O que o Sprout demonstra:

- Commit feito no servidor, sem push
- Changeset como diff em relação ao pai
- Objetos imutáveis e content-addressed
- `main` avançada por compare-and-swap, sem lock
- Reparent automático quando os arquivos são diferentes
- Derived data recursiva (só a árvore de arquivos)

A troca de pai (reparent) é uma política nossa, inspirada no artigo: o artigo
não descreve o que o Scion faz quando o compare-and-swap da `main` falha.

## Termos

- **Scion:** o sistema de controle de versão interno da Anthropic.
- **Cenários:** A, 2 agentes em arquivos diferentes; B, 10 agentes em arquivos
  diferentes; C, 2 agentes no mesmo arquivo.
- **Tentativa:** um push no git; um pedido `POST /changesets` no Sprout.
- **Rejeição:** um push recusado no git, ou um pedido recusado sem conflito
  real no Sprout (o esperado é zero).
- **Conflito real:** dois agentes mudam o mesmo arquivo, e um deles é rejeitado
  nos dois sistemas.
- **Troca de pai (reparent):** quando nenhum arquivo do pedido mudou depois do
  pai que o agente enviou, o servidor do Sprout cria o changeset sobre a cabeça
  (o último changeset) da `main`, e o agente não refaz nada.
- **Passo a passo × rápido:** o modo passo a passo (cenários A e C) pausa antes
  de cada etapa e espera um Enter; o modo rápido roda todos os agentes em
  paralelo.

## Requisitos

- Node 26.12.0 ou mais novo (campo `engines` do `package.json`). As medições
  usaram o Node 26.13.0.
- pnpm 12.16.1 (campo `packageManager` do `package.json`).
- git, validado com a versão 2.56.0.

Validado só no Linux (omarchy); outros sistemas não testados.

## Como rodar

```
pnpm install
```

Não é preciso build antes da demo: os comandos rodam o TypeScript direto, com
o `tsx`.

Modo rápido, um cenário por vez, com o placar no fim:

```
pnpm demo:reset
pnpm demo:git --cenario A
pnpm demo:sprout --cenario A
pnpm demo:placar --cenario A
pnpm demo:git --cenario B
pnpm demo:sprout --cenario B
pnpm demo:placar --cenario B
pnpm demo:git --cenario C
pnpm demo:sprout --cenario C
pnpm demo:placar --cenario C
```

Passo a passo (cenários A e C):

```
pnpm demo:git --cenario A --passo
pnpm demo:sprout --cenario A --passo
pnpm demo:git --cenario C --passo
pnpm demo:sprout --cenario C --passo
```

O placar de um cenário lê o resultado das duas execuções rápidas dele, no git
e no Sprout, e sai com erro se faltar uma delas. Um `--passo` apaga o
resultado do cenário: rode o placar antes dele.

`pnpm demo:medir` e `pnpm demo:curva` regravam `docs/resultados.md` e
`docs/curva.md`, os números oficiais, e deixam a árvore suja.

O funcionamento da demo e todos os comandos estão em
[docs/demo.md](docs/demo.md).

## Resultados

Medido em 18/11/2026 16:14, no commit `5bce0e3`, no modo rápido. O tempo é a
média de 5 execuções, em ms, da liberação dos agentes até o último terminar.
Detalhes em [docs/resultados.md](docs/resultados.md).

| Cenário | Sistema | Tempo médio (ms) | Tentativas |
| ------- | ------- | ---------------: | ---------: |
| A       | git     |              139 |          3 |
| A       | sprout  |               26 |          2 |
| B       | git     |             1075 |         55 |
| B       | sprout  |               97 |         10 |
| C       | git     |              114 |          2 |
| C       | sprout  |               20 |          2 |

## Curva N × tentativas

O cenário B com N agentes, cada um no seu próprio arquivo, 3 execuções por N,
medição de 18/11. Quando as 3 execuções não concordam, aparecem o
mínimo–máximo e os 3 valores. Detalhes em [docs/curva.md](docs/curva.md).

|   N | Teto do git | Tentativas no git       | Tentativas no Sprout |
| --: | ----------: | ----------------------- | -------------------: |
|   2 |           3 | 3                       |                    2 |
|   5 |          15 | 15                      |                    5 |
|  10 |          55 | 55                      |                   10 |
|  20 |         210 | 175–189 (189, 179, 175) |                   20 |

O teto do git, N(N+1)/2, é o pior caso, não o valor esperado: com N = 20, o git
fez entre 175 e 189 tentativas contra um teto de 210. Com a máquina carregada,
o cenário B já saiu entre 51 e 55 tentativas no git; a causa não foi
verificada. No Sprout, cada agente faz um único pedido, então as tentativas são
sempre N.

## Escopo acadêmico

O Sprout é uma demonstração, não um produto. Ficaram de fora, de propósito:
escala horizontal, cache em camadas, checkout virtualizado, blame e histórico
por caminho, merge ou rebase de conteúdo, code review, permissões e
autenticação. A lista completa está em [docs/escopo.md](docs/escopo.md).

## Limitações

- **Um processo só, com SQLite:** as escritas acontecem em série, e o Sprout
  não mostra escala ([ADR 0004](docs/adr/0004-sqlite-num-processo-so.md)).
- **Sem merge de conteúdo:** dois agentes no mesmo arquivo geram rejeição.
- **Política de troca de pai própria:** o artigo não descreve esse
  comportamento.
- **Comparação local:** o repositório central do git roda na mesma máquina, sem
  rede, o que favorece o git no tempo.
- **Agentes sem IA:** os agentes são rotinas com roteiro fixo, não modelos de
  IA.
- **Uma máquina só:** os números não valem para outra máquina.
- **O teto é o pior caso:** N(N+1)/2 tentativas é o máximo do git, não o valor
  esperado.
- **SIGKILL no `tsx`:** um SIGKILL no processo do `tsx` deixa a demo e o
  servidor órfãos, com o servidor ainda respondendo.

## Links

- [docs/escopo.md](docs/escopo.md): escopo e princípios de arquitetura
- [docs/demo.md](docs/demo.md): funcionamento da demo e comandos
- [docs/adr/](docs/adr/): decisões de arquitetura
- [docs/resultados.md](docs/resultados.md): medição dos cenários
- [docs/curva.md](docs/curva.md): curva N × tentativas
- [CHANGELOG.md](CHANGELOG.md): mudanças por versão
- [CONTRIBUTING.md](CONTRIBUTING.md): como contribuir
- [LICENSE](LICENSE): licença MIT
- [Issues do repositório](https://github.com/ArturCousseau/sprout/issues)
