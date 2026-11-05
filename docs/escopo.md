# Sprout: escopo do projeto

Mini clone do Scion, o sistema de controle de versão interno da Anthropic, feito
para a demonstração do Trabalho 2 de Gerência de Configuração (ENS4000, UCS).

Este documento define o projeto do zero. Não considera nenhuma versão ou
repositório anteriores.

## 1. Objetivo

Mostrar, rodando, **a diferença entre o git e o Scion quando muitos agentes
fazem commit ao mesmo tempo**.

O Sprout não pretende substituir o git nem ser um sistema de controle de versão
completo. Ele existe para uma única demonstração, e tudo o que não aparece nela
fica fora do escopo.

### A pergunta que a demo responde

> Dez agentes, cada um mudando um arquivo diferente, enviam commits ao mesmo
> tempo. Quanto trabalho é desperdiçado no git, e quanto no Sprout?

- **No git:** o push é rejeitado sempre que a `main` andou, mesmo com arquivos
  diferentes. O agente precisa buscar, refazer o commit (rebase) e tentar de novo.
- **No Sprout:** o servidor cria o changeset e, se os arquivos forem diferentes,
  só troca o pai e avança a `main` com um compare-and-swap. Nenhum agente precisa
  refazer nada.
- **Nos dois:** quando dois agentes mudam o mesmo arquivo, um deles é rejeitado.

## 2. O que o Sprout demonstra e o que não demonstra

| Demonstra | Não demonstra |
| --- | --- |
| Commit feito no servidor, sem push | Escala horizontal (é um processo só, com SQLite) |
| Changeset como diff em relação ao pai | Cache em camadas (daemon, cache regional, servidor) |
| Objetos imutáveis e content-addressed | Checkout virtualizado |
| `main` avançada por compare-and-swap, sem lock | Blame, histórico por caminho, skip lists |
| Reparent automático quando os arquivos são diferentes | Merge ou rebase de conteúdo |
| Derived data recursiva (só a árvore de arquivos) | Code review, permissões, autenticação |

**Atenção:** o artigo da Anthropic não detalha o que o Scion faz quando o
compare-and-swap da `main` falha. A política de reparent do Sprout é uma decisão
de projeto nossa, inspirada no artigo. Isso deve ser dito na apresentação.

## 3. Princípios de arquitetura

Estes princípios são a base do `CLAUDE.md` do repositório. Qualquer pedido que
pareça exigir quebrar um deles deve parar e ser discutido antes.

1. **O servidor é dono de tudo.** Changesets, árvores e decisões de commit são
   calculados no servidor. Os agentes da demo só enviam pedidos e mostram
   respostas.
2. **Não existe push.** O agente envia os arquivos alterados, e o servidor cria
   o changeset. Não existe commit local nem fila de envio.
3. **Changeset é diff em relação ao primeiro pai**, não uma foto da árvore:
   `{ id, parent, author, message, timestamp, changes: [{ path, blobHash | null }] }`.
   `null` significa arquivo removido. O `id` é um inteiro sequencial atribuído
   pelo servidor.
4. **Objetos são imutáveis e content-addressed.** Blobs são identificados pelo
   SHA-256 do conteúdo e guardados comprimidos com zlib. Um objeto existente
   nunca é sobrescrito.
5. **Derived data é recursiva.** A árvore de um changeset é a árvore do pai com
   as mudanças aplicadas, calculada sob demanda e guardada em cache.
6. **Só existe uma ref, a `main`**, atualizada com compare-and-swap. Não existem
   branches nem tags dentro do Sprout.
7. **Commits sem lock.** Se o compare-and-swap da `main` falhar: com arquivos
   diferentes, o servidor troca o pai para a nova cabeça e tenta de novo; com o
   mesmo arquivo, rejeita. Nada de lock, fila ou merge de conteúdo.

## 4. Componentes

```
sprout/
├── src/
│   ├── core/       # tipos do domínio, hashing, normalização de caminhos
│   └── server/     # Fastify + SQLite + blob store em disco
├── demo/           # agentes do git e do Sprout, placar, cenários
├── docs/
│   ├── adr/        # decisões de arquitetura
│   └── resultados.md
├── .github/        # CI, templates de issue e PR
├── CLAUDE.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── README.md
```

### Um pacote só, não um monorepo

Com o escopo reduzido, o projeto tem um único pacote Node, com pastas separadas
para o core, o servidor e a demo. Um monorepo com vários pacotes exigiria ordem
de build entre eles e project references do TypeScript, uma complexidade que não
se paga neste tamanho. Essa decisão vai para o ADR 0001.

### Stack

- Node (versão LTS fixada em `.node-version`) + TypeScript strict
- pnpm
- Fastify (servidor HTTP)
- better-sqlite3 (metadados: changesets e a ref `main`)
- Blobs em arquivos no disco
- vitest (testes), ESLint + Prettier
- tsx para rodar os scripts da demo

## 5. API do servidor

