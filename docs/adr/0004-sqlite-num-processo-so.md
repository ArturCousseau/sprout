# 0004: SQLite num processo só

- **Status:** aceito
- **Data:** 2026-11-06

## Contexto

O servidor precisa guardar os changesets (diff em relação ao primeiro pai,
princípio 3 do CLAUDE.md) e a ref `main`, que será avançada por
compare-and-swap (princípio 6). Os blobs já ficam em arquivos no disco (#9);
faltam os metadados (#10).

**O que vem do artigo da Anthropic** (resumido em `docs/escopo.md` §1 e §2): no
Scion, o commit é criado no servidor, sem push, e a `main` avança por
compare-and-swap, sem lock. O artigo não detalha o que acontece quando o
compare-and-swap falha.

**O que é decisão do Sprout:** todo o armazenamento descrito aqui. O resumo do
artigo não diz como o Scion guarda os metadados, e este ADR não afirma nada
sobre isso. A política de reparent (#12) também é do Sprout.

Restrições: a demo roda numa máquina só, com um processo de servidor, e a
entrega é em 26/11/2026. A stack (Node 26, better-sqlite3) já foi fixada no
ADR 0001.

## Decisão

1. **Os metadados ficam num arquivo SQLite, aberto pelo próprio processo do
   servidor** (`<SPROUT_DATA_DIR>/sprout.db`). Alternativas consideradas:
   Postgres, rejeitado porque exige outro serviço rodando na apresentação; e
   arquivos JSON, rejeitados porque não têm transação nem constraints, e a
   unicidade de caminho e a existência do pai teriam de ser checadas à mão.
2. **A biblioteca é o `better-sqlite3`**, como fixado no ADR 0001. A versão
   13 traz binários prontos por plataforma dentro do pacote, sem script de
   instalação, e os tipos vêm de `@types/better-sqlite3`. Alternativa
   considerada: o `node:sqlite`, embutido no Node, sem dependência nativa e
   também síncrono. Rejeitado por ora porque, no Node 26.12.0, a documentação
   o marca como "Stability: 1.2 - Release candidate", ainda dentro do nível
   experimental, que "is not subject to semantic versioning rules"
   (nodejs.org, `sqlite.html` e `documentation.html` da v26.12.0).
3. **`PRAGMA foreign_keys = ON` explícito, a cada conexão.** A build atual do
   better-sqlite3 já liga as chaves estrangeiras: ela é compilada com
   `SQLITE_DEFAULT_FOREIGN_KEYS=1` (`deps/defines.gypi` do pacote), e uma
   conexão nova, sem pragma nenhum, responde `foreign_keys` = 1. Por isso o
   pragma não muda o comportamento de hoje, e o teste de pai inexistente passa
   com ou sem ele. O pragma fica explícito para não depender da build nem do
   driver: no SQLite o padrão é desligado e só muda por opção de compilação, e
   a documentação recomenda "not depend on the default setting" (sqlite.org,
   `pragma.html`). Alternativa considerada: confiar no padrão da build.
   Rejeitada porque, com outra build do better-sqlite3 ou outro driver (como o
   `node:sqlite`), a checagem passaria a depender de uma opção de compilação
   que o Sprout não controla.
4. **`journal_mode` e `synchronous` ficam nos padrões (DELETE e FULL).**
   Alternativa considerada: WAL com `synchronous = NORMAL`, recomendada pelo
   better-sqlite3 para desempenho (`docs/performance.md` do projeto).
   Rejeitada por ora: o ganho não foi medido no Sprout; com NORMAL, "a
   transaction committed in WAL mode ... might roll back following a power
   loss or system crash" (`pragma.html`); o WAL cria os arquivos `-wal` e
   `-shm` ao lado do banco; e não vale para os bancos `:memory:` dos testes,
   que só aceitam MEMORY ou OFF. Reavaliar se a medição da demo (#21) mostrar
   que o custo do commit pesa.
5. **As escritas são serializadas num processo só.** Alternativa considerada:
   vários processos ou réplicas. Rejeitada por escopo (`docs/escopo.md` §2 e
   §9). A API do better-sqlite3 é síncrona: cada consulta roda até o fim na
   thread principal, e enquanto isso o event loop não atende outra requisição.
   Consequência para o compare-and-swap (#11): ler a cabeça da `main` e rodar o
   `UPDATE ... WHERE value = <esperado>` no mesmo trecho síncrono nunca vê o
   CAS falhar, porque nada se intercala. Ele só falha se houver um `await`
   entre as duas coisas. O reparent da #12 também não vem de uma falha de CAS
   dentro de um trecho síncrono: vem do `parent` desatualizado que o cliente
   envia (ele leu a `main`, outro commit entrou, e só depois ele enviou).
6. **Sem `CHECK (parent < id)` no schema.** Alternativa considerada: a
   constraint, para impedir ciclos entre changesets. Rejeitada porque quebraria
   a #12: o reparent pode dar a um changeset já criado um pai com id maior.
7. **O id é `INTEGER PRIMARY KEY`, sem `AUTOINCREMENT`.** O SQLite escolhe "one
   larger than the largest ROWID" e começa em 1. Alternativa considerada:
   `AUTOINCREMENT`, que só serve para impedir o reuso de ids de linhas
   apagadas e "should be avoided if not strictly needed" (sqlite.org,
   `autoinc.html`). Rejeitada porque o Sprout nunca apaga changesets.
8. **O schema é criado com `CREATE TABLE IF NOT EXISTS`, sem sistema de
   migração.** O changeset raiz (id 1, `author` "sprout", `message` "root") e a
   `main` apontando para ele são criados numa única transação, só quando a
   `main` ainda não existe. Alternativa considerada: um migrador com versões
   do schema. Rejeitada por escopo: o banco da demo pode ser apagado e
   recriado.

## Consequências

- **Não demonstra escala horizontal.** O Sprout mostra a separação entre criar
  o changeset e avançar a `main`, não a escala. Um servidor só, um arquivo só.
- Uma consulta lenta bloqueia todas as requisições, inclusive as de blobs.
  Nesta etapa as consultas são por chave primária.
- O banco recusa sozinho: pai inexistente, caminho repetido no mesmo
  changeset e qualquer ref que não seja `main`.
- Mudar o schema exige apagar o `sprout.db`: com `IF NOT EXISTS`, uma tabela
  que já existe não é alterada.
- Revisar a decisão 2 quando o `node:sqlite` ficar estável, e a decisão 4
  depois das medições da demo.
