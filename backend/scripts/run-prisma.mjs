import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const prismaSchemaPath = resolve(process.cwd(), 'prisma', 'schema.prisma');

function usesSqliteProvider() {
  if (!existsSync(prismaSchemaPath)) {
    return false;
  }
  const schema = readFileSync(prismaSchemaPath, 'utf8');
  return /datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*"sqlite"/m.test(schema);
}

function ensureSqliteDatabaseUrl(env) {
  const current = env.DATABASE_URL?.trim() ?? '';
  if (current.startsWith('file:')) {
    return env;
  }

  return {
    ...env,
    DATABASE_URL: 'file:./prisma/dev.db',
  };
}

const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error('Missing Prisma command. Example: node scripts/run-prisma.mjs generate');
  process.exit(1);
}

let env = { ...process.env };
if (usesSqliteProvider()) {
  env = ensureSqliteDatabaseUrl(env);
}

const result = spawnSync('npx', ['prisma', ...prismaArgs], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}
process.exit(1);
