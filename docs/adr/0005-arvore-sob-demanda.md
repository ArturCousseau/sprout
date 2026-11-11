# 0005: árvore calculada sob demanda, com cache em memória

- **Status:** aceito
- **Data:** 2026-11-11

## Contexto

O changeset guarda só o diff em relação ao primeiro pai (ADR 0002, decisão 3).
O `GET /changesets/:id/tree` (#13) precisa devolver a árvore inteira. Pelo
princípio 5 do CLAUDE.md, essa árvore é a árvore do pai com as mudanças
aplicadas, calculada sob demanda e guardada em cache. O ADR 0002 já previa o
custo: sem cache, ler a árvore fica mais caro a cada changeset.

**O que vem do Scion:** o `docs/escopo.md` (§2) põe "Derived data recursiva (só
a árvore de arquivos)" entre o que o Sprout demonstra, e "Cache em camadas
(daemon, cache regional, servidor)" entre o que ele não demonstra. O escopo não
cita o artigo sobre como o Scion calcula ou guarda derived data, e este ADR
não afirma nada sobre isso.

**O que é decisão do Sprout:** tudo o que está abaixo.

Fato medido antes de decidir (experimento E1, em `fce04f7`): o
`POST /changesets` aceita `blobHash: null` para um caminho que nunca existiu.
Ele responde `201` e grava a linha em `changes` com `blob_hash` NULL.

## Decisão

1. **Cache num `Map` em memória, no processo do servidor, nunca
   invalidado.** A chave é o id do changeset e o valor é a árvore. O
   `buildApp` cria um cache por app, e o servidor tem um app por processo. O
   cache nunca é invalidado porque um changeset nunca muda depois de criado. Um
   id que não existe não entra no cache, para que seja encontrado quando for
   criado. As árvores em cache são compartilhadas, então aplicar as mudanças
   sempre gera um `Map` novo e nunca altera o do pai.
2. **Remover um caminho ausente na árvore do pai é ignorado no cálculo.** É o
   caso do E1. O `POST /changesets` não muda: continua aceitando essa remoção.
3. **Cálculo por laço, não por recursão.** O servidor sobe pelos pais até o
   primeiro ancestral que já está no cache, ou até passar da raiz, cuja base é
   a árvore vazia. Depois aplica as mudanças descendo, do mais antigo para o
   pedido, e guarda no cache cada árvore calculada, inclusive as
   intermediárias. "Recursiva", no princípio 5, descreve a definição dos dados
   (a árvore de um changeset depende da do pai), não a técnica de cálculo. O
   laço dá o mesmo resultado, sem depender da profundidade da pilha, que
   cresceria com a história. No tamanho da demo (cerca de 20 changesets), a
   recursão também funcionaria; o laço é escolhido para não depender do
   tamanho da história. O cálculo acontece só no
   `GET /changesets/:id/tree`, nunca no `POST /changesets`, e nada é gravado no
   banco.

## Consequências

- O cache cresce sem limite e se perde no reinício. Depois de reiniciar, a
  primeira leitura de cada árvore lê de novo os changesets até a raiz.
- Cada árvore em cache é uma cópia inteira. A memória cresce com changesets ×
  arquivos. Isso não foi medido na demo.
- Um agente que remove um arquivo que não existe recebe `201`, e a árvore
  simplesmente ignora a remoção.
- Um `INSERT` direto no banco, fora do `createChangeset` (hoje só os testes
  fazem isso), não invalida o cache.
- Com o pai em cache, ler a árvore do filho lê um changeset só. O contador de
  leituras é injetado no `createTreeReader`, sem `vi.mock`. O fato de o POST
  não calcular a árvore é conferido por grep, não por teste.
- A ordem das entradas usa `<` do JavaScript (unidades UTF-16). Ela pode
  divergir da ordem BINARY do SQLite em caminhos com caracteres fora do BMP.
  Não foi testado; na demo, os caminhos são ASCII.
