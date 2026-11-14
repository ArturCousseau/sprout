# A demo: git × Sprout com agentes concorrentes

Roteiro e funcionamento detalhado da demonstração do Trabalho 2. Duração na
apresentação: cerca de 5 minutos.

## 1. Objetivo

Mostrar, com uma execução real, **quanto trabalho é desperdiçado** quando vários
agentes fazem commit ao mesmo tempo no git, e como a abordagem do Scion (commit
no servidor, compare-and-swap e troca de pai) evita esse desperdício.

### A mensagem em uma frase

> No git, o push é rejeitado sempre que a `main` andou, mesmo com arquivos
> diferentes. No Sprout, o servidor só rejeita quando há conflito de verdade.

### O que a demo não afirma

- **Não afirma que o git "falha".** Com retry, todos os commits acabam entrando
  no git. O que a demo mede é o **trabalho desperdiçado**: rejeições, rebases,
  tentativas e tempo.
- **Não demonstra escala.** O Sprout roda num processo só, com SQLite. A demo
  mostra o mecanismo; o Scion real faz isso distribuído.
- **Não reproduz o comportamento exato do Scion.** O artigo não detalha o que o
  Scion faz quando o compare-and-swap falha. A política de trocar o pai é nossa.
- **Não usa agentes de IA.** Os agentes da demo são rotinas com roteiro fixo,
  sem modelo de IA, que simulam o padrão de commits concorrentes de agentes
  reais.

## 2. Os cenários

| Cenário | Agentes | Arquivos    | Modo                    | Para quê                                            |
| ------- | ------- | ----------- | ----------------------- | --------------------------------------------------- |
| A       | 2       | Diferentes  | Passo a passo           | Explicar o mecanismo                                |
| B       | 10      | Diferentes  | Rápido                  | Mostrar a escala do desperdício                     |
| C       | 2       | **O mesmo** | Passo a passo ou rápido | Mostrar que o Sprout também rejeita conflitos reais |

Cada cenário roda **primeiro no git, depois no Sprout**, cada um em tela cheia.
O placar comparativo aparece só no final.

### Por que não rodar um agente de cada vez

Se o agente 1 termina antes de o agente 2 começar, o agente 2 parte da `main` já
atualizada, e o git aceita tudo. A rejeição só acontece quando dois agentes
**partem do mesmo ponto**. Por isso a demo tem dois modos: o passo a passo, que
mostra o conflito em câmera lenta com dois agentes, e o rápido, que mostra a
escala com dez.

## 3. Como os agentes do git funcionam

### Preparação

Cada execução começa do zero, e uma execução anterior não muda o resultado:

1. Apaga o que sobrou da execução anterior: `demo/tmp/central.git`, os clones
   `demo/tmp/git-agente-*` e o JSON do cenário (§6).
2. Cria o repositório central **bare** em `demo/tmp/central.git`
   (`git init --bare -b main`), com `gc.auto=0`, para o git não começar uma
   coleta de lixo no meio da execução.
3. Um clone de preparação (`demo/tmp/git-preparacao`, que não é agente) faz o
   commit inicial com um `README.md` de conteúdo fixo e autor `preparacao`,
   envia para a `main` do central e é apagado.
4. Cada agente ganha o seu próprio clone (`demo/tmp/git-agente-1`, `-2` etc.),
   com a configuração local daquele agente (`localGitConfig` em `demo/git.ts`):
   autor `agente-N`, commit sem assinatura e `gc.auto=0`.

Todo processo `git` da demo roda com `gitEnv` (`demo/git.ts`), que esconde a
configuração global e a do sistema. Por isso a identidade de cada agente fica na
configuração do próprio clone.

### O ciclo de um agente

```
1. escreve o seu arquivo (agente-N.txt, ou conflito.txt no cenário C)
   com o conteúdo "agente N"
2. git add + git commit
3. ── ponto de sincronização: espera todos os agentes chegarem aqui ──
4. git push --porcelain
5. se o push for aceito: termina
6. se for rejeitado:
     conta uma rejeição do tipo dela (fetch-first ou ref-lock)
     git pull --rebase
     se o rebase tiver conflito: git rebase --abort, conta como conflito
       real e termina
     volta ao passo 4
```

O **ponto de sincronização** (passo 3) é o que garante que todos os agentes
partem da mesma `main`. Sem ele, os agentes terminariam em momentos diferentes e
o resultado mudaria a cada execução.

