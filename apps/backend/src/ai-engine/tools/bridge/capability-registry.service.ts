import { Injectable, Logger } from '@nestjs/common';
import { ApiCatalogService, CatalogEntry } from './api-catalog.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * A single thing the user can do, in their own vocabulary.
 */
export interface Capability {
  /** Business-facing verb: consultar, registrar, modificar, archivar… */
  action: string;
  method: string;
  path: string;
  /** The endpoint author's own description, when it declares one. */
  does?: string;
  fields?: Array<{
    name: string;
    type: string;
    required: boolean;
    enumValues?: string[];
  }>;
  needsDocument?: boolean;
  irreversible?: boolean;
}

export interface DomainCapabilities {
  domain: string;
  area: string;
  /** Best-effort module key for the UI tools to resolve. */
  module_hint: string;
  reads: Capability[];
  writes: Capability[];
}

/**
 * Verb per HTTP method, in the words a shopkeeper uses.
 *
 * `DELETE` is "archivar" because that is what the API does across this codebase:
 * records move to an archived state and stop appearing in listings, they are not
 * erased. Calling it "eliminar" would have Vexi warn about a loss that does not
 * happen and stay silent about the one that does (it cannot be undone).
 */
const ACTION_BY_METHOD: Record<string, string> = {
  GET: 'consultar',
  POST: 'registrar',
  PATCH: 'modificar',
  PUT: 'reemplazar',
  DELETE: 'archivar',
};

/**
 * Domains whose writes cannot be walked back, with the sentence the user has to
 * read before approving.
 *
 * This is a static table and not a model judgement on purpose: whether emitting
 * a DIAN document is reversible is a fact about Colombian tax law, not something
 * to infer from a route name at runtime. Matching is by the domain segment of the
 * path, so a new endpoint inside an already-listed domain inherits the warning
 * instead of silently arriving unlabelled.
 *
 * SINGLE SOURCE for irreversibility segments: `PlanApprovalService` imports
 * `IRREVERSIBLE_DOMAIN_SEGMENTS` below instead of mirroring this map — the
 * mirror drifted once (`cash-register` vs `cash-registers`) and DIAN/cash
 * writes slipped through whole-plan approval. Both spellings are listed on
 * purpose: routes use `cash-registers`, the typed cash tools declare
 * `cash-register`; same for `receivables`/`payables` (routes) and
 * `receivables-payables` (typed tools). A segment with no route today is
 * harmless — if a route ever uses it, the warning is already correct.
 */
export const IRREVERSIBLE_DOMAINS: Record<string, string> = {
  invoicing:
    'Un documento electrónico emitido ante la DIAN no se puede deshacer: corregirlo exige una nota crédito con su propia numeración.',
  'dian-config':
    'Cambiar la configuración de facturación electrónica afecta todos los documentos que se emitan después.',
  payroll:
    'Una liquidación de nómina genera obligaciones laborales y aportes de terceros que no se revierten solos.',
  pila: 'El archivo PILA se presenta ante los operadores de seguridad social y su corrección es un proceso aparte.',
  'cash-registers':
    'Cerrar una caja es un acto de control con responsable: el arqueo queda registrado y no se reabre.',
  payments:
    'Un pago aplicado mueve dinero real y genera asientos contables; revertirlo exige un reembolso, no un borrado.',
  refunds:
    'Un reembolso mueve dinero real y queda en la contabilidad del comercio.',
  subscriptions:
    'Cambiar el plan modifica lo que el comercio paga por Vendix a partir del próximo periodo.',
  declarations:
    'Una declaración presentada queda radicada; su corrección es un trámite aparte.',
  // Typed-tool domain spelling (routes use `cash-registers` above).
  'cash-register':
    'Cerrar una caja es un acto de control con responsable: el arqueo queda registrado y no se reabre.',
  fiscal:
    'Un cierre de periodo fiscal bloquea sus movimientos y una declaración radicada solo se corrige con un trámite aparte.',
  returns:
    'Procesar una devolución reingresa o da de baja el stock y emite el evento contable del reembolso.',
  accounting:
    'Un asiento publicado o un periodo contable cerrado no se borran: se corrigen con un reverso o un ajuste.',
  orders:
    'Cancelar o anular una orden cierra su ciclo comercial: su cobro solo se devuelve con un reembolso.',
  withholding:
    'Un reporte exógeno presentado o una retención certificada quedan radicados: su corrección es un trámite aparte.',
  receivables:
    'Un cobro aplicado mueve dinero real y salda cartera: revertirlo exige un ajuste, no un borrado.',
  payables:
    'Un pago a proveedores mueve dinero real y queda en la contabilidad: revertirlo exige un ajuste, no un borrado.',
  // Typed-tool domain spelling (routes use `receivables`/`payables` above).
  'receivables-payables':
    'Un cobro o pago aplicado mueve dinero real y queda en la contabilidad: revertirlo exige un ajuste, no un borrado.',
};

