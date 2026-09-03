/**
 * QUI-749 — Auditoría de handlers sin @Permissions en controllers de domains/store/.
 *
 * Exit code: SIEMPRE 0. Es un reporte, NO un fallo duro.
 *
 * Categorías:
 *   A) PermissionsGuard activo + TODOS los handlers con @Permissions — seguro.
 *   B) PermissionsGuard activo + ALGUNOS handlers SIN @Permissions — necesita revisión.
 *   C) SIN PermissionsGuard activo + @Permissions presente — FALSA SEGURIDAD (decoradores inertes).
 *      Es el hallazgo de mayor valor; revisar primero.
 *   D) SIN PermissionsGuard activo + SIN @Permissions — autenticado sin control de rol.
 *      Cualquier usuario autenticado del tenant (cajero, mesero, cocina) puede llegar.
 *      Distinto de "abierto" porque JwtAuthGuard ES global; la escalada es intra-tenant,
 *      no exposición pública. El término "abierto" induce a apagar un incendio que no existe.
 *      Una sub-variante «Cat D-Public» aparece cuando TODA la clase o TODOS los handlers
 *      declaran @Public() — son intencionalmente públicos (webhooks de pago, landings públicas).
 *   E) SIN PermissionsGuard pero CON OTRO guard (RolesGuard, McpAuthGuard, AiAccessGuard, etc.).
 *      También incluye guards declarados a nivel de método en algunos handlers.
 *
 * «PermissionsGuard activo» significa: la clase DECLARA `@UseGuards(PermissionsGuard)`
 * O cualquier handler DECLARA `@UseGuards(PermissionsGuard)` a nivel de método.
 * Si solo los métodos lo declaran, los handlers sin esa decoración no quedan cubiertos.
 *
 * Sub-clasificación dentro de cada categoría para distinguir CRITICIDAD:
 *   - «writeWithoutAuth»: handlers POST/PATCH/PUT/DELETE sin @Permissions.
 *     Un DELETE sin permiso es una escalada real; un GET sin permiso solo fuga lectura.
 *   - «readWithoutAuth»: handlers GET/HEAD/OPTIONS sin @Permissions.
 *     Si «writeWithoutAuth > 0», el hallazgo es CRÍTICO; si solo es lectura, ALTO/MEDIO.
 */
import * as fs from 'fs';
import * as path from 'path';

interface ControllerFile {
  file: string;
  cat: 'A' | 'B' | 'C' | 'D' | 'D-Public' | 'E';
  totalHandlers: number;
  handlersWithPerms: number;
  writeWithoutAuth: number;
  readWithoutAuth: number;
  writeHandlers: number;
  readHandlers: number;
  classHasPermGuard: boolean;
  methodsWithPermGuard: number;
  publicHandlers: number;
  classHasPublic: boolean;
  otherGuards: string[];
  notes?: string;
}

const CONTROLLER_RE = /@Controller\s*\(/;
const CLASS_RE = /export\s+class\s+(\w+)/g;
const USE_GUARDS_RE = /@UseGuards\s*\(([^)]+)\)/g;
const PUBLIC_RE = /@Public\s*\(/;
const METHOD_HTTP_RE = /@(Get|Post|Patch|Delete|Put|Head|Options|All)\s*\(([^)]*)\)/g;
const PERMISSIONS_RE = /@Permissions\s*\(/;
const DECORATOR_RE = /@(\w+)(?:\s*\(.*?\))?\s*$/;

const WRITE_METHODS = new Set(['Post', 'Patch', 'Put', 'Delete', 'All']);
const READ_METHODS = new Set(['Get', 'Head', 'Options']);

function walkFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p.endsWith('.controller.ts')) out.push(p);
    }
  }
  walk(root);
  return out.sort();
}

function extractUseGuardsArgs(argList: string): string[] {
  return argList.split(',').map((s) => s.trim()).filter(Boolean);
}

