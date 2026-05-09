/* eslint-disable no-console */
/**
 * Operating Scope Audit (Phase 0)
 *
 * Reproducible read-only audit that scans the Vendix repo for violations of
 * the operating-scope contract (STORE vs ORGANIZATION) defined in
 * `/Users/rzy/.claude/plans/s-coincido-no-se-proud-pie.md`.
 *
 * It detects 5 classes of violations:
 *   1. DTOs that declare `store_id` in body
 *   2. Backend services under domains/store|organization that do NOT inject
 *      OperatingScopeService
 *   3. Usages of `prisma.withoutScope()`
 *   4. Frontend services in private/modules/organization/** that build URLs
 *      containing `/store/` (zero-rule violation: ORG_ADMIN -> /store/*)
 *   5. Frontend services in private/modules/store/** that build URLs
 *      containing `/organization/` (zero-rule violation: STORE_ADMIN -> /organization/*)
 *
 * Usage:
 *   npx ts-node apps/backend/scripts/operating-scope-audit.ts
 *
 * Output:
 *   - Markdown report printed to stdout
 *   - Markdown report written to:
 *     apps/backend/scripts/operating-scope-audit-report.md
 *
 * The script does not modify any source file.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Repo roots — resolved relative to this file so the script is portable.
// ---------------------------------------------------------------------------
const SCRIPT_DIR = __dirname;
const BACKEND_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..', '..');
const BACKEND_SRC = path.join(BACKEND_DIR, 'src');
const FRONTEND_SRC = path.join(REPO_ROOT, 'apps', 'frontend', 'src');
const REPORT_PATH = path.join(SCRIPT_DIR, 'operating-scope-audit-report.md');

// DTOs claramente org-scoped donde `store_id` puede ser legítimo en body
// (ej. crear una tienda dentro de una organización, asociar algo a una tienda
// concreta cuando ese contexto NO viene de RequestContext).
// La auditoría los excluye para no inflar falsos positivos.
const STORE_ID_BODY_DTO_ALLOWLIST = new Set<string>([
  'CreateStoreDto',
  'UpdateStoreDto',
]);

interface DtoFinding {
  file: string;
  line: number;
  dto: string;
  required: boolean;
}

interface ServiceScopeFinding {
  file: string;
  service: string;
  injects: boolean;
}

interface WithoutScopeFinding {
  file: string;
  line: number;
  snippet: string;
}

interface CrossDomainUrlFinding {
  file: string;
  line: number;
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relFromRepo(absPath: string): string {
  return path.relative(REPO_ROOT, absPath);
}

function walk(dir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;

  const stack: string[] = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') {
          continue;
        }
        stack.push(full);
      } else if (e.isFile() && predicate(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

// ---------------------------------------------------------------------------
// 1. DTOs con `store_id` en body
// ---------------------------------------------------------------------------
function auditDtosWithStoreId(): DtoFinding[] {
  const findings: DtoFinding[] = [];
  const dtoFiles = walk(BACKEND_SRC, (p) => /\/dto\/.*\.ts$/.test(p) && !p.endsWith('.d.ts'));

  // Match `class XxxDto` or `class XxxDto extends ...`
  const classRegex = /\bexport\s+class\s+([A-Z]\w*Dto)\b/;
  // Match `store_id: number` or `store_id?: number`. We deliberately avoid
  // matching `store_id?: number | null` only (still want to flag those).
  const storeIdRegex = /^\s*store_id(\?)?\s*:\s*number(\s*\|\s*null)?\s*;?\s*$/;

  for (const file of dtoFiles) {
    const lines = readLines(file);
    let currentClass: string | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const classMatch = line.match(classRegex);
      if (classMatch) {
        currentClass = classMatch[1];
        braceDepth = 0;
      }

      // Track brace depth crudely so we know when class block ends
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') {
          braceDepth--;
          if (braceDepth <= 0 && currentClass) {
            currentClass = null;
            braceDepth = 0;
          }
        }
      }

      if (!currentClass) continue;
      if (STORE_ID_BODY_DTO_ALLOWLIST.has(currentClass)) continue;

      const m = line.match(storeIdRegex);
      if (m) {
        // Skip declarations preceded by `private`/`readonly` constructor params
        // — the regex above is for class fields, but constructor params on
        // their own line could match. A quick guard:
        const trimmed = line.trim();
        if (/^(private|public|protected|readonly)\b/.test(trimmed)) continue;
        // Skip if it's clearly inside an interface (filename hint).
        // We also skip when the field has @Exclude or is in a Response DTO
        // (responses are output, not body).
        if (/Response(Dto)?/.test(currentClass)) continue;
        findings.push({
          file: relFromRepo(file),
          line: i + 1,
          dto: currentClass,
          required: !m[1], // no `?` -> required
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 2. Servicios backend que NO inyectan OperatingScopeService
// ---------------------------------------------------------------------------
function auditServicesMissingOperatingScope(): ServiceScopeFinding[] {
  const findings: ServiceScopeFinding[] = [];
  const roots = [
    path.join(BACKEND_SRC, 'domains', 'store'),
    path.join(BACKEND_SRC, 'domains', 'organization'),
  ];

  const files: string[] = [];
  for (const root of roots) {
    files.push(...walk(root, (p) => p.endsWith('.service.ts') && !p.endsWith('.spec.ts')));
  }

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');

    // Extract the first @Injectable class name in the file (close enough for
    // the audit; service files are typically a single class).
    const classMatch = content.match(/\bexport\s+class\s+(\w+Service)\b/);
    const serviceName = classMatch ? classMatch[1] : path.basename(file);

    const injects =
      /OperatingScopeService/.test(content) &&
      /(constructor\s*\([^)]*OperatingScopeService|private\s+\w+\s*:\s*OperatingScopeService)/m.test(
        content,
      );

    findings.push({
      file: relFromRepo(file),
      service: serviceName,
      injects,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Uso de `prisma.withoutScope()`
// ---------------------------------------------------------------------------
function auditWithoutScopeUsage(): WithoutScopeFinding[] {
  const findings: WithoutScopeFinding[] = [];
  const files = walk(BACKEND_SRC, (p) => p.endsWith('.ts') && !p.endsWith('.d.ts'));

  // Skip the OperatingScopeService and BasePrismaService themselves — those
  // are the canonical implementation, not consumers.
  const allowFile = (p: string) =>
    !/operating-scope\.service\.ts$/.test(p) &&
    !/base-prisma\.service\.ts$/.test(p) &&
    !/store-prisma\.service\.ts$/.test(p) &&
    !/organization-prisma\.service\.ts$/.test(p) &&
    !/ecommerce-prisma\.service\.ts$/.test(p) &&
    !/global-prisma\.service\.ts$/.test(p);

  for (const file of files) {
    if (!allowFile(file)) continue;
    const lines = readLines(file);
    for (let i = 0; i < lines.length; i++) {
      if (/withoutScope\s*\(/.test(lines[i])) {
        findings.push({
          file: relFromRepo(file),
          line: i + 1,
          snippet: lines[i].trim().slice(0, 200),
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 4. Frontend ORG_ADMIN -> /store/*
// 5. Frontend STORE_ADMIN -> /organization/*
// ---------------------------------------------------------------------------
function auditFrontendCrossDomain(
  scanRoot: string,
  badNeedle: RegExp,
): CrossDomainUrlFinding[] {
  const findings: CrossDomainUrlFinding[] = [];
  const files = walk(scanRoot, (p) => p.endsWith('.ts') && !p.endsWith('.d.ts') && !p.endsWith('.spec.ts'));

  // We look at string literals. Match `'...badNeedle...'`, `"...badNeedle..."`,
  // or backtick template strings.
  const stringLiteralRegex = /(['"`])([^'"`\n]*?)\1/g;

  for (const file of files) {
    const lines = readLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Quick reject: must contain the needle at all
      if (!badNeedle.test(line)) continue;
      // Reset regex state because of /g
      badNeedle.lastIndex = 0;

      let m: RegExpExecArray | null;
      stringLiteralRegex.lastIndex = 0;
      while ((m = stringLiteralRegex.exec(line)) !== null) {
        const literal = m[2];
        if (badNeedle.test(literal)) {
          findings.push({
            file: relFromRepo(file),
            line: i + 1,
            url: literal.length > 160 ? literal.slice(0, 160) + '…' : literal,
          });
          badNeedle.lastIndex = 0;
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------
function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function renderReport(args: {
  dtos: DtoFinding[];
  services: ServiceScopeFinding[];
  withoutScope: WithoutScopeFinding[];
  orgToStore: CrossDomainUrlFinding[];
  storeToOrg: CrossDomainUrlFinding[];
}): string {
  const { dtos, services, withoutScope, orgToStore, storeToOrg } = args;

  const servicesMissing = services.filter((s) => !s.injects);

  const out: string[] = [];
  out.push(`# Operating Scope Audit Report — ${new Date().toISOString()}`);
  out.push('');
  out.push('> Auditoría reproducible Phase 0 del contrato `operating_scope` (STORE vs ORGANIZATION).');
  out.push('> Generado por `apps/backend/scripts/operating-scope-audit.ts`.');
  out.push('');

  out.push('## Summary');
  out.push('');
  out.push(`- Total DTOs con \`store_id\` en body: **${dtos.length}**`);
  out.push(
    `- Servicios sin OperatingScopeService: **${servicesMissing.length}** (de ${services.length} servicios bajo domains/store y domains/organization)`,
  );
  out.push(`- Usos de \`withoutScope()\`: **${withoutScope.length}**`);
  out.push(`- Violaciones regla cero ORG_ADMIN → \`/store/*\`: **${orgToStore.length}**`);
  out.push(`- Violaciones regla cero STORE_ADMIN → \`/organization/*\`: **${storeToOrg.length}**`);
  out.push('');

  // 1. DTOs
  out.push('## 1. DTOs con `store_id` en body');
  out.push('');
  if (dtos.length === 0) {
    out.push('_Sin hallazgos._');
  } else {
    out.push('| File | Line | DTO | Required |');
    out.push('|------|------|-----|----------|');
    for (const f of dtos) {
      out.push(`| ${escapePipe(f.file)} | ${f.line} | ${escapePipe(f.dto)} | ${f.required ? 'yes' : 'no'} |`);
    }
  }
  out.push('');

  // 2. Services missing
  out.push('## 2. Servicios sin OperatingScopeService');
  out.push('');
  out.push(
    'Lista completa de servicios bajo `apps/backend/src/domains/store` y `apps/backend/src/domains/organization`. Columna `Injects` indica si su constructor inyecta `OperatingScopeService`.',
  );
  out.push('');
  if (services.length === 0) {
    out.push('_Sin servicios escaneados._');
  } else {
    out.push('### 2.1 No inyectan (candidatos a refactor)');
    out.push('');
    out.push('| File | Service | Injects |');
    out.push('|------|---------|---------|');
    for (const s of servicesMissing) {
      out.push(`| ${escapePipe(s.file)} | ${escapePipe(s.service)} | no |`);
    }
    out.push('');
    out.push('### 2.2 Sí inyectan (referencia consistente)');
    out.push('');
    const inject = services.filter((s) => s.injects);
    if (inject.length === 0) {
      out.push('_Ninguno._');
    } else {
      out.push('| File | Service | Injects |');
      out.push('|------|---------|---------|');
      for (const s of inject) {
        out.push(`| ${escapePipe(s.file)} | ${escapePipe(s.service)} | yes |`);
      }
    }
  }
  out.push('');

  // 3. withoutScope
  out.push('## 3. `prisma.withoutScope()` usages');
  out.push('');
  if (withoutScope.length === 0) {
    out.push('_Sin hallazgos._');
  } else {
    out.push('| File | Line | Snippet |');
    out.push('|------|------|---------|');
    for (const f of withoutScope) {
      out.push(`| ${escapePipe(f.file)} | ${f.line} | \`${escapePipe(f.snippet)}\` |`);
    }
  }
  out.push('');

  // 4. ORG -> /store/*
  out.push('## 4. Violaciones regla cero ORG_ADMIN → `/store/*`');
  out.push('');
  out.push(
    'Servicios/archivos bajo `apps/frontend/src/app/private/modules/organization/**` que contienen string literals con `/store/`.',
  );
  out.push('');
  if (orgToStore.length === 0) {
    out.push('_Sin hallazgos._');
  } else {
    out.push('| File | Line | URL detectada |');
    out.push('|------|------|---------------|');
    for (const f of orgToStore) {
      out.push(`| ${escapePipe(f.file)} | ${f.line} | \`${escapePipe(f.url)}\` |`);
    }
  }
  out.push('');

  // 5. STORE -> /organization/*
  out.push('## 5. Violaciones regla cero STORE_ADMIN → `/organization/*`');
  out.push('');
  out.push(
    'Servicios/archivos bajo `apps/frontend/src/app/private/modules/store/**` que contienen string literals con `/organization/`.',
  );
  out.push('');
  if (storeToOrg.length === 0) {
    out.push('_Sin hallazgos._');
  } else {
    out.push('| File | Line | URL detectada |');
    out.push('|------|------|---------------|');
    for (const f of storeToOrg) {
      out.push(`| ${escapePipe(f.file)} | ${f.line} | \`${escapePipe(f.url)}\` |`);
    }
  }
  out.push('');

  // Limitations
  out.push('## Limitaciones');
  out.push('');
  out.push(
    [
      '- La detección de `store_id` en DTOs usa una regex sobre la línea del campo. DTOs que declaren el tipo en formato no estándar (multi-línea, generics, alias de tipo) pueden no ser detectados.',
      '- La auditoría de inyección de `OperatingScopeService` busca su nombre en el archivo y un patrón de constructor; servicios que lo usen indirectamente vía otro service helper aparecerán como "no inyecta". Verificación manual recomendada.',
      '- El escaneo de `withoutScope()` excluye los servicios prisma base (donde la implementación vive). Cualquier nuevo helper que envuelva `withoutScope` quedará fuera del alcance.',
      '- La detección de URLs cruzadas analiza solo string literals en una línea; concatenaciones multilinea (template strings con interpolaciones partidas) pueden quedar fuera.',
      '- Los DTOs tipo Response (sufijo `Response` o `ResponseDto`) son excluidos para evitar falsos positivos sobre payloads de respuesta.',
      '- El allowlist de DTOs legítimos (`CreateStoreDto`, `UpdateStoreDto`) es manual; ampliar según se descubran más casos legítimos en revisión.',
    ].join('\n'),
  );
  out.push('');

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const dtos = auditDtosWithStoreId();
  const services = auditServicesMissingOperatingScope();
  const withoutScope = auditWithoutScopeUsage();
  const orgToStore = auditFrontendCrossDomain(
    path.join(FRONTEND_SRC, 'app', 'private', 'modules', 'organization'),
    /\/store\//,
  );
  const storeToOrg = auditFrontendCrossDomain(
    path.join(FRONTEND_SRC, 'app', 'private', 'modules', 'store'),
    /\/organization\//,
  );

  const report = renderReport({ dtos, services, withoutScope, orgToStore, storeToOrg });
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  process.stdout.write(report);
  process.stdout.write(`\n\n[audit] Report written to: ${REPORT_PATH}\n`);
}

main();
