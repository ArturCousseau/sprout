# 0002: modelo de dados do core

- **Status:** aceito
- **Data:** 2026-11-06

## Contexto

O servidor precisa de um formato para changesets, de um jeito de identificar
blobs e de uma regra única para caminhos antes de existirem o blob store e o
SQLite (#9 e #10). As restrições vêm dos princípios do CLAUDE.md: o servidor é
dono de tudo, não existe push, e os commits não usam lock. Quando dois agentes
mexem em arquivos diferentes, o princípio 7 do CLAUDE.md prevê que o servidor
troque o pai do changeset para a nova cabeça da `main` (reparent) em vez de
rejeitar; essa política é detalhada no ADR 0003 (#12).

## Decisão

1. **O `id` do changeset é um inteiro sequencial atribuído pelo servidor**, não
   um hash do conteúdo. Alternativa considerada: `id` como hash do changeset,
   como no git. Rejeitada porque o `parent` faz parte do conteúdo, então cada
   reparent geraria um id novo. Ids sequenciais também são mais fáceis de ler
   na demo.
2. **O `timestamp` é uma string ISO 8601 em UTC, atribuída pelo servidor**,
   como o `id`. O core só define o tipo. Alternativa considerada: `timestamp`
   em milissegundos (`number`) ou enviado pelo agente. Rejeitada porque a
   string ISO é legível nas respostas da API sem conversão, e o servidor é quem
   atribui o `timestamp`, como o `id` (princípio 1).
3. **O changeset guarda o diff em relação ao primeiro pai**:
   `changes: [{ path, blobHash }]`, com `blobHash: null` para arquivo removido.
   Nenhum tipo do core representa a árvore inteira. Alternativa considerada:
   changeset como foto da árvore, como o commit do git aponta para uma tree.
   Rejeitada porque o reparent teria de reescrever a árvore, e detectar
   conflito exigiria comparar árvores. Com o diff, basta cruzar as listas de
   caminhos.
4. **Blobs são identificados pelo SHA-256 do conteúdo original, em hex
   minúsculo (64 caracteres).** A compressão zlib fica no blob store (#9), fora
   do core. Alternativas consideradas: SHA-1 (como o git), hex maiúsculo ou
   base64, e hash do conteúdo comprimido. Rejeitadas porque o SHA-1 tem
   colisões conhecidas; hex minúsculo é o que o `node:crypto` gera e cabe em
   URL (`PUT /blobs/:hash`) sem escapar; e o hash do conteúdo comprimido
   mudaria com o nível de compressão.
5. **Caminhos têm um formato só**: relativos, separados por `/`, sem `\`, sem
   letra de drive, sem segmento vazio, `.` ou `..` e sem barra final. O core
   normaliza e valida (`normalizePath`); caminho inválido lança
   `InvalidPathError`. Alternativas consideradas: aceitar caminhos como vierem,
   ou converter `\` em `/`. Rejeitadas porque `a/b`, `./a/b` e `a/b/` seriam
   arquivos diferentes, e o servidor deixaria dois agentes alterarem o mesmo
   arquivo sem conflito. Converter `\` esconderia pedidos malformados;
   rejeitar é mais simples de explicar.

## Consequências

- O agente não conhece o `id` nem o `timestamp` antes de enviar o pedido: os
  dois vêm na resposta do servidor.
- Ids sequenciais pressupõem um único processo gravando (ver ADR 0004,
  previsto em `docs/escopo.md`).
- Para ler a árvore de um changeset é preciso percorrer os pais (derived data,
  #13). Sem cache, isso fica mais caro a cada changeset.
- O mesmo conteúdo em dois caminhos vira um blob só.
- Todo caminho que entra no servidor precisa passar por `normalizePath`. Um
  caminho que escapar dela quebra a detecção de conflito.
- Caminhos com `\` ou letra de drive são recusados, mesmo vindos do Windows: o
  cliente precisa converter antes de enviar.
