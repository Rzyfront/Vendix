/**
 * Smoke test para el mapper per-row del bulk service.
 * Verifica las 4 ramas: duplicate_email, duplicate_document, conflict, internal.
 */
import { mapBulkErrorToUserCopy } from '../src/domains/store/customers/customers-bulk.service';

const cases: Array<{
  name: string;
  code: string;
  details?: Record<string, unknown>;
  expect: { code: string; messageIncludes: string; suggestionIncludes?: string };
}> = [
  {
    name: 'duplicate_email con value',
    code: 'SYS_CONFLICT_001',
    details: { kind: 'email', value: 'juan@x.com' },
    expect: {
      code: 'duplicate_email',
      messageIncludes: 'juan@x.com',
      suggestionIncludes: 'Usa otro correo',
    },
  },
  {
    name: 'duplicate_email sin value',
    code: 'SYS_CONFLICT_001',
    details: { kind: 'email' },
    expect: {
      code: 'duplicate_email',
      messageIncludes: 'este correo',
      suggestionIncludes: 'Usa otro correo',
    },
  },
  {
    name: 'duplicate_document con value+type',
    code: 'SYS_CONFLICT_001',
    details: { kind: 'document', value: '12345678', type: 'CC' },
    expect: {
      code: 'duplicate_document',
      messageIncludes: '12345678',
      messageIncludes2: 'CC',
      suggestionIncludes: 'Verifica',
    },
  },
  {
    name: 'SYS_CONFLICT_001 genérico (sin kind)',
    code: 'SYS_CONFLICT_001',
    details: {},
    expect: {
      code: 'conflict',
      messageIncludes: 'conflicto',
    },
  },
  {
    name: 'SYS_CONFLICT_001 sin details',
    code: 'SYS_CONFLICT_001',
    details: undefined,
    expect: {
      code: 'conflict',
      messageIncludes: 'conflicto',
    },
  },
  {
    name: 'cualquier otro código',
    code: 'INTERNAL_ERROR',
    details: undefined,
    expect: {
      code: 'internal',
      messageIncludes: 'Error interno',
    },
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = mapBulkErrorToUserCopy(c.code, c.details);
  const okCode = got.code === c.expect.code;
  const okMsg = got.message.includes(c.expect.messageIncludes);
  const okSug =
    !c.expect.suggestionIncludes ||
    (got.suggestion ?? '').includes(c.expect.suggestionIncludes);
  if (okCode && okMsg && okSug) {
    console.log(`[OK]   ${c.name}`);
    console.log(`      → ${JSON.stringify(got)}`);
    pass++;
  } else {
    console.log(`[FAIL] ${c.name}`);
    console.log(`      got:      ${JSON.stringify(got)}`);
    console.log(`      expected: code=${c.expect.code}, msg includes "${c.expect.messageIncludes}"${c.expect.suggestionIncludes ? `, sug includes "${c.expect.suggestionIncludes}"` : ''}`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} casos pasaron.`);
if (fail > 0) process.exit(1);
