import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string) =>
  readFileSync(
    join(__dirname, '../../prisma/migrations', name, 'migration.sql'),
    'utf8',
  ).replace(/--[^\n]*/g, '');

// Static SQL contract only: deliberately never connects to a database.
describe('autonomy deploy migrations', () => {
  it.each([
    '20261018090000_ai_agent_trace_spans',
    '20261018100000_ai_tool_knowledge_catalog',
    '20261018110000_ai_agent_objectives',
    '20261018120000_ai_agent_script_runs',
    '20261018130000_ai_agent_recipes',
  ])(
    '%s is additive, guarded and has no historical preflight failure',
    (name) => {
      const sql = read(name);
      expect(sql).not.toMatch(
        /\b(?:DROP|TRUNCATE|DELETE|UPDATE|CASCADE|RAISE)\b(?!\s+RESTRICT)/i,
      );
      expect(sql).not.toMatch(/SELECT\s+1\s+FROM\s+ai_embeddings/i);
      expect(sql).not.toMatch(
        /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?!CONCURRENTLY|IF NOT EXISTS)/i,
      );
      expect(sql).not.toMatch(/VALIDATE CONSTRAINT/i);
      expect(sql).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
    },
  );

  it('does not scan existing embeddings or validate historical namespaces on deploy', () => {
    const sql = read('20261018100000_ai_tool_knowledge_catalog');
    expect(sql).toMatch(
      /ADD CONSTRAINT ai_embeddings_knowledge_scope_check CHECK\s*\([\s\S]*?\) NOT VALID;/,
    );
    expect(
      read('20261018100001_ai_embeddings_knowledge_scope_index'),
    ).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_embeddings_knowledge_scope_idx',
    );
  });

  it('uses concurrent indexes and an unvalidated FK on existing log/job tables', () => {
    expect(read('20261018090001_ai_engine_logs_request_index')).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_engine_logs_/,
    );
    const jobs = read('20261018110000_ai_agent_objectives');
    expect(read('20261018110001_ai_agent_tasks_objective_index')).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_agent_tasks_objective_id_idx"',
    );
    expect(jobs).toMatch(
      /ADD CONSTRAINT "ai_agent_tasks_objective_id_fkey"[^;]*NOT VALID;/,
    );
  });
  it.each([
    '20261018090001_ai_engine_logs_request_index',
    '20261018090002_ai_engine_logs_trace_index',
    '20261018100001_ai_embeddings_knowledge_scope_index',
    '20261018110001_ai_agent_tasks_objective_index',
  ])(
    '%s isolates exactly one concurrent index outside implicit batches',
    (name) => {
      const statements = read(name)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(
        /^CREATE INDEX CONCURRENTLY IF NOT EXISTS /,
      );
      expect(statements[0]).not.toMatch(
        /\b(?:BEGIN|COMMIT|ALTER|RAISE|DROP|UPDATE|DELETE|TRUNCATE|CASCADE)\b/i,
      );
    },
  );
});
