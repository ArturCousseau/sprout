# Como contribuir

Este documento descreve o processo: como uma mudança sai de uma issue e chega à
`main`, quais regras o GitHub aplica na `main` e o que fica configurado fora do
código. As convenções de código (commits, título do PR, nome de branch, testes e
comandos de verificação) ficam no [CLAUDE.md](CLAUDE.md), seções "Comandos" e
"Convenções". Este documento não as repete.

## Fluxo

1. **Issue.** Toda mudança começa numa issue, aberta com o template "Tarefa do
   backlog" (objetivo, prioridade e critérios de aceite).
2. **Branch.** Uma branch por issue, criada a partir da `main`, com o nome no
   formato do CLAUDE.md.
3. **PR.** Abra o PR para a `main` usando o template. O corpo tem `Closes #N`,
   que fecha a issue no merge.
4. **CI (`verify`).** O workflow roda em todo PR. O merge só é liberado quando o
   check `verify` passa.
5. **Autorrevisão.** Antes do merge, revise o próprio PR seguindo o checklist do
   template (ver [Autorrevisão](#autorrevisão)).
6. **Squash merge.** O único método de merge permitido. O título do PR vira a
   mensagem do commit na `main`.

## Por que squash

- **Um commit por PR na `main`.** Como cada PR corresponde a uma issue, cada
  commit da `main` corresponde a uma issue.
- **Histórico linear.** A `main` não tem commits de merge, e `git log` lê como
  uma lista de mudanças completas.
- **Rastreio.** Commit na `main` → PR → issue, pelo `(#N)` no título e pelo
  `Closes #N` no corpo (ver [docs/escopo.md](docs/escopo.md), §8 Gerência de
  configuração no repositório).
- **Commits intermediários não chegam à `main`.** Commits de teste, como o
  commit que quebra o CI de propósito e o revert dele no PR #4, ficam só no PR.

## Regras da `main`

As regras vêm do [ruleset `main`](https://github.com/ArturCousseau/sprout/rules/26653465).
Para conferir os valores atuais:
`gh api repos/ArturCousseau/sprout/rulesets/26653465`.

| Regra                                                 | Campo do ruleset                                   |
| ----------------------------------------------------- | -------------------------------------------------- |
| Vale para a branch padrão (`main`)                    | `conditions.ref_name.include: ["~DEFAULT_BRANCH"]` |
| Ninguém contorna as regras, nem o dono do repositório | `bypass_actors: []`                                |
| Mudança na `main` só por PR                           | regra `pull_request`                               |
| Nenhuma aprovação exigida                             | `required_approving_review_count: 0`               |
| Só squash merge                                       | `allowed_merge_methods: ["squash"]`                |
| Todas as threads de revisão resolvidas antes do merge | `required_review_thread_resolution: true`          |
| O check `verify` precisa passar                       | `required_status_checks: [{ context: "verify" }]`  |
| A branch não precisa estar atualizada com a `main`    | `strict_required_status_checks_policy: false`      |
| Sem force push                                        | regra `non_fast_forward`                           |
| A `main` não pode ser apagada                         | regra `deletion`                                   |

## CI e o ruleset da `main`

O que o CI roda está em [.github/workflows/ci.yml](.github/workflows/ci.yml): ele
roda em todo PR para a `main` e em todo push na `main`.

O ruleset exige um check chamado `verify`, e esse nome vem do **id do job** no
`ci.yml`. O nome do job é um contrato com o ruleset:

- **Renomear o job** muda o nome do check.
- **Adicionar `name:` ao job** faz o GitHub publicar o check com esse nome, não
  com o id.
- **Usar `strategy.matrix`** gera um check por combinação, como
  `verify (ubuntu-latest)`, e nenhum se chama `verify`.

Nos três casos, o check `verify` nunca aparece, o ruleset espera por ele para
sempre e **todos os PRs ficam travados**, incluindo o PR que causou o problema.
Para mudar o nome com segurança, altere o check obrigatório no ruleset junto com
o workflow. Isso é feito à mão, nas configurações do repositório. O comentário
acima do job `verify` no `ci.yml` registra esse aviso no próprio arquivo.

## Autorrevisão

Antes do merge, leia o próprio PR como revisor e siga o checklist do template de
PR. O ruleset não exige aprovação, então a autorrevisão é a única revisão
garantida. Nenhuma regra do GitHub verifica se ela foi feita: cabe a quem abre o
PR.

## Revisão por IA (opcional)

Você pode pedir uma revisão por IA comentando `@claude` no PR. Ela é:

- **opcional e sob demanda:** só roda quando alguém pede;
- **só um comentário:** não commita e não bloqueia o merge;
- **um complemento:** não substitui a autorrevisão.

A integração ainda está sendo feita na issue #6. Até ela ser concluída, o
comentário `@claude` não dispara nada.

## Comentários em arquivos de configuração

Os arquivos de configuração (`.yml`, `.yaml`, `.gitignore` etc.) usam três níveis
de comentário. Os exemplos abaixo usam `#`; em arquivos com `//` (JS, JSONC) ou
`--` (Lua), troque só o prefixo.

### 1. Cabeçalho do arquivo

Fica no topo e explica para que o arquivo serve. Aparece uma vez por arquivo, e
só quando o arquivo precisa de explicação. Exemplos: `ci.yml` e
`pnpm-workspace.yaml`.

```yaml
# ╔══════════════════════════════════════════════════════════════════════╗
# ║                         TÍTULO DO ARQUIVO                            ║
# ╠══════════════════════════════════════════════════════════════════════╣
# ║  O que este arquivo faz, em poucas linhas.                           ║
# ║                                                                      ║
# ╚══════════════════════════════════════════════════════════════════════╝
```

Todas as linhas da caixa têm a mesma largura (74 caracteres), com `╗`, `║` e
`╝` alinhados na mesma coluna.

### 2. Divisor de grupo

Separa grandes blocos dentro de um arquivo longo. Nenhum arquivo do repositório
precisa dele por enquanto.

```yaml
# ════════════════════════════════════════════════════════════════════════
# NOME DO GRUPO
# ════════════════════════════════════════════════════════════════════════
```

### 3. Subtópico

Título de uma seção menor e o nível mais usado. Exemplos: `PERMISSÕES` e
`VERIFICAÇÕES` no `ci.yml`, e `DEPENDÊNCIAS` no `.gitignore`.

```yaml
# NOME DO TÓPICO
# ──────────────
```

O sublinhado tem o mesmo tamanho do título.

## Passos manuais

Algumas configurações ficam no GitHub, não no código. Esta lista serve para
refazer o repositório do zero ou conferir se nada mudou.

1. **Desativar merge commit e rebase** (feito). Em Settings → General → Pull
   Requests, desmarque "Allow merge commits" e "Allow rebase merging". O ruleset
   já bloqueia os dois na `main`; isto tira os botões da tela de merge.

   ```sh
   gh api repos/ArturCousseau/sprout --jq '{allow_merge_commit, allow_rebase_merge}'
   # esperado: os dois false
   ```

2. **Mensagem do squash** (feito). Em Settings → General → Pull Requests, em
   "Allow squash merging", escolha "Pull request title" como mensagem padrão.

   ```sh
   gh api repos/ArturCousseau/sprout --jq '{squash_merge_commit_title, squash_merge_commit_message}'
   # esperado: PR_TITLE e BLANK
   ```

3. **Ruleset da `main`** (feito). Em Settings → Rules → Rulesets, o ruleset
   `main` tem as regras da seção [Regras da `main`](#regras-da-main), incluindo
   "Require conversation resolution before merging".

   ```sh
   gh api repos/ArturCousseau/sprout/rulesets/26653465
   ```
