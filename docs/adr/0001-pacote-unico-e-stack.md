# 0001: pacote único, stack e versão fixa do Node

- **Status:** aceito
- **Data:** 2026-11-05

## Contexto

O Sprout existe para uma única demonstração acadêmica: git × Sprout com vários
agentes fazendo commit ao mesmo tempo. O código tem três partes (o core com
tipos e hashing, o servidor e a demo), todas pequenas e mantidas por uma pessoa.

Um monorepo com um pacote para cada parte exigiria ordem de build entre os
pacotes e project references do TypeScript. Além disso, a demo precisa rodar
igual nas duas máquinas de desenvolvimento e na apresentação.

## Decisão

**Pacote único.** Um só `package.json`, com pastas separadas: `src/core/`,
`src/server/` e `demo/`. Não é um monorepo. O `pnpm-workspace.yaml` existe só
para guardar configurações do pnpm.

**Stack:**

- TypeScript em modo `strict`, com módulos ES (`"type": "module"`,
  `module: NodeNext`)
- pnpm como gerenciador de pacotes
- Fastify como servidor HTTP
- better-sqlite3 para os metadados (changesets e a ref `main`)
- Blobs em arquivos no disco
- vitest para testes
- ESLint (flat config, `typescript-eslint` com regras que usam tipos) e
  Prettier, com `eslint-config-prettier` para que os dois não conflitem
- tsx para rodar os scripts da demo em TypeScript

**Versões fixas:**

- Node 26 em `.node-version`, com `"engines": { "node": ">=26" }`
- `"packageManager": "pnpm@12.16.1"`
- `pnpm-lock.yaml` versionado

## Consequências

- Um único `tsconfig.json` cobre `src/` e `demo/` no typecheck, sem ordem de
  build. O build (`tsconfig.build.json`) emite só `src/`, sem os testes.
- A separação entre core, servidor e demo é só convenção de pasta: nada impede
  o core de importar o servidor. Cabe à revisão de código evitar isso.
- Com o Node e o pnpm fixos, a demo roda igual em qualquer máquina com essas
  versões.
- O TypeScript está fixado em `~6.0` porque o `typescript-eslint` 8.72.1 ainda
  não suporta o TypeScript 7 (aceita `>=4.8.4 <6.1.0`). Isso deve ser revisto
  quando o `typescript-eslint` passar a suportar o TypeScript 7.
- O pnpm 12 bloqueia scripts de instalação. O `postinstall` do esbuild
  (dependência do tsx e do vitest) fica negado em `allowBuilds`, porque o
  binário já vem num pacote opcional por plataforma.
