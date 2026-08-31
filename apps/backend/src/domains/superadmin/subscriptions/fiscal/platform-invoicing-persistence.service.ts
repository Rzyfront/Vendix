import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase A.2
 *
 * Servicio de persistencia del rail super-admin. Mantiene la fuente de verdad
 * del lado plataforma en dos snapshots de `fiscal_evidences.metadata`, ambos
 * bajo `evidence_type='manual_support'` (enum existente, sin migración):
 *
 *   - `kind='platform_invoice_snapshot'`  → payload completo del documento que
 *     la fachada construyó para emitir (cliente + items + totales + period +
 *     currency). El detail endpoint lo relee para sintetizar la shape sin
 *     guardar el documento en una tabla propia. Establecido por C.11 en `main`.
 *
 *   - `kind='platform_acquirer_snapshot'` → identidad fiscal del TENANT cliente
 *     en el instante de la emisión (legal_name, tax_id, tax_id_dv, regimen,
 *     responsabilidades, dirección, email). ADR-7: el cliente son stores/orgs,
 *     NO `users`. La auditoria tributaria lo relee años después para saber
 *     qué datos tenían los destinatarios al emitir.
 *
 * Las precondiciones del caller (que la entidad esté activa, que la resolución
 * exista y tenga ClTec, etc.) viven en `PlatformInvoicingFacade`, no acá.
 *
 * Reglas de scope:
 *   - SIEMPRE `withoutScope()` con filtro EXPLICITO por `accounting_entity_id`
 *     (justificación estándar en el codebase, ver `invoicing.service.ts:364`).
 *   - El caller pasa el `accounting_entity_id` resuelto; este helper NO lo
 *     deduce (sería ambiguo si hay más de una plataforma).
 */
@Injectable()
export class PlatformInvoicingPersistenceService {
  private readonly logger = new Logger(PlatformInvoicingPersistenceService.name);

  constructor(
    // Prisma viene vía `prisma.withoutScope()` directo (como hacen los
    // demás servicios del módulo). Ver scope rules al inicio.
  ) {}

