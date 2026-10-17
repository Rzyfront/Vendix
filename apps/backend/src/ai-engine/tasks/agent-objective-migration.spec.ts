import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261018110000_ai_agent_objectives/migration.sql',
  ),
  'utf8',
);
const executable = sql.replace(/--[^\n]*/g, '');
const schema = readFileSync(
  resolve(__dirname, '../../../prisma/schema.prisma'),
  'utf8',
);

// Static contract only: applying this SQL twice in PostgreSQL still needs approved QA.
it('contains only additive DDL, no historical DML or cascading business-parent deletion', () => {
  expect(sql).toContain('-- DATA IMPACT:');
  expect(executable).not.toMatch(
    /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im,
  );
  expect(executable).not.toMatch(/CASCADE/i);
  expect(executable.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
});
it('guards indexes, optional job reference and named constraints for repeated deployment', () => {
  expect(executable).toContain('ADD COLUMN IF NOT EXISTS "objective_id" UUID');
  for (const statement of executable.match(
    /CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;/g,
  ) ?? [])
    expect(statement).toContain('IF NOT EXISTS');
  for (const [, name] of executable.matchAll(/ADD CONSTRAINT "([^"]+)"/g))
    expect(executable).toContain(`conname='${name}'`);
  expect(executable).not.toMatch(/ADD COLUMN[^;]+objective_id[^;]+NOT NULL/);
});
it('binds results and effects to the complete owner scope and fences import/call/operation idempotency', () => {
  expect(
    executable.match(
      /FOREIGN KEY \("objective_id","store_id","organization_id","user_id"\)/g,
    ),
  ).toHaveLength(2);
  expect(executable).toContain('"conversation_id","legacy_plan_id"');
  expect(executable).toContain('("objective_id","tool_call_id")');
  expect(executable).toContain('("operation_id")');
});
it('keeps new timestamps UTC and Prisma relation actions aligned with guarded SQL', () => {
  for (const name of [
    'ai_agent_objectives',
    'ai_agent_tool_results',
    'ai_agent_effects',
  ]) {
    const model = schema.match(
      new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`),
    )![1];
    for (const line of model.split('\n').filter((l) => /\bDateTime\b/.test(l)))
      expect(line).toContain('@db.Timestamptz(6)');
    for (const line of model.split('\n').filter((l) => /@relation\(/.test(l)))
      expect(line).toContain('onUpdate: Restrict');
  }
});