/**
 * Membership view of `IRREVERSIBLE_DOMAINS`, derived so the two cannot drift.
 * Consumed by whole-plan approval for the domain safety net; the warning
 * sentences above stay the only place that prose lives.
 */
export const IRREVERSIBLE_DOMAIN_SEGMENTS: ReadonlySet<string> = new Set(
  Object.keys(IRREVERSIBLE_DOMAINS),
);

/**
 * What this user can actually do, derived rather than curated.
 *
 * Vexi used to know seven hand-written write tools, which meant its answer to
 * "can you do X" depended on whether somebody had written a tool for X — and for
 * ~50 domains nobody had. This registry replaces that with a derivation: the
 * route catalog says what the API exposes, the caller's own permission list says
 * what they may reach, and the intersection is the honest scope. A new endpoint
 * shipped by any team enters Vexi's reach the moment it boots, with no edit here.
 *
 * The permissions themselves are NOT read from the database. They arrive on the
 * request context, already resolved by the auth layer for this specific user, so
 * the registry cannot drift from what the guards will enforce a millisecond
 * later. Reading the `permissions` table instead would answer "what could a role
 * like this do", which is a different and more dangerous question.
 */
@Injectable()
export class CapabilityRegistryService {
  private readonly logger = new Logger(CapabilityRegistryService.name);

  constructor(private readonly catalog: ApiCatalogService) {}

  /** Permission strings for the caller, falling back to roles. */
  private scopes(): string[] {
    const context = RequestContextService.getContext();
    const granted = context?.permissions;
    return granted?.length ? granted : (context?.roles ?? []);
  }

  /**
   * Domain-level index: what areas of the business this user can operate.
   *
   * Deliberately coarse. The full field-level detail of ~2.000 endpoints does not
   * fit in a turn, so the model orients here first and drills into one domain.
   */
  listDomains(): Array<{
    domain: string;
    area: string;
    reads: number;
    writes: number;
  }> {
    const scopes = this.scopes();
    const grouped = new Map<
      string,
      { domain: string; area: string; reads: number; writes: number }
    >();

    for (const entry of this.permitted(scopes)) {
      const key = `${entry.area}/${entry.domain}`;
      const bucket =
        grouped.get(key) ??
        { domain: entry.domain, area: entry.area, reads: 0, writes: 0 };

      if (entry.method === 'GET') bucket.reads += 1;
      else bucket.writes += 1;

      grouped.set(key, bucket);
    }

    return Array.from(grouped.values())
      .filter((bucket) => bucket.domain)
      .sort((a, b) => `${a.area}/${a.domain}`.localeCompare(`${b.area}/${b.domain}`));
  }

  /** Everything this user can do inside one domain, with field detail. */
  describeDomain(domain: string): DomainCapabilities[] {
    const scopes = this.scopes();
    const normalized = domain.trim().toLowerCase().replace(/\s+/g, '-');

    const matching = this.permitted(scopes).filter(
      (entry) => entry.domain === normalized,
    );

    const byArea = new Map<string, CatalogEntry[]>();
    for (const entry of matching) {
      byArea.set(entry.area, [...(byArea.get(entry.area) ?? []), entry]);
    }

    return Array.from(byArea.entries()).map(([area, entries]) => ({
      domain: normalized,
      area,
      module_hint: normalized.replace(/-/g, '_'),
      reads: entries
        .filter((entry) => entry.method === 'GET')
        .map((entry) => this.toCapability(entry)),
      writes: entries
        .filter((entry) => entry.method !== 'GET')
        .map((entry) => this.toCapability(entry)),
    }));
  }

  /**
   * Permissions the user holds that no route requires.
   *
   * Reported so Vexi can say "eso existe en el panel pero yo no lo alcanzo"
   * instead of claiming the permission means it can act. Silence here would make
   * the agent overpromise on exactly the operations nobody wired to an endpoint.
   */
  gaps(): string[] {
    const covered = this.catalog.coveredPermissions();
    return this.scopes()
      .filter((scope) => scope.includes(':') && !covered.has(scope))
      .sort();
  }

  /** The irreversibility warning for a path, when the domain carries one. */
  irreversibleWarning(path: string): string | undefined {
    const segments = path.split('/').filter(Boolean);
    for (const segment of segments) {
      const warning = IRREVERSIBLE_DOMAINS[segment];
      if (warning) return warning;
    }
    return undefined;
  }

  private permitted(scopes: string[]): CatalogEntry[] {
    return this.catalog.listFor(scopes);
  }

  private toCapability(entry: CatalogEntry): Capability {
    return {
      action: ACTION_BY_METHOD[entry.method] ?? entry.method.toLowerCase(),
      method: entry.method,
      path: entry.path,
      ...(entry.summary ? { does: entry.summary } : {}),
      ...(entry.bodySchema?.length ? { fields: entry.bodySchema } : {}),
      ...(entry.multipart ? { needsDocument: true } : {}),
      ...(this.irreversibleWarning(entry.path) ? { irreversible: true } : {}),
    };
  }
}