function isPermGuard(g: string): boolean {
  return /PermissionsGuard/.test(g);
}

function isOtherGuard(g: string): boolean {
  return /(RolesGuard|McpAuthGuard|JwtAuthGuard|VexiEnabledGuard|AiAccessGuard|DomainRegistrationGuard|DomainScopeGuard|StoreOperationsGuard)/.test(g);
}

interface HandlerInfo {
  method: string;
  name: string;
  decoratorStack: string;
  hasPermissions: boolean;
  hasUseGuardsPerm: boolean;
  hasPublic: boolean;
  hasOtherGuards: boolean;
}

function parseHandlers(content: string): HandlerInfo[] {
  const handlers: HandlerInfo[] = [];
  let m: RegExpExecArray | null;
  METHOD_HTTP_RE.lastIndex = 0;
  while ((m = METHOD_HTTP_RE.exec(content)) !== null) {
    const idx = m.index;
    // Find the method signature: the next line matching `^\s*(async\s+)?\w+\s*\(`.
    // We collect @-decorator lines in the range BETWEEN the previous non-decorator
    // line (walking backward from @Get) and the method signature (walking forward).
    const sigLineRe = /^\s*(?:async\s+)?\w+\s*\(/;
    const lines = content.slice(idx).split('\n');
    let sigLineOffset = -1;
    for (let i = 0; i < lines.length; i++) {
      if (sigLineRe.test(lines[i])) { sigLineOffset = i; break; }
    }
    if (sigLineOffset === -1) continue;
    // Build the decorator window: from `idx` forward to the line BEFORE the signature.
    const forwardWindowLines = lines.slice(0, sigLineOffset);
    // Walk backward from `@Get` position to find the start of the decorator stack.
    // Backward context is `content[:idx]`. Split, walk back, collect `@` lines.
    const backwardLines = content.slice(0, idx).split('\n');
    let stackStart = backwardLines.length;
    for (let i = backwardLines.length - 1; i >= 0; i--) {
      const ln = backwardLines[i].trim();
      if (ln.startsWith('@')) { stackStart = i; continue; }
      if (
        ln === '' ||
        ln.startsWith('//') ||
        ln.startsWith('/*') ||
        ln.startsWith('*') ||
        ln.startsWith('/**') ||
        sigLineRe.test(ln) // signature lines (e.g. previous method's signature)
      ) continue;
      break;
    }
    const backwardStack = backwardLines.slice(stackStart);
    const stackLines = [...backwardStack, ...forwardWindowLines];
    const stack = stackLines.join('\n');
    const hasPerm = PERMISSIONS_RE.test(stack);
    const hasPublic = PUBLIC_RE.test(stack);
    const methodGuards = [...stack.matchAll(USE_GUARDS_RE)].map((mm) => mm[1]);
    const hasUseGuardsPerm = methodGuards.some(isPermGuard);
    const hasOtherGuards = methodGuards.some(isOtherGuard);
    // Method name = identifier on the signature line
    const sigLine = lines[sigLineOffset];
    const nameMatch = /(?:\s*(?:async\s+))?(\w+)\s*\(/.exec(sigLine);
    const methodName = nameMatch ? nameMatch[1] : '?';
    handlers.push({
      method: m[1],
      name: methodName,
      decoratorStack: stack,
      hasPermissions: hasPerm,
      hasUseGuardsPerm,
      hasPublic,
      hasOtherGuards,
    });
  }
  return handlers;
}

function classify(filePath: string): ControllerFile | null {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!CONTROLLER_RE.test(content)) return null; // no @Controller → skip
  // Find ALL export class positions; the one immediately after @Controller is the controller
  const classPositions: number[] = [];
  let cm: RegExpExecArray | null;
  CLASS_RE.lastIndex = 0;
  while ((cm = CLASS_RE.exec(content)) !== null) {
    classPositions.push(cm.index);
  }
  if (classPositions.length === 0) return null;
  // Find first @Controller position
  const controllerMatch = content.match(CONTROLLER_RE);
  if (!controllerMatch) return null;
  const controllerIdx = controllerMatch.index!;
  // The controller class is the first `export class` whose index > controllerIdx
  const controllerClassStart = classPositions.find((p) => p > controllerIdx);
  if (controllerClassStart === undefined) return null;

  // Class-level decorators span BOTH above @Controller AND between @Controller and class.
  // Vendix has decorators stacked in this order (some files reverse them):
  //   @UseGuards(PermissionsGuard, RolesGuard)
  //   @Roles(UserRole.OWNER)
  //   @SkipSubscriptionGate()
  //   @Controller('path')
  //   export class X { ... }
  // We must scan BOTH ranges so neither pattern is missed.
  const classDecoratorsArea =
    content.slice(0, controllerIdx) + '\n' + content.slice(controllerIdx, controllerClassStart);
  const classUseGuards = [...classDecoratorsArea.matchAll(USE_GUARDS_RE)].map((mm) =>
    extractUseGuardsArgs(mm[1]),
  );
  const classGuardsFlat = classUseGuards.flat();
  const classHasPermGuard = classGuardsFlat.some(isPermGuard);
  const classHasPublic = PUBLIC_RE.test(classDecoratorsArea);

  // Method-level decorators (between controllerClassStart and next class, or EOF)
  const nextClassStart = classPositions.find((p) => p > controllerClassStart);
  const methodArea = nextClassStart !== undefined
    ? content.slice(controllerClassStart, nextClassStart)
    : content.slice(controllerClassStart);
  const handlers = parseHandlers(methodArea);
  if (handlers.length === 0) return null;
  const methodsWithPermGuard = handlers.filter((h) => h.hasUseGuardsPerm).length;
  const handlersWithPerms = handlers.filter((h) => h.hasPermissions).length;
  const publicHandlers = handlers.filter((h) => h.hasPublic).length;
  const totalHandlers = handlers.length;

  // Permission guard is "active for this controller" if declared at class level OR any method level
  const permGuardActive = classHasPermGuard || methodsWithPermGuard > 0;
  // Other guards (RolesGuard, AiAccessGuard, McpAuthGuard, ...) at class OR method level
  const classOtherGuards = classGuardsFlat.filter(isOtherGuard);
  const methodOtherGuardList: string[] = [];
  for (const h of handlers) {
    if (!h.hasOtherGuards) continue;
    const guards = [...h.decoratorStack.matchAll(USE_GUARDS_RE)].map((mm) => mm[1]);
    for (const g of guards) {
      if (isOtherGuard(g)) methodOtherGuardList.push(g);
    }
  }
  const otherGuards = [...new Set([...classOtherGuards, ...methodOtherGuardList])];

  let cat: 'A' | 'B' | 'C' | 'D' | 'D-Public' | 'E';
  let notes: string | undefined;

  // Sub-clasificación por método HTTP: handlers de ESCRITURA sin @Permissions son
    // CRÍTICOS (escalada real); solo lectura es ALTO/MEDIO (fuga de información).
    const handlersWithoutPerms = handlers.filter((h) => !h.hasPermissions);
    const writeWithoutPerms = handlersWithoutPerms.filter((h) =>
      WRITE_METHODS.has(h.method),
    );
    const readWithoutPerms = handlersWithoutPerms.filter((h) =>
      READ_METHODS.has(h.method),
    );
    const writeHandlersAll = handlers.filter((h) => WRITE_METHODS.has(h.method));
    const readHandlersAll = handlers.filter((h) => READ_METHODS.has(h.method));

  if (permGuardActive) {
    if (methodsWithPermGuard > 0 && !classHasPermGuard) {
      // Some methods have it, not all. Need to verify each method that has @Permissions
      // also has @UseGuards(PermissionsGuard) — otherwise the @Permissions is decorative for that method.
      const decorative = handlers.filter((h) => h.hasPermissions && !h.hasUseGuardsPerm);
      if (decorative.length > 0) {
        cat = 'C';
        notes = `${decorative.length} handler(s) with @Permissions but NO @UseGuards(PermissionsGuard) at method level`;
      } else if (handlersWithPerms === totalHandlers) {
        cat = 'A';
      } else {
        cat = 'B';
        const writeW = writeWithoutPerms.length;
        const readW = readWithoutPerms.length;
        const severityHint = writeW > 0
          ? `CRÍTICO: ${writeW} handler(s) de ESCRITURA sin @Permissions`
          : (readW > 0 ? `${readW} handler(s) de solo lectura sin @Permissions` : '');
        notes = `${totalHandlers - handlersWithPerms} handler(s) without @Permissions (PermissionsGuard will only enforce path/method match) — ${severityHint}`.trim();
      }
    } else if (handlersWithPerms === totalHandlers) {
      cat = 'A';
    } else {
      cat = 'B';
      const writeW = writeWithoutPerms.length;
      const readW = readWithoutPerms.length;
      const severityHint = writeW > 0
        ? `CRÍTICO: ${writeW} handler(s) de ESCRITURA sin @Permissions`
        : (readW > 0 ? `${readW} handler(s) de solo lectura sin @Permissions` : '');
      notes = `${totalHandlers - handlersWithPerms} handler(s) without @Permissions (PermissionsGuard will only enforce path/method match) — ${severityHint}`.trim();
    }
  } else {
    // No PermissionsGuard active. Look for other guards.
    if (handlersWithPerms > 0) {
      cat = 'C';
      const writeW = handlers.filter((h) => WRITE_METHODS.has(h.method)).length;
      const readW = handlers.filter((h) => READ_METHODS.has(h.method)).length;
      // En Cat C TODOS los handlers tienen @Permissions pero el GUARD NO está activo.
      // Por tanto TODOS los @Permissions son inertes. Si hay ESCRITURA, es crítico.
      const writeHint = writeW > 0
        ? `CRÍTICO: ${writeW} handler(s) de ESCRITURA tienen @Permissions INERTES`
        : `${readW} handler(s) de lectura tienen @Permissions inertes`;
      notes = `${handlersWithPerms} handler(s) with @Permissions but NO PermissionsGuard active (decorators inert) — ${writeHint}`;
    } else if (otherGuards.length > 0) {
      cat = 'E';
      notes = `Other guard(s): ${otherGuards.join(', ')} (some may be method-level)`;
    } else {
      // Sin PermGuard ni otros guards. ¿Es intencionalmente público?
      if (classHasPublic || publicHandlers === totalHandlers) {
        cat = 'D-Public';
        notes = classHasPublic
          ? `@Public() a nivel de clase — endpoint intencionalmente público (JwtAuthGuard bypasseado)`
          : `Todos los handlers (${totalHandlers}) declaran @Public() — endpoint intencionalmente público`;
      } else {
        cat = 'D';
        const partialPublic = publicHandlers > 0 ? `${publicHandlers} handler(s) son @Public() pero el resto no` : undefined;
        const writeW = writeWithoutPerms.length;
        const readW = readWithoutPerms.length;
        const severityHint = writeW > 0
          ? `CRÍTICO: ${writeW} handler(s) de ESCRITURA sin protección (POST/PATCH/PUT/DELETE)`
          : `${readW} handler(s) de solo lectura sin protección`;
        notes = [
          'Autenticado sin control de rol: cualquier usuario del tenant (cajero/mesero/cocina) puede llegar. JwtAuthGuard es global → no es endpoint público.',
          severityHint,
          partialPublic,
        ].filter(Boolean).join(' | ');
      }
    }
  }

  return {
    file: filePath.replace(process.cwd() + '/', ''),
    cat,
    totalHandlers,
    handlersWithPerms,
    writeWithoutAuth: handlers.filter((h) => !h.hasPermissions && WRITE_METHODS.has(h.method)).length,
    readWithoutAuth: handlers.filter((h) => !h.hasPermissions && READ_METHODS.has(h.method)).length,
    writeHandlers: writeHandlersAll.length,
    readHandlers: readHandlersAll.length,
    classHasPermGuard,
    methodsWithPermGuard,
    publicHandlers,
    classHasPublic,
    otherGuards,
    notes,
  };
}

function main() {
  const controllers = walkFiles('apps/backend/src/domains/store');
  const results: ControllerFile[] = [];
  for (const f of controllers) {
    const r = classify(f);
    if (r) results.push(r);
  }

  // Sort by category then handlers desc
  results.sort((a, b) => {
    if (a.cat !== b.cat) return a.cat.localeCompare(b.cat);
    return b.totalHandlers - a.totalHandlers;
  });

  // Aggregate counts
  const counts = { A: 0, B: 0, C: 0, D: 0, 'D-Public': 0, E: 0 };
  let totalHandlers = 0;
  for (const r of results) {
    counts[r.cat]++;
    totalHandlers += r.totalHandlers;
  }

  const report = {
    generated_at: new Date().toISOString(),
    scope: 'apps/backend/src/domains/store/**/*.controller.ts',
    summary: {
      total_controllers: results.length,
      total_handlers: totalHandlers,
      by_category: {
        A: `${counts.A} controllers — PermissionsGuard activo + TODOS los handlers con @Permissions`,
        B: `${counts.B} controllers — PermissionsGuard activo + algunos handlers sin @Permissions`,
        C: `${counts.C} controllers — @Permissions presente SIN PermissionsGuard activo (FALSA SEGURIDAD — hallazgo principal)`,
        D: `${counts.D} controllers — SIN PermissionsGuard activo + SIN @Permissions (autenticado sin control de rol intra-tenant)`,
        'D-Public': `${counts['D-Public']} controllers — SIN PermissionsGuard pero @Public() (intencionalmente público, sin gate de rol)`,
        E: `${counts.E} controllers — PermissionsGuard ausente pero con OTRO guard (RolesGuard, McpAuthGuard, AiAccessGuard, etc.)`,
      },
    },
    controllers: results,
  };

  fs.writeFileSync(
    '.audit-permissions.json',
    JSON.stringify(report, null, 2) + '\n',
  );

  // Console summary — Cat C first per directive, then A, then D, D-Public, B, E
  const order: ('C' | 'A' | 'D' | 'D-Public' | 'B' | 'E')[] = ['C', 'A', 'D', 'D-Public', 'B', 'E'];
  console.log(`\n=== QUI-749 — Auditoría de @Permissions en domains/store/ ===\n`);
  console.log(`Total controllers: ${results.length}`);
  console.log(`Total handlers: ${totalHandlers}\n`);
  for (const cat of order) {
    const arr = results.filter((r) => r.cat === cat);
    if (arr.length === 0) continue;
    console.log(`[${cat}] ${counts[cat]} controllers — ${report.summary.by_category[cat]}`);
    for (const r of arr) {
      const flag = r.classHasPermGuard ? 'class-guarded' : (r.methodsWithPermGuard > 0 ? `${r.methodsWithPermGuard}/${r.totalHandlers} method-guarded` : 'no PermGuard');
      const publicFlag = r.classHasPublic ? ' class-@Public' : (r.publicHandlers > 0 ? ` ${r.publicHandlers}h-@Public` : '');
      console.log(`  - ${r.file}  (${r.totalHandlers}h, ${r.handlersWithPerms} con @Perm, ${flag}${publicFlag}, writeW/o=${r.writeWithoutAuth}, readW/o=${r.readWithoutAuth})`);
      if (r.notes) console.log(`      ${r.notes}`);
    }
    console.log('');
  }

  console.log(`Reporte completo: .audit-permissions.json (${results.length} controllers, ${totalHandlers} handlers)`);
  console.log(`Exit 0 — esto es un reporte, NO un fallo duro.`);
}

main();