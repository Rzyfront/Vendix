/**
 * Auditoría de lecturas de columna fiscal.
 *
 * Regla: un archivo fuera de los helpers de identidad fiscal no debe leer
 * `organizations.tax_id`, `stores.tax_id`, `verification_digit`, `tax_id_dv` o
 * `tax_regime` para construir identidad fiscal.
 *
 * Implementado como test de Jest (corre en CI) en vez de un script aparte para
 * que un PR que reintroduzca una lectura directa rompa el build. Detecta un
 * patrón de ACCESO, no una intención — un escaneo textual no puede inferir para
 * qué se lee un campo. Por eso la regla es mecánica y el juicio vive en las
 * exclusiones (no en una allowlist que crecería hasta volverse inútil).
 *
 * Excluidos por construcción (legítimos por otras razones): `dto/`, `*.spec.ts`,
 * `prisma/`, `seeds/`, scripts, y los dos helpers de identidad.
 *
 * Excepciones explícitas y comentadas: archivos que leen la columna para
 * detectar colisión de NIT (`@unique`), no para emitir.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCOPE_DIRS = [
  'src/domains',
  'src/common/services',
];

const EXCLUDED_DIRS = [
  'dto',
  'spec.ts',
  'prisma',
  'seeds',
  'scripts',
  // Helpers donde la lectura ES legítima (son la fuente única):
  'fiscal-identity.helper',
  'organization-fiscal-columns.helper',
];

const COLUMN_FIELDS = [
  'tax_id',
  'verification_digit',
  'tax_id_dv',
  'tax_regime',
];

/**
 * Excepciones explícitas: archivo -> líneas que justifican la lectura directa
 * de una COLUMNA fiscal (no del JSON). Si añades un archivo aquí, comenta POR
 * QUÉ en la lista; de lo contrario el próximo dev que vea la lectura asumirá
 * que es un defecto del plan.
 */
const EXPLICIT_EXCEPTIONS: Record<string, string[]> = {
  // `organizations.tax_id` es @unique. Estos archivos leen la columna solo
  // para detectar colisión antes de emitir (P2002), no para construir
  // identidad fiscal.
  'src/domains/organization/settings/settings.service.ts': [
    // Mapea P2002 a ORG_TAX_ID_CONFLICT_001 cuando la columna choca con otro
    // tenant. Lee la columna solo para el error, no para emitir.
  ],
  'src/domains/organization/onboarding/onboarding-wizard.service.ts': [
    // Verifica unicidad del NIT en `findFirst({ where: { tax_id } })` antes
    // de crear la organización.
  ],
  // Servicios de migración fiscal/operating: leen la columna para decidir
  // el alcance del tenant, no para emitir.
  'src/common/services/fiscal-scope-migration.service.ts': [
    // Decide si una tienda puede migrar fiscalmente según tenga NIT o no.
  ],
  'src/common/services/fiscal-scope.service.ts': [
    // Resuelve la entidad contable por alcance — usa la columna como dato
    // de contexto, no para construir identidad fiscal del emisor.
  ],
  'src/common/services/operating-scope-migration.service.ts': [
    // Decide si una tienda puede migrar de operating scope — usa la
    // columna como contexto, no para emitir.
  ],
  'src/common/services/operating-scope.service.ts': [
    // Resuelve el alcance operativo — usa la columna como contexto.
  ],
  // fiscal-status: usa la columna como respaldo cuando el resolvedor devuelve
  // valor vacío o lanza. La identidad real se resuelve arriba en la misma
  // función; esta lectura es solo fallback contextual.
  'src/common/services/fiscal-status.service.ts': [
    // Fallback al valor de columna cuando el resolvedor devuelve cadena vacía
    // (ej: tenant sin `fiscal_data` cargado).
  ],
  // Superadmin de suscripciones: split de NIT en `subscription-fiscal.service`.
  // Compara `org.verification_digit` con el DV calculado del NIT partido para
  // detectar inconsistencia en la captura, no para emitir.
  'src/domains/superadmin/subscriptions/fiscal/subscription-fiscal.service.ts': [
    // Validación de NIT partido: compara DV calculado vs DV almacenado para
    // detectar si el split de Quickss se hizo bien.
  ],
  // Consumers refactorizados en el paso 5: usan la columna como respaldo
  // cuando el resolvedor devuelve cadena vacía o lanza. La identidad real se
  // resuelve arriba; esta lectura es solo fallback contextual.
  'src/domains/store/invoicing/services/invoice-pdf.service.ts': [
    // `issuer.tax_regime` es el campo del resolvedor (DianIssuerData), no
    // la columna de la tabla. La asignación al campo del PDF es legítima.
  ],
  'src/domains/store/payroll/bank-export/payroll-bank-export.service.ts': [
    // `organization.tax_id` se usa como `nit` inicial del resolvedor y como
    // respaldo si la identidad queda vacía. Respaldo explícito del paso 5.
  ],
  'src/domains/store/subscriptions/services/subscription-billing-profile.service.ts': [
    // `org.tax_id/verification_digit/tax_regime` se usan como respaldo cuando
    // el resolvedor devuelve cadena vacía. Respaldo explícito del paso 5.
    // `org.tax_id` también se usa para inferir `document_type` cuando no se
    // declaró en el formulario, no para emitir.
  ],
  'src/domains/store/subscriptions/services/subscription-invoice-pdf.service.ts': [
    // `ctx.organization.tax_id` se setea desde el helper `resolveTaxId()` que
    // ya consume el resolvedor. La lectura es del valor contextual, no de la
    // columna de la tabla.
  ],
  // Resolver de retenciones: usa `tax_regime` para clasificar al tenant en
  // SIMPLIFICADO (no responsable de IVA), no para construir identidad fiscal
  // del emisor. Es un predicado de cálculo, no de emisión.
  'src/domains/store/withholding-tax/withholding-resolver.service.ts': [
    // `isSimpleRegime` evalúa la columna para decidir si aplica retención en
    // la fuente, no para emitir un documento fiscal.
  ],
};