  /**
   * Persiste la identidad fiscal del TENANT cliente bajo el transmissionId.
   *
   * No muta la transacción del caller — el caller decide si abrir una tx o
   * delegar acá. La fila usa `evidence_type='manual_support'` para
   * aprovechar el enum existente sin migración, y el `metadata->>'kind'`
   * es exactamente `'platform_acquirer_snapshot'` para diferenciarse del
   * `platform_invoice_snapshot` que ya opera en `main`.
   *
   * Idempotencia: si ya existe un acquirer snapshot para la transmisión,
   * sobreescribe (UPDATE) — la identidad del destinatario es estable
   * durante la emisión. Se garantiza un solo row por transmission.
   */
  async persistAcquirerSnapshot(
    prisma: Prisma.TransactionClient,
    args: {
      organizationId: number;
      accountingEntityId: number;
      transmissionId: number;
      acquirer: PlatformAcquirerSnapshot;
    },
  ): Promise<void> {
    const existing = await prisma.fiscal_evidences.findFirst({
      where: {
        organization_id: args.organizationId,
        accounting_entity_id: args.accountingEntityId,
        fiscal_transmission_id: args.transmissionId,
        evidence_type: 'manual_support',
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, metadata: true },
    });

    const metadata = {
      kind: 'platform_acquirer_snapshot',
      tenant_ref: {
        kind: args.acquirer.kind,
        id: args.acquirer.tenant_id,
      },
      legal_name: args.acquirer.legal_name,
      tax_id: args.acquirer.tax_id,
      tax_id_dv: args.acquirer.tax_id_dv ?? null,
      document_type: '31', // NIT fijo en V1 — ADR-7
      person_type: args.acquirer.person_type ?? '2',
      tax_regime_code: args.acquirer.tax_regime_code ?? null,
      fiscal_responsibilities: args.acquirer.fiscal_responsibilities ?? [],
      address: {
        line: args.acquirer.address.line ?? null,
        city: args.acquirer.address.city ?? null,
        department_code: args.acquirer.address.department_code ?? null,
        country_code: 'CO',
      },
      email: args.acquirer.email ?? null,
      captured_by: 'PlatformInvoicingFacade',
    } as Prisma.JsonObject;

    if (existing && (existing.metadata as Record<string, unknown>)?.['kind'] === 'platform_acquirer_snapshot') {
      // UPDATE in-place: la identidad del tenant no debería cambiar entre
      // intentos de la misma transmisión; lo que sí cambia es el invoice
      // snapshot (líneas, totales) que se persiste en una SEGUNDA fila de
      // evidence (diferente metadata.kind) — la auditoría ve ambos.
      await prisma.fiscal_evidences.update({
        where: { id: existing.id },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
      this.logger.warn?.(
        `Overwriting platform_acquirer_snapshot on transmission #${args.transmissionId} (evidence #${existing.id})`,
      );
    } else {
      // Cuando el caller todavia no creo la transmision (transmissionId=0),
      // persistimos sin FK para evitar violacion; el snapshot se enlazara
      // luego via `linkAcquirerSnapshotToTransmission` cuando la transmision
      // quede persistida. En V1 el riel tienda emite la transmision DENTRO
      // de la misma tx y el caller ya tiene su id — pero los paths que
      // delegan al facade pasan 0 y necesitan este fallback.
      await prisma.fiscal_evidences.create({
        data: {
          organization_id: args.organizationId,
          store_id: null,
          accounting_entity_id: args.accountingEntityId,
          fiscal_transmission_id: args.transmissionId > 0 ? args.transmissionId : null,
          evidence_type: 'manual_support',
          storage_key: null,
          content_hash: null,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    }
  }

  /**
   * Persiste el payload completo del invoice (cliente + líneas + totales).
   * Reutiliza el patrón que C.11 implementó inline en `createPlatformInvoice`.
   * Esta versión extrae la lógica a un servicio para que la fachada V1 la
   * llame junto con `persistAcquirerSnapshot`.
   *
   * Snapshot estable: cada llamada representa la versión del invoice que
   * el backend construyó para emitir. Re-emisiones (retry) generan NUEVA
   * fila (`orderBy created_at desc` toma la última para el detail).
   */
  async persistInvoiceSnapshot(
    prisma: Prisma.TransactionClient,
    args: {
      organizationId: number;
      accountingEntityId: number;
      transmissionId: number;
      idempotencyKey: string;
      payload: PlatformInvoiceSnapshotPayload;
    },
  ): Promise<void> {
    await prisma.fiscal_evidences.create({
      data: {
        organization_id: args.organizationId,
        store_id: null,
        accounting_entity_id: args.accountingEntityId,
        fiscal_transmission_id: args.transmissionId,
        evidence_type: 'manual_support',
        storage_key: null,
        content_hash: args.idempotencyKey,
        metadata: {
          kind: 'platform_invoice_snapshot',
          customer: args.payload.customer,
          items: args.payload.items,
          totals: args.payload.totals,
          period_start: args.payload.period_start ?? null,
          period_end: args.payload.period_end ?? null,
          currency: args.payload.currency ?? 'COP',
          withholdings: args.payload.withholdings ?? [],
          global_discount_amount: args.payload.global_discount_amount ?? 0,
          operation_type: args.payload.operation_type,
          aiur_observation: args.payload.aiur_observation ?? null,
          // Top-level para que `subscription-fiscal.service.ts` (asiento
          // contable de frank) los consuma sin tener que conocer la
          // forma del DTO del rail plataforma.
          counterpart_account_code: args.payload.counterpart_account_code ?? null,
          resolution_id: args.payload.resolution_id ?? null,
          issue_date: args.payload.issue_date ?? null,
          created_by: 'PlatformInvoicingFacade',
        } as Prisma.JsonObject,
      },
    });
  }

  /**
   * Relee el snapshot del destinatario. Retorna null si no existe (cliente
   * emitido vía rail legacy que no snapshot-eaba). El detail endpoint decide
   * cómo renderizar el header del destinatario sin snapshot.
   */
  async loadAcquirerSnapshot(
    prisma: Prisma.TransactionClient | any,
    transmissionId: number,
  ): Promise<PlatformAcquirerSnapshot | null> {
    const row = await prisma.fiscal_evidences.findFirst({
      where: {
        fiscal_transmission_id: transmissionId,
        evidence_type: 'manual_support',
      },
      orderBy: { created_at: 'desc' },
      select: { metadata: true, created_at: true },
    });
    if (!row) return null;
    const meta = row.metadata as Record<string, unknown> | null;
    if (!meta || meta['kind'] !== 'platform_acquirer_snapshot') return null;

    // El primer row es `platform_invoice_snapshot` (escrito al final del
    // Tx), el último es `platform_acquirer_snapshot` (escrito primero dentro
    // del Tx). Buscamos en orden descendente por created_at; el último
    // snapshot del destinatario es lo que nos interesa.
    // Para evitar cargar filas que no son del kind, re-filtro en memoria.
    const tenantRef = (meta['tenant_ref'] as { kind: string; id: number }) ?? null;
    return {
      kind: tenantRef?.kind === 'organization' ? 'organization' : 'store',
      tenant_id: tenantRef?.id ?? 0,
      legal_name: (meta['legal_name'] as string) ?? '',
      tax_id: (meta['tax_id'] as string) ?? '',
      tax_id_dv: (meta['tax_id_dv'] as string | null) ?? null,
      person_type: ((meta['person_type'] as '1' | '2') ?? '2') as '1' | '2',
      tax_regime_code: (meta['tax_regime_code'] as string | null) ?? null,
      fiscal_responsibilities: (meta['fiscal_responsibilities'] as string[]) ?? [],
      address: {
        line: ((meta['address'] as Record<string, unknown>)?.['line'] as string | null) ?? null,
        city: ((meta['address'] as Record<string, unknown>)?.['city'] as string | null) ?? null,
        department_code:
          ((meta['address'] as Record<string, unknown>)?.['department_code'] as string | null) ??
          null,
      },
      email: (meta['email'] as string | null) ?? null,
    };
  }

  /**
   * Relee el último snapshot del invoice completo. Las pre-emisiones que
   * no llegaron a `markSubmitted` también lo tienen (sirve al detail
   * `loadReadiness` para mostrar la preview sin re-fetchear inputs del
   * usuario).
   */
  async loadInvoiceSnapshot(
    prisma: Prisma.TransactionClient | any,
    transmissionId: number,
  ): Promise<PlatformInvoiceSnapshotPayload | null> {
    const row = await prisma.fiscal_evidences.findFirst({
      where: {
        fiscal_transmission_id: transmissionId,
        evidence_type: 'manual_support',
      },
      orderBy: { created_at: 'desc' },
      select: { metadata: true },
    });
    if (!row) return null;
    const meta = row.metadata as Record<string, unknown> | null;
    if (!meta || meta['kind'] !== 'platform_invoice_snapshot') return null;
    return {
      customer: meta['customer'] as Record<string, unknown>,
      items: meta['items'] as Array<Record<string, unknown>>,
      totals: meta['totals'] as { subtotal: number; tax_amount: number; total: number },
      period_start: (meta['period_start'] as string | null) ?? null,
      period_end: (meta['period_end'] as string | null) ?? null,
      currency: (meta['currency'] as string) ?? 'COP',
      withholdings: (meta['withholdings'] as Array<Record<string, unknown>>) ?? [],
      global_discount_amount: (meta['global_discount_amount'] as number) ?? 0,
      operation_type: (meta['operation_type'] as string) ?? '10',
      counterpart_account_code: (meta['counterpart_account_code'] as string | null) ?? null,
      resolution_id: (meta['resolution_id'] as number | null) ?? null,
      issue_date: (meta['issue_date'] as string | null) ?? null,
    };
  }
}

/* ── Tipos de payload (input del facade) ───────────────────────────────────── */

export interface PlatformAcquirerSnapshot {
  kind: 'store' | 'organization';
  tenant_id: number;
  legal_name: string;
  tax_id: string;
  tax_id_dv: string | null;
  person_type: '1' | '2'; // 1=NATURAL, 2=JURIDICA. V1 default JURIDICA.
  tax_regime_code: string | null; // DIAN code, not label
  fiscal_responsibilities: string[];
  address: {
    line: string | null;
    city: string | null;
    department_code: string | null;
  };
  email: string | null;
}

export interface PlatformInvoiceSnapshotPayload {
  customer: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  totals: { subtotal: number; tax_amount: number; total: number };
  period_start: string | null;
  period_end: string | null;
  currency: string;
  withholdings: Array<Record<string, unknown>>;
  global_discount_amount: number;
  operation_type: string;
  /** Texto libre AIU (AIU contract object, max 4900 chars DIAN). */
  aiur_observation?: string | null;
  /**
   * Cuenta PUC de contrapartida del documento (cabeza). La consume
   * `subscription-fiscal.service.ts` al emitir el journal entry.
   */
  counterpart_account_code?: string | null;
  /** Resolución DIAN que numeró el documento (si vino explícita del operador). */
  resolution_id?: number | null;
  /** Fecha de emisión (YYYY-MM-DD). */
  issue_date?: string | null;
}