Os passos 1 e 2 não rodam em paralelo: o harness faz o commit de todos os
agentes, um depois do outro, antes de criar a barreira. O resultado é o mesmo de
commits simultâneos, porque nenhum agente envia nada antes da barreira e todos
os commits ficam em cima do commit inicial. O motivo é a falha: se um commit
falhasse com outros agentes já parados na barreira, eles esperariam para sempre
por uma chegada que nunca vem, e a execução não terminaria. Com os commits antes
da barreira, uma falha nessa fase para a execução antes de qualquer agente
esperar.

### O ponto de sincronização

É uma barreira em memória (`demo/barrier.ts`): todos os agentes rodam no mesmo
processo Node, e cada um chama `arrive()` e espera. Quando o N-ésimo chega, a
barreira lê `performance.now()` uma vez e libera todos com esse mesmo instante,
o **instante da liberação**. É dele que o tempo total é medido (§6). Uma chegada
além de N é erro do harness.

### Os dois tipos de rejeição

No git, um push concorrente pode falhar de duas formas, e as duas contam como
rejeição. O código de saída é 1 nas duas, então o harness separa os tipos pela
linha de status do `git push --porcelain` (`classifyPush` em `demo/git.ts`):

| Tipo no registro | Quando acontece                                                   | Resumo na linha de status                          |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `fetch-first`    | A `main` andou antes do push: não é _fast-forward_                | `[rejected] (fetch first)`                         |
| `ref-lock`       | Dois pushes disputaram a ref ao mesmo tempo, e este perdeu o lock | `[remote rejected] (incorrect old value provided)` |

As linhas reais, com os campos separados por TAB (flag, refs, resumo), vêm do
git 2.56.0 e estão em `demo/fixtures/porcelain/`:

```
!	refs/heads/main:refs/heads/main	[rejected] (fetch first)
!	refs/heads/main:refs/heads/main	[remote rejected] (incorrect old value provided)
```

O push aceito sai com código 0 e flag ` `, `+` ou `*`. Qualquer outra saída
(resumo desconhecido, nenhuma ou mais de uma linha para `refs/heads/main`,
código que não bate com a flag) é erro do harness, não métrica.

### O `pull --rebase` e o conflito real

Depois de uma rejeição, o harness separa os casos do `git pull --rebase` pelo
código de saída e pela pasta `.git/rebase-merge`, que indica rebase em andamento
(`classifyPull` em `demo/git.ts`). O código sozinho não basta:

| Código                    | `.git/rebase-merge` | Resultado                                                             |
| ------------------------- | ------------------- | --------------------------------------------------------------------- |
| 0                         | ausente             | Rebase feito: o agente volta ao push                                  |
| 1                         | presente            | Conflito real: `git rebase --abort` e `outcome: "conflict"`           |
| qualquer outra combinação |                     | Erro do harness (por exemplo: 0 com a pasta presente, 1 sem ela, 128) |

O `git rebase --abort` desfaz o rebase interrompido, e o clone do agente que
desistiu fica com `git status` limpo. Na demo, só o cenário C chega a esse caso.

### Erro do harness

Saída inesperada do git (push fora do que "Os dois tipos de rejeição" descreve,
`pull --rebase` fora dos dois primeiros casos da tabela acima, comando de
preparação ou de commit que falhou) e teto de tentativas ultrapassado são erros
do harness, não métrica. Quando um agente falha assim, os outros não são
interrompidos: o harness espera todos terminarem (`Promise.allSettled`), para
não deixar processos `git` ainda escrevendo em `demo/tmp`. Depois disso, **não
grava o JSON**, escreve no stderr a mensagem de cada agente que falhou e sai com
**código 1**. Quando o git terminou com saída inesperada, a mensagem leva o
stderr do git, o único lugar onde ele aparece; no terminal, a execução normal
mostra só as linhas de evento e o resumo. Se o git nem chegou a rodar até o fim
(não foi possível iniciar o processo, ou ele foi morto por um sinal), não há
stderr para mostrar: a mensagem traz o comando e o motivo (`cannot start git`
ou `killed by <sinal>`).

### O teto de tentativas

Antes de cada push, o harness soma 1 ao total de pushes da execução (todos os
agentes juntos) e confere o teto de **N(N+1)/2** (`checkGitAttempts` em
`demo/git.ts`): 3 nos cenários A e C, 55 no B. Passar dele é erro do harness.