| Método e caminho | O que faz |
| --- | --- |
| `PUT /blobs/:hash` | Grava um blob. Rejeita se o hash do corpo não bater com `:hash` |
| `GET /blobs/:hash` | Devolve o conteúdo de um blob |
| `POST /changesets` | Cria um changeset e avança a `main` (com reparent) |
| `GET /changesets/:id` | Devolve um changeset |
| `GET /refs/main` | Devolve o id da cabeça da `main` |
| `GET /changesets/:id/tree` | Devolve a árvore de arquivos (derived data) |

### `POST /changesets` em detalhe

Corpo: `{ parent, author, message, changes }`.

1. Valida o pedido: `changes` não vazio, caminhos válidos, sem caminho repetido,
   todos os blobs já gravados, `parent` existente.
2. Lê a cabeça atual da `main`.
3. Se `parent` é a cabeça: cria o changeset e tenta o compare-and-swap.
4. Se `parent` não é a cabeça (ou o compare-and-swap falhou): junta os caminhos
   alterados pelos changesets entre `parent` e a cabeça.
   - **Nenhum caminho em comum:** troca o pai para a cabeça e volta ao passo 3.
   - **Algum caminho em comum:** responde `409` com a lista de caminhos em
     conflito.
5. Limite fixo de tentativas. Ao estourar, responde `503`.

Respostas: `201` (criado), `400` (pedido inválido), `404` (`parent` não existe),
`409` (conflito), `503` (limite de tentativas).

## 6. A demo

Detalhada em `03-demo.md`. Em resumo:

- **Agentes do git:** repositório central local; cada agente clona, muda um
  arquivo, faz commit e push. Se o push for rejeitado, faz `pull --rebase` e
  tenta de novo.
- **Agentes do Sprout:** cada agente lê a `main`, grava o blob e envia o
  changeset.
- **Modos:** passo a passo (2 agentes, com pausa a cada etapa) e rápido
  (N agentes ao mesmo tempo).
- **Cenários:** arquivos diferentes e mesmo arquivo.
- **Placar:** aceitos, rejeições, tentativas e tempo total, para os dois sistemas.

## 7. Prioridades

Legenda: 🟢 essencial · 🟡 desejável · 🔵 extra

- 🟢 Servidor com blobs, changesets, compare-and-swap e reparent
- 🟢 Agentes do git e do Sprout, modos passo a passo e rápido
- 🟢 Placar comparativo e cenário de conflito
- 🟢 Resultados medidos em `docs/resultados.md`
- 🟢 Vídeo de reserva da demo
- 🟡 Endpoint da árvore (derived data) e verificação do estado final da `main`
- 🟡 Saída colorida e legível no terminal
- 🔵 Comparação de bytes: checkout sparse no Sprout × clone no git

**Fora de escopo, de propósito:** CLI completa, interface web, cache local,
blame, histórico por caminho, branches, merge e rebase de conteúdo,
autenticação.

## 8. Gerência de configuração no repositório

| Conceito | Como aparece |
| --- | --- |
| Itens de configuração | Código, ADRs, scripts da demo, `.node-version`, `pnpm-lock.yaml` |
| Controle de mudanças | Issue → branch → PR com template → CI → autorrevisão → squash merge |
| Baselines | Tags semver em cada milestone |
| Rastreabilidade | Conventional Commits; commit na `main` → PR → issue (`Closes #N`) |
| Registro de status | `CHANGELOG.md` mantido à mão + GitHub Releases |
| Auditoria e verificação | CI (lint, typecheck, testes) em todo PR; branch protection na `main` |
| Decisões de projeto | ADRs em `docs/adr/` |

### ADRs iniciais

- **0001:** pacote único, stack e versão fixa do Node
- **0002:** modelo de dados (changeset como diff, blobs content-addressed, id
  sequencial)
- **0003:** commits sem lock: compare-and-swap e política de reparent
- **0004:** SQLite num processo só e o que isso não demonstra

## 9. Limitações (vão para o README)

- **Um processo só, com SQLite:** as escritas acontecem em série. O Sprout mostra
  a separação entre criar o changeset e avançar a `main`, não a escala.
- **Sem merge de conteúdo:** dois agentes no mesmo arquivo geram rejeição.
- **Comparação local:** o repositório central do git roda na mesma máquina, sem
  rede. Isso favorece o git em tempo, o que torna a comparação conservadora.
- **Política de reparent própria:** o artigo não descreve esse comportamento.

## 10. Marcos

| Milestone | Conteúdo |
| --- | --- |
| `v0.1.0` | Fundação: projeto, CI, processo de contribuição, ADRs |
| `v0.2.0` | Servidor: blobs, changesets, compare-and-swap, reparent, leitura |
| `v0.3.0` | Demo: agentes, modos, cenários, placar, resultados |
| `v1.0.0` | Material final: README, vídeo de reserva, material da apresentação |

Entrega: 26/11/2026.
