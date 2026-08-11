/**
 * Smoke test para el mapper per-row del bulk service y para el helper
 * getFieldAndColumnForCode. Cubre todas las ramas para que un cambio en
 * el copy o en la columna asignada se detecte sin necesidad de backend
 * corriendo ni JWT.
 */
import { mapBulkErrorToUserCopy } from '../src/domains/store/customers/customers-bulk.service';
import { getFieldAndColumnForCode } from '../src/common/validators/bulk-validation.util';

let pass = 0;
let fail = 0;

const check = (name: string, got: unknown, expect: Record<string, unknown>) => {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(expect)) {
    const actual = (got as any)[k];
    if (typeof v === 'string' && v.startsWith('contains:')) {
      if (typeof actual !== 'string' || !actual.includes(v.slice('contains:'.length))) {
        errors.push(`${k} debería contener "${v.slice('contains:'.length)}", got: ${JSON.stringify(actual)}`);
      }
    } else if (actual !== v) {
      errors.push(`${k} esperado ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (errors.length === 0) {
    console.log(`[OK]   ${name}`);
    pass++;
  } else {
    console.log(`[FAIL] ${name}`);
    console.log(`      got: ${JSON.stringify(got)}`);
    for (const e of errors) console.log(`        - ${e}`);
    fail++;
  }
};

// ─── mapBulkErrorToUserCopy ──────────────────────────────────────────
console.log('── mapBulkErrorToUserCopy ──');
check('duplicate_email con value', mapBulkErrorToUserCopy('SYS_CONFLICT_001', { kind: 'email', value: 'juan@x.com' }), {
  code: 'duplicate_email',
  message: 'contains:juan@x.com',
  suggestion: 'contains:Usa otro correo',
});
check('duplicate_email sin value', mapBulkErrorToUserCopy('SYS_CONFLICT_001', { kind: 'email' }), {
  code: 'duplicate_email',
  message: 'contains:este correo',
  suggestion: 'contains:Usa otro correo',
});
check('duplicate_document con value+type', mapBulkErrorToUserCopy('SYS_CONFLICT_001', { kind: 'document', value: '12345678', type: 'CC' }), {
  code: 'duplicate_document',
  message: 'contains:12345678',
  suggestion: 'contains:Verifica',
});
// Que el tipo DIAN aparezca en el mensaje
{
  const got = mapBulkErrorToUserCopy('SYS_CONFLICT_001', { kind: 'document', value: '12345678', type: 'CC' });
  if (got.message.includes('CC')) {
    console.log('[OK]   duplicate_document incluye el tipo DIAN en el mensaje');
    pass++;
  } else {
    console.log(`[FAIL] duplicate_document debe incluir el tipo "CC" en el mensaje, got: ${got.message}`);
    fail++;
  }
}
check('SYS_CONFLICT_001 sin kind (genérico)', mapBulkErrorToUserCopy('SYS_CONFLICT_001', {}), {
  code: 'conflict',
  message: 'contains:conflicto',
});
check('SYS_CONFLICT_001 sin details', mapBulkErrorToUserCopy('SYS_CONFLICT_001', undefined), {
  code: 'conflict',
  message: 'contains:conflicto',
});
check('cualquier otro código', mapBulkErrorToUserCopy('INTERNAL_ERROR', undefined), {
  code: 'internal',
  message: 'contains:Error interno',
});

// ─── getFieldAndColumnForCode ────────────────────────────────────────
console.log('\n── getFieldAndColumnForCode ──');
check('duplicate_email → email / Correo', getFieldAndColumnForCode('duplicate_email'), {
  field: 'email',
  column: 'Correo',
});
check('duplicate_document → document_number / Documento', getFieldAndColumnForCode('duplicate_document'), {
  field: 'document_number',
  column: 'Documento',
});
check('duplicate_email_in_file → email / Correo', getFieldAndColumnForCode('duplicate_email_in_file'), {
  field: 'email',
  column: 'Correo',
});
check('conflict → general / General', getFieldAndColumnForCode('conflict'), {
  field: 'general',
  column: 'General',
});
check('internal → general / General', getFieldAndColumnForCode('internal'), {
  field: 'general',
  column: 'General',
});
check('cualquier otro → general / General', getFieldAndColumnForCode('cualquier-otro'), {
  field: 'general',
  column: 'General',
});

console.log(`\n${pass}/${pass + fail} casos pasaron.`);
if (fail > 0) process.exit(1);