O teto vem do pior caso legítimo. Uma rejeição contada (`fetch-first` ou
`ref-lock`) só acontece quando outro agente foi aceito depois da base atual do
agente, e o `pull --rebase` seguinte traz esse aceite para a base. Então o
agente aceito em k-ésimo lugar faz no máximo k pushes, e a execução faz no
máximo 1 + 2 + … + N = N(N+1)/2. O teto era 3 × N, mas a primeira execução real
do cenário B passou de 30 tentativas sem nada de errado, e o teto mudou
(comentário na #15).

A frase "uma rejeição contada só acontece quando outro agente foi aceito" é uma
**premissa, não verificada no código do git**: nada no harness a garante. O
`classifyPush` só conta os dois resumos da tabela acima, e qualquer outra saída
do push é erro do harness; a premissa é que esses dois só aparecem depois de um
push aceito de outro agente. Ela é
sustentada pela E1 da #14 (225 de 225 rejeições por `ref-lock`, sempre com 1
aceito por onda) e pela coleta da D9 na #15 (20 execuções do cenário B, nenhuma
acima de 55). Se ela falhar, o teto dispara e a execução para com erro do
harness, em vez de contar errado.

**As ondas do cenário B.** No B, esse pior caso aconteceu em todas as execuções
observadas. A cada onda, todos os agentes que ainda faltam empurram juntos e só
um é aceito: o k-ésimo aceito faz k tentativas, e a execução chega a
N(N+1)/2 = 55. As 20 execuções da coleta da #15 deram exatamente 55 tentativas
cada. Como nenhum agente passa de k, um total de 55 só acontece quando cada um
faz exatamente k. Mesmo assim, o teste do cenário B confere total ≤ 55, e
não = 55: o teste só confere invariantes, e nada no git obriga cada onda a
reunir todos os agentes restantes.

### A largada não sai junta

A barreira libera todos os agentes no mesmo instante, mas os pushes não começam
juntos. O `spawn` do Node é síncrono: cada chamada cria o processo `git push`
antes de devolver e custa cerca de 3,7 ms. Na Fase 1 da #14 (experimento E3, 10
rodadas com 10 agentes), a primeira chamada saiu 0,02–0,07 ms depois da
liberação, mas as 10 chamadas se espalharam por 27–57 ms (mediana 31,6 ms).
Lançando os pushes de um script shell (E1), o espalhamento foi de 2,3 ms
(mediana).

- **A divisão das rejeições muda.** Na E3, cerca de metade foi `fetch-first` e
  metade `ref-lock` (46 e 44 de 90); na E1, todas as 225 foram `ref-lock`. Os
  primeiros pushes disputam o lock; os que saem depois de a `main` já ter mudado
  recebem `fetch first`.
- **A mensagem da demo não muda.** Cada onda de pushes ainda teve exatamente 1
  aceito e o resto rejeitado.
- **O tempo total do git inclui esses ~30 ms de lançamento**, que o Sprout não
  tem: o agente do Sprout faz um pedido HTTP, sem criar processo. É pouco perto
  do tempo total, mas é uma assimetria, e fica declarada aqui.

Decidimos aceitar e documentar, em vez de mudar a forma de lançar os pushes.

## 4. Como os agentes do Sprout funcionam

### Preparação

Cada execução começa do zero, como no git:

1. Apaga o que sobrou da execução anterior: o diretório de dados
   `demo/tmp/sprout-data` e o JSON do cenário (§6).
2. Sobe o servidor como processo filho da demo (`startSproutServer` em
   `demo/sprout-server.ts`), com `SPROUT_DATA_DIR=demo/tmp/sprout-data` e
   `PORT=0`. Ao abrir, o servidor recria o diretório de dados, o changeset raiz
   e a `main` apontando para ele.
3. Espera a linha `sprout server listening on <endereço>` no stdout do servidor
   e manda todos os pedidos para esse endereço. Com `PORT=0`, o sistema escolhe
   uma porta livre, e a linha traz a porta escolhida.

### O servidor como processo filho

