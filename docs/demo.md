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

1. Cria um repositório central **bare** numa pasta local (`demo/tmp/central.git`),
   com um commit inicial.
2. Cada agente faz o seu próprio clone (`demo/tmp/git-agente-1`, `-2` etc.).

### O ciclo de um agente

```
1. escreve o seu arquivo (agente-N.txt, ou o mesmo arquivo no cenário C)
2. git add + git commit
3. ── ponto de sincronização: espera todos os agentes chegarem aqui ──
4. git push
5. se o push for aceito: termina
6. se for rejeitado:
     conta uma rejeição
     git pull --rebase
     se o rebase tiver conflito: conta como conflito real, desiste e termina
     volta ao passo 4
```

O **ponto de sincronização** (passo 3) é o que garante que todos os agentes
partem da mesma `main`. Sem ele, os agentes terminariam em momentos diferentes e
o resultado mudaria a cada execução.

No git, um push concorrente pode falhar de duas formas: rejeição por não ser
_fast-forward_ (a `main` andou) ou falha ao travar a ref (outro push está
atualizando a `main` naquele exato momento). As duas contam como rejeição.

## 4. Como os agentes do Sprout funcionam

### Preparação

1. Sobe o servidor com um diretório de dados vazio, em `demo/tmp/sprout-data`.
2. O servidor cria o changeset raiz e a `main` apontando para ele.

### O ciclo de um agente

```
1. GET /refs/main                     → guarda o id como parent
2. calcula o hash do conteúdo do arquivo
3. PUT /blobs/:hash                   → grava o conteúdo
4. ── ponto de sincronização: espera todos os agentes chegarem aqui ──
5. POST /changesets { parent, author, message, changes }
6. 201: termina (aceito, possivelmente com o pai trocado pelo servidor)
   409: conta como conflito real e termina
   503: conta como falha e termina
```

O agente do Sprout **não faz retry**: quem resolve a troca de pai é o servidor,
dentro do `POST /changesets`. O servidor conta, para cada pedido, quantas vezes
trocou o pai, e devolve isso na resposta para entrar no placar.

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
resumo daquele sistema.

## 6. O placar

Aparece no final, com os dois sistemas lado a lado:

```
Cenário B: 10 agentes, arquivos diferentes

                    git       sprout
aceitos              10           10
rejeições            23            0
tentativas           33           10
trocas de pai         -           14
conflitos reais       0            0
tempo total        4,1 s        0,3 s
```

_(números ilustrativos; os reais vêm da medição)_

### Definição de cada métrica

- **aceitos:** commits que entraram na `main`.
- **rejeições:** pushes recusados (git) ou pedidos recusados sem conflito real
  (Sprout; o esperado é zero).
- **tentativas:** total de pushes (git) ou de pedidos `POST /changesets` (Sprout).
- **trocas de pai:** quantas vezes o servidor do Sprout trocou o pai de um
  changeset. Mostra o trabalho que o servidor fez no lugar do agente.
- **conflitos reais:** mudanças no mesmo arquivo, rejeitadas nos dois sistemas.
- **tempo total:** do ponto de sincronização até o último agente terminar.

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

## 8. Comandos

```
pnpm demo:reset                    apaga demo/tmp e recria tudo do zero
pnpm demo:git --cenario A --passo  cenário A no git, passo a passo
pnpm demo:sprout --cenario A --passo
pnpm demo:git --cenario B          cenário B no git, rápido
pnpm demo:sprout --cenario B
pnpm demo:placar --cenario B       mostra os dois lado a lado
pnpm demo:medir                    roda tudo 5 vezes e atualiza docs/resultados.md
```

Os nomes são uma proposta; eles serão definidos na issue da demo.

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