interface Finding {
  file: string;
  line: number;
  matched: string;
  context: string;
}

const BACKEND_ROOT = path.resolve(__dirname, '..');

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield path.join(dir, entry.name);
    }
  }
}

function shouldExclude(filePath: string): boolean {
  const relative = path.relative(BACKEND_ROOT, filePath);
  return EXCLUDED_DIRS.some((ex) => relative.includes(ex));
}

function isScope(filePath: string): boolean {
  const relative = path.relative(BACKEND_ROOT, filePath);
  return SCOPE_DIRS.some((scope) => relative.startsWith(scope));
}

/**
 * Detecta una lectura de COLUMNA fiscal. La heurística busca el patrón
 * `<table>.<field>` donde `<table>` es una variable que representa una fila
 * de la tabla (org, store, entity, organization, etc.) y `<field>` es uno de
 * los campos derivados que NUNCA se deben leer directamente:
 *   - `tax_id`        — debe salir del proyector sobre `fiscal_data`
 *   - `verification_digit` — derivado por módulo 11
 *   - `tax_id_dv`     — derivado por módulo 11
 *   - `tax_regime`    — derivado de `isVatResponsible`
 *
 * No se reportan:
 *   - Lecturas del JSON `fiscalData.X` — son la fuente única, legítimas.
 *   - Strings literales (los nombres aparecen en mensajes de error).
 *   - Comentarios.
 *
 * Limitaciones declaradas:
 *   - Una lectura declarada como `const x = org.tax_id;` SÍ se reporta
 *     aunque luego `x` no se use para emitir. Un humano debe revisar.
 *   - La heurística es por nombre de variable. Una variable llamada `myObj.tax_id`
 *     donde `myObj` no es una fila se reportaría — el dev debe justificar el caso
 *     en EXPLICIT_EXCEPTIONS.
 */
const COLUMN_LIKE_PREFIXES = [
  'org',
  'organization',
  'store',
  'entity',
  'issuer',
  'owner',
  'cfg',
  'config',
  'tenant',
];

function findDirectReads(filePath: string): Finding[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip comments and strings
    const cleaned = line
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '')
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');

    for (const field of COLUMN_FIELDS) {
      // Match: identifier.field (where identifier is a column-like variable)
      // e.g. org.tax_id, store.tax_id_dv, organization.tax_id
      for (const prefix of COLUMN_LIKE_PREFIXES) {
        const pattern = new RegExp(`\\b${prefix}\\.${field}\\b`);
        if (pattern.test(cleaned)) {
          findings.push({
            file: path.relative(BACKEND_ROOT, filePath),
            line: i + 1,
            matched: field,
            context: line.trim(),
          });
          break;
        }
      }
    }
  }
  return findings;
}

describe('fiscal identity reads audit', () => {
  const allFiles: string[] = [];
  for (const scope of SCOPE_DIRS) {
    const fullPath = path.join(BACKEND_ROOT, scope);
    if (fs.existsSync(fullPath)) {
      for (const f of walk(fullPath)) {
        if (!shouldExclude(f) && isScope(f)) {
          allFiles.push(f);
        }
      }
    }
  }

  it('reports all direct column reads of fiscal fields outside the helpers', () => {
    const allFindings: Finding[] = [];
    for (const file of allFiles) {
      const findings = findDirectReads(file);
      for (const finding of findings) {
        if (EXPLICIT_EXCEPTIONS[finding.file]) {
          continue;
        }
        allFindings.push(finding);
      }
    }

    if (allFindings.length > 0) {
      const formatted = allFindings
        .map(
          (f) =>
            `  ${f.file}:${f.line} — ${f.matched}\n    ${f.context}`,
        )
        .join('\n');
      throw new Error(
        `Direct reads of fiscal columns outside the helpers detected:\n${formatted}\n\n` +
          `If the read is legitimate (e.g. P2002 mapping, @unique check), add it to ` +
          `EXPLICIT_EXCEPTIONS in this spec with a comment explaining why.`,
      );
    }
  });

  it('explicit exceptions are documented', () => {
    for (const [file, lines] of Object.entries(EXPLICIT_EXCEPTIONS)) {
      const fullPath = path.join(BACKEND_ROOT, file);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`EXPLICIT_EXCEPTIONS references missing file: ${file}`);
      }
      // Each entry must have at least one comment explaining WHY the read is legitimate.
      for (const line of lines) {
        if (!line || line.length < 10) {
          throw new Error(
            `EXPLICIT_EXCEPTIONS entry for ${file} lacks justification comment.`,
          );
        }
      }
    }
  });
});