O comando do filho é o próprio Node, com o tsx carregado por `--import`:
`process.execPath --import tsx src/server/main.ts`, a partir da raiz do
repositório. Não é o `pnpm start` nem o atalho `node_modules/.bin/tsx`: com o
atalho, o servidor roda num processo neto, e um SIGKILL no processo que a demo
conhece deixa o neto vivo, segurando a porta (experimento E2′ da Fase 1 da
#16). Com `--import`, o servidor é um processo só (E1), e o PID que a demo
conhece é o dele.

O stdout e o stderr do servidor chegam à demo por pipe. O stdout continua sendo
lido, e descartado, depois da linha de "listening": um pipe que ninguém lê
enche, e o servidor travaria ao escrever. O stderr só aparece dentro da
mensagem de erro, quando o servidor não fica pronto.

**Prontidão.** A demo espera a linha de "listening" por até 10 s
(`READY_TIMEOUT_MS`). Na Fase 1 da #16, em 10 medições no omarchy, a linha
apareceu entre 586 e 732 ms depois do início; a folga é para máquinas mais
lentas, como o runner do CI, que não foi medido. Servidor que sai antes da
linha, ou que passa do prazo, é erro do harness; no segundo caso, a demo mata o
servidor com SIGKILL e espera ele sair antes de parar.

**Encerramento.** No fim da execução, com sucesso ou com erro, a demo manda
SIGTERM ao servidor e espera ele sair por até 5 s (`STOP_TIMEOUT_MS`). Se ele
não sair, manda SIGKILL, espera, e a execução termina com erro do harness. O
servidor é encerrado **antes** de gravar o JSON: um servidor que não para dá
código 1 sem JSON. Quando a execução já tinha falhado, o erro dela é o que
aparece, e uma falha do encerramento é ignorada. Nos dois casos, nenhum
processo do servidor sobra: o encerramento só termina depois de o processo
sair.

**Ctrl+C.** Aqui está só o que foi observado. No experimento E5 da Fase 1 da
#16 (omarchy), com o servidor criado direto pelo `spawn` do Node e o stdout e o
stderr em pipe (a configuração da demo), o Ctrl+C terminou o processo que criou
o servidor e o próprio servidor, e nenhum processo sobrou. A cadeia completa do
comando, `pnpm` → `tsx` → demo → servidor, **não foi testada**.

### O ciclo de um agente

```
1. GET /refs/main                     → guarda o id como parent
2. calcula o hash do conteúdo do arquivo
3. PUT /blobs/:hash                   → grava o conteúdo
4. ── ponto de sincronização: espera todos os agentes chegarem aqui ──
5. POST /changesets { parent, author, message, changes }
6. 201: termina (aceito, possivelmente com o pai trocado pelo servidor)
   409: conta como conflito real e termina
```

Os passos 1 a 3 não rodam em paralelo, pelo mesmo motivo do git (§3): o
harness faz o GET, o hash e o PUT de todos os agentes, um depois do outro, antes
de criar a barreira, e uma falha nessa fase para a execução antes de qualquer
agente esperar. O resultado é o mesmo de pedidos simultâneos: nenhum agente
envia changeset antes da barreira, então todos leem a mesma `main`, o changeset
raiz.

Depois da barreira, cada agente faz um único `POST /changesets`, sem nenhum
`await` entre a liberação e o envio (`runAgent` em `demo/sprout-agents.ts`): a
demo chama o `fetch` de todos os agentes antes de a primeira resposta chegar.

O agente do Sprout **não faz retry**: quem resolve a troca de pai é o servidor,
dentro do `POST /changesets`, no máximo uma vez por pedido e direto para a
cabeça. O agente detecta a troca comparando o `parent` da resposta `201` com o
que enviou, e isso entra no placar.

### O registro

Cada agente gera um registro no formato do §6:

- `outcome`: `"accepted"` no `201`, `"conflict"` no `409`.
- `attempts` é sempre 1 e `rejections` é sempre `{}`: um pedido por agente, sem
  retry.
- `reparented`: no `201`, se o `parent` da resposta é diferente do enviado; no
  `409`, `false`.
- `endMs`: do instante da liberação (§3) até a resposta ser lida e validada,
  como no git.

### Erro do harness

Como no git (§3), estes casos são erro do harness, não métrica:

- status fora do esperado (`checkStatus` em `demo/sprout-responses.ts`): `200`
  no `GET /refs/main`, `201` ou `200` no `PUT /blobs/:hash`, `201` ou `409` no
  `POST /changesets`;
- corpo de resposta fora do formato: `id` que não é inteiro no
  `GET /refs/main`, `parent` que não é inteiro no `201`, `conflicts` que não é
  uma lista de textos não vazia no `409`, corpo que não é JSON;
- servidor inacessível (o `fetch` falhou: conexão recusada ou reiniciada) ou que
  morreu durante a execução;
- servidor que não fica pronto ou não para (acima).

O tratamento também é o do git: o harness espera todos os agentes terminarem
(`Promise.allSettled`), **não grava o JSON**, escreve no stderr a mensagem de
cada agente que falhou e sai com **código 1**. Uma falha antes da barreira para
a execução ali, com uma mensagem só.

## 5. Os modos

### Passo a passo (cenários A e C)

O script pausa antes de cada etapa e espera um **Enter** do apresentador. Cada
etapa imprime uma linha curta e legível:

```
[git] agente A e agente B partem da main no commit 3f2a1c
[git] agente A: push                               → aceito, main = 9b81e0
[git] agente B: push                               → REJEITADO (a main andou)
[git] agente B: pull --rebase + push               → aceito, main = 4c7d22
```

```
[sprout] agente A e agente B partem da main no changeset 1
[sprout] agente A: envia changeset (pai = 1)       → aceito, main = 2
[sprout] agente B: envia changeset (pai = 1)       → a main andou; arquivos diferentes;
                                                     o servidor troca o pai para 2
                                                   → aceito, main = 3
```

No modo passo a passo, os agentes não rodam ao mesmo tempo de verdade: o script
controla a ordem para que a turma veja cada etapa. A concorrência real fica para
o modo rápido.

### Rápido (cenário B)

Os N agentes rodam em paralelo, com o ponto de sincronização. A saída mostra uma
linha por evento (pode rolar rápido, é o efeito desejado) e termina com o
resumo daquele sistema, com os mesmos rótulos e valores do placar (§6). O
formato é este (os números variam de uma execução para outra):

```
[git] resumo: aceitos 10, rejeições 45, tentativas 55, trocas de pai -, conflitos reais 0, tempo total 1047 ms
```

## 6. O placar

Aparece no final, com os dois sistemas lado a lado. Saída de
`pnpm demo:placar --cenario B`:

```
Cenário B: 10 agentes, arquivos diferentes

                       git    sprout
aceitos                 10        10
rejeições               45         0
tentativas              55        10
trocas de pai            -         9
conflitos reais          0         0
tempo total        1047 ms     93 ms

resultados: git 14/11/2026 12:45, sprout 14/11/2026 12:45
```

_(uma execução no omarchy em 14/11/2026; a média de várias execuções é a
#21)_

O placar só lê os dois arquivos de resultados (abaixo) e calcula cada coluna
com o `summarize`: não roda git nem sobe servidor. O tempo total sai em
milissegundos inteiros, arredondado. A última linha traz a data de modificação
de cada arquivo, em hora local, para o apresentador ver se as duas execuções
são da mesma rodada.

### Definição de cada métrica

- **aceitos:** commits que entraram na `main`.
- **rejeições:** pushes recusados (git) ou pedidos recusados sem conflito real
  (Sprout; o esperado é zero).
- **tentativas:** total de pushes (git) ou de pedidos `POST /changesets` (Sprout).
- **trocas de pai:** quantas respostas `201` do Sprout vieram com um `parent`
  diferente do enviado. Cada pedido troca de pai no máximo uma vez, então, com
  10 agentes partindo da mesma cabeça, são no máximo 9 trocas. Mostra o
  trabalho que o servidor fez no lugar do agente.
- **conflitos reais:** mudanças no mesmo arquivo, rejeitadas nos dois sistemas.
- **tempo total:** do ponto de sincronização até o último agente terminar.

### O registro de cada agente

O placar sai só dos registros por agente (`AgentResult` em `demo/metrics.ts`):

| Campo        | Valor                        | Significado                                                                                               |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `agent`      | inteiro ≥ 1                  | Número do agente                                                                                          |
| `outcome`    | `"accepted"` ou `"conflict"` | Aceito, ou conflito real (o agente desistiu)                                                              |
| `attempts`   | inteiro ≥ 1                  | Pushes (git) ou pedidos `POST /changesets` (Sprout)                                                       |
| `rejections` | objeto                       | Rejeições por tipo: chaves `fetch-first` e `ref-lock` (§3), valores inteiros ≥ 0. No Sprout é sempre `{}` |
| `reparented` | booleano ou `null`           | Sprout: se o `201` veio com um `parent` diferente do enviado. Git: sempre `null`                          |
| `endMs`      | número ≥ 0                   | Milissegundos do instante da liberação (§3) até o fim do agente                                           |

Cada coluna do placar é calculada desses registros (`summarize`): **aceitos** e
**conflitos reais** contam o `outcome`; **rejeições** somam todos os tipos de
todos os agentes; **tentativas** somam `attempts`; **trocas de pai** contam os
`reparented: true` (no git, onde todos são `null`, aparece `-`); **tempo total**
é o maior `endMs`.

### O arquivo de resultados

Cada execução grava um JSON em `demo/tmp/resultados/<sistema>-<cenário>.json`
(por exemplo, `git-B.json`), com o sistema, o cenário e um registro por agente.
Exemplo ilustrativo do cenário A no git:

```json
{
  "system": "git",
  "scenario": "A",
  "agents": [
    {
      "agent": 1,
      "outcome": "accepted",
      "attempts": 1,
      "rejections": {},
      "reparented": null,
      "endMs": 41.2
    },
    {
      "agent": 2,
      "outcome": "accepted",
      "attempts": 2,
      "rejections": { "ref-lock": 1 },
      "reparented": null,
      "endMs": 97.8
    }
  ]
}
```

A leitura (`readResult` em `demo/results.ts`) confere a forma campo a campo e
falha com uma mensagem que nomeia o arquivo e, quando é o caso, o campo: arquivo
ausente, JSON inválido, campo desconhecido ou de tipo errado, tipo de rejeição
fora da lista, `reparented` diferente de `null` no git ou diferente de booleano
no Sprout, número de agentes diferente do cenário, agente repetido ou faltando.
Como o arquivo fica em `demo/tmp`, o `pnpm demo:reset` também o apaga.

No git e no Sprout, o JSON do cenário é apagado no início de cada execução
(preparação do §3 e do §4). Uma execução que para com erro do harness não deixa
arquivo nenhum, então o placar nunca lê um resultado antigo do mesmo sistema
depois de uma execução que falhou. Mas os dois arquivos são independentes: se
só um dos sistemas rodou de novo, o placar junta um resultado novo com um
antigo (por exemplo, um `git-B.json` de ontem com um `sprout-B.json` de hoje).
Por isso ele mostra a data de cada arquivo, e não recusa datas diferentes: o
apresentador decide.

### Verificação do estado final (🟡)

Depois de cada cenário, o script confere que a `main` contém exatamente os
arquivos esperados: no git, com `git ls-tree`; no Sprout, com
`GET /changesets/:id/tree`. Isso prova que nenhum commit se perdeu.

## 7. Medição para o repositório

O placar da apresentação é de uma execução. Para o repositório, o script roda
cada cenário **5 vezes** e grava a média e a variação em `docs/resultados.md`,
junto com:

- a máquina usada (processador, memória, sistema operacional);
- as versões do Node, do git e do Sprout (tag);
- a observação de que o repositório central do git roda localmente, sem rede, o
  que favorece o git em tempo.

Validada com git 2.56.0 e node 26.12.0 no omarchy (Fase 1 da #14).

## 8. Comandos

Definidos:

```
pnpm demo:reset                    apaga demo/tmp; cada execução da demo recria o que precisa
pnpm demo:git --cenario A|B|C      um cenário no git, no modo rápido
pnpm demo:sprout --cenario A|B|C   um cenário no Sprout, no modo rápido
pnpm demo:placar --cenario A|B|C   o placar do cenário, git e Sprout lado a lado
```

O `demo:git` grava `demo/tmp/resultados/git-<cenário>.json`, e o `demo:sprout`,
`demo/tmp/resultados/sprout-<cenário>.json`. Os dois saem com:

- **0:** a execução terminou e o JSON foi gravado;
- **1:** erro do harness (§3 no git, §4 no Sprout): mensagem no stderr, sem
  JSON;
- **2:** cenário ausente ou inválido: mensagem no stderr.

O `demo:placar` lê esses dois arquivos e não grava nada (§6). Sai com:

- **0:** o placar foi impresso no stdout;
- **1:** um dos arquivos está ausente, ilegível ou inválido: uma linha no
  stderr para cada arquivo com problema, com o caminho e o comando que o gera
  (por exemplo, `rode pnpm demo:git --cenario B`), e nada no stdout;
- **2:** cenário ausente ou inválido: mensagem no stderr.

Ainda são proposta, e cada nome será definido na issue indicada:

```
pnpm demo:git --cenario A --passo     cenário A no git, passo a passo (#17)
pnpm demo:sprout --cenario A --passo  cenário A no Sprout, passo a passo (#17)
pnpm demo:medir                       roda tudo 5 vezes e atualiza docs/resultados.md (#21)
```

## 9. Roteiro de fala (cerca de 5 minutos)

**0:00–0:30 · O cenário.**
"O [integrante 2] mostrou que o git rejeita um push quando a `main` andou, mesmo
com arquivos diferentes. Vamos ver isso acontecendo. Primeiro com dois agentes,
devagar."

**0:30–1:30 · Cenário A no git, passo a passo.**
Um Enter por etapa. Na rejeição: "o agente B mexeu num arquivo diferente, mas o
git só pergunta se o commit foi feito em cima da `main` atual. Não foi, então B
precisa buscar, refazer e tentar de novo."

**1:30–2:30 · Cenário A no Sprout, passo a passo.**
"Aqui não existe push. B envia o changeset dizendo 'parti do 1'. O servidor vê que
a `main` andou, confere que os arquivos são diferentes e só troca o pai. Um
compare-and-swap, sem lock. B não precisa refazer nada."

**2:30–3:45 · Cenário B, rápido.**
"Agora com dez agentes ao mesmo tempo." Roda o git, depois o Sprout, e mostra o
placar. Aponte a linha de tentativas: "todos os commits entram nos dois, mas
olhem quanto trabalho foi jogado fora no git."

**3:45–4:30 · Cenário C, o caso honesto.**
"E quando dois agentes mexem no mesmo arquivo? Nos dois sistemas, um é
rejeitado. O Scion não faz mágica: ele só evita rejeitar o que não precisa ser
rejeitado."

**4:30–5:00 · Conclusão e passagem.**
"Isso mostra o mecanismo, não a escala: o nosso servidor é um processo só, com
SQLite. O Scion real faz isso distribuído, e o [integrante 3] vai mostrar como."

## 10. Plano B

- **Grave as três execuções em vídeo** assim que a demo funcionar, e grave de
  novo se a demo mudar.
- **Deixe o vídeo aberto** antes da apresentação, pronto para trocar.
- Se algo travar ao vivo: "vou mostrar a execução que gravamos". Ensaie essa
  troca também.

## 11. Checklist antes da apresentação

- [ ] Rodar `pnpm demo:reset` e os três cenários na máquina da apresentação
- [ ] Fonte do terminal grande o bastante para o fundo da sala
- [ ] Notificações do sistema desligadas
- [ ] Wi-Fi desnecessário (tudo roda localmente), mas o vídeo de reserva salvo
      no disco, não só na nuvem
- [ ] Vídeo de reserva aberto e pausado no início
- [ ] Cronometrar a demo inteira em pelo menos dois ensaios

## 12. Perguntas prováveis

| Pergunta                                                | Resposta                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Com retry, o git também aceita tudo. Qual a vantagem?" | A vantagem é o trabalho desperdiçado: rejeições, rebases e tempo. Mostre a linha de tentativas.                                                                            |
| "Isso escala?"                                          | Não, e não é o objetivo: um processo só, com SQLite (ADR 0004). O Scion real usa o Spanner, distribuído.                                                                   |
| "O que o Scion faz quando o compare-and-swap falha?"    | O artigo não detalha. A troca de pai é uma decisão nossa, inspirada no artigo.                                                                                             |
| "Por que não fazer merge automático no mesmo arquivo?"  | Ficou fora do escopo. O artigo diz que, no caso deles, o Claude resolve esses conflitos.                                                                                   |
| "Isso não é o que uma merge queue faz?"                 | A merge queue usa uma fila com trava global. O artigo diz que eles não conseguiram manter isso na escala de agentes e passaram a testar depois do merge e antes do deploy. |
| "O git não seria mais rápido com o servidor na rede?"   | Seria mais lento. A demo roda o git localmente, sem rede, o que torna a comparação conservadora.                                                                           |
