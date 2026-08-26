/**
 * PlatformCreditNotesService — notas crédito/débito del riel plataforma.
 *
 * ## Por que servicio paralelo y no delegación a CreditNotesService tienda
 *
 * `CreditNotesService` de tienda exige contexto JWT con `organization_id` Y
 * `store_id` (línea 67-79 del original: `AUTH_CONTEXT_001` si falta). La
 * plataforma no tiene store: emite con `platform_organization_id` y
 * `accounting_entity_id` resueltos desde `platform_settings`. Misma
 * justificación que `PlatformProfilesService` (B.1 del CP-platform-invoicing-parity).
 *
 * La persistencia final la hace `InvoicingService.create()` del riel tienda
 * —el mismo calculador, validador y cadena UBL que las facturas— envuelto en
 * `RequestContextService.run()` con un contexto sintetizado
 * `organization_id=platform, store_id=undefined, user_id`. El servicio del
 * riel tienda NO se toca: compuerta dura del plan, verificada por su spec
 * SIN modificaciones.
 *
 * ## Validaciones equivalentes a tienda (mismas reglas, distinto ámbito)
 *
 * - related_invoice existe y pertenece a la organización plataforma
 * - related_invoice.status == 'accepted' (con CUFE)
 * - related_invoice.invoice_type ∈ ['sales_invoice','export_invoice',
 *   'purchase_invoice'] (mismo `CORRECTABLE_BY_NOTE`)
 * - related_invoice.accounting_entity_id == entity plataforma
 *
 * ## Lo que NO hace este slice
 *
 * - NO genera consecutivo: la persistencia final delega en el
 *   `invoice_number_generator` del riel tienda vía `InvoicingService.create()`
 *   que ya usa pg_advisory_xact_lock (mecanismo de ADR-H4). Slice C.2.5
 *   verificable cuando la DB vuelva.
 * - NO transmite: `invoice-flow.service` se llama después por la fachada MvpV1
 *   (no implementado en MVP actual para support_document; C.2 hereda esa
 *   limitación de createSalesInvoice del riel plataforma).
 * - NO escribe el evento de delivery en `invoice_delivery_events`: eso es C.3.
 */
import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '@common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

import { InvoicingService } from '../../../store/invoicing/invoicing.service';
import {
  PlatformCreateCreditNoteDto,
  PlatformCreateDebitNoteDto,
} from './dto/platform-credit-note.dto';

/**
 * Tipos de factura que admiten corrección por nota crédito o débito.
 * Réplica exacta del CORRECTABLE_BY_NOTE del riel tienda
 * (`credit-notes.service.ts:120-122`): una nota crédito/débito (tipos DIAN
 * 91/92) sólo corrige una FACTURA. Cada familia de documento tiene la suya:
 *   · doc equivalente POS → nota de ajuste 93/94
 *   · doc soporte          → nota de ajuste 95
 *   · una nota             → no se corrige con otra nota
 */
const CORRECTABLE_BY_NOTE = [
  'sales_invoice',
  'export_invoice',
  'purchase_invoice',
];

export interface PlatformCreditNoteResult {
  invoice_id: number;
  invoice_number: string;
  invoice_type: 'credit_note' | 'debit_note';
  related_invoice_id: number;
  status: string;
  cufe: string | null;
}

@Injectable()
export class PlatformCreditNotesService {
  private readonly logger = new Logger(PlatformCreditNotesService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
    private readonly invoicing: InvoicingService,
    private readonly audit: AuditService,
  ) {}

  async createCreditNote(
    dto: PlatformCreateCreditNoteDto,
    actorUserId: number,
  ): Promise<PlatformCreditNoteResult> {
    return this.createNote(dto, 'credit_note', actorUserId);
  }

  async createDebitNote(
    dto: PlatformCreateDebitNoteDto,
    actorUserId: number,
  ): Promise<PlatformCreditNoteResult> {
    return this.createNote(dto, 'debit_note', actorUserId);
  }

  /**
   * Crea la nota plataforma delegando en `InvoicingService.create()` del riel
   * tienda. La envoltura en `RequestContextService.run()` es lo que evita
   * tocar el servicio tienda: inyecta el contexto org-plataforma en el
   * AsyncLocalStorage para que las llamadas internas (`getContext()`,
   * `StorePrismaService`) lean los valores correctos sin que el código del
   * riel tienda sepa que está siendo invocado desde plataforma.
   */
  private async createNote(
    dto: PlatformCreateCreditNoteDto | PlatformCreateDebitNoteDto,
    type: 'credit_note' | 'debit_note',
    actorUserId: number,
  ): Promise<PlatformCreditNoteResult> {
    const ctx = await this.platformOrg.requirePlatformContext();
    const platformOrgId = ctx.organization_id;
    const accountingEntityId = ctx.accounting_entity_id;

    // 1. Validar la factura relacionada existe, es del ámbito plataforma,
    //    está aceptada, tiene CUFE, y su tipo admite nota crédito/débito.
    const related = await this.prisma
      .withoutScope()
      .invoices.findFirst({
        where: { id: dto.related_invoice_id },
        select: {
          id: true,
          invoice_number: true,
          invoice_type: true,
          status: true,
          cufe: true,
          accounting_entity_id: true,
          organization_id: true,
        },
      });

    if (!related) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontró la factura ${dto.related_invoice_id} en la plataforma.`,
        { related_invoice_id: dto.related_invoice_id },
      );
    }

    if (related.organization_id !== platformOrgId) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_SCOPE_INVALID,
        'La factura relacionada pertenece a otra organización.',
        {
          related_invoice_id: related.id,
          related_organization_id: related.organization_id,
          platform_organization_id: platformOrgId,
        },
      );
    }

    if (!CORRECTABLE_BY_NOTE.includes(related.invoice_type)) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        `El documento ${related.invoice_number} es de tipo «${related.invoice_type}» y no admite ${type === 'credit_note' ? 'nota crédito' : 'nota débito'}.`,
        {
          related_invoice_id: related.id,
          related_invoice_type: related.invoice_type,
        },
      );
    }

    if (related.status !== 'accepted' || !related.cufe) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        `La factura ${related.invoice_number} está en estado '${related.status}' y debe ser aceptada por la DIAN antes de corregirla.`,
        {
          related_invoice_id: related.id,
          status: related.status,
          has_cufe: Boolean(related.cufe),
        },
      );
    }

    if (
      related.accounting_entity_id &&
      related.accounting_entity_id !== accountingEntityId
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_SCOPE_INVALID,
        'La factura relacionada pertenece a otra entidad contable.',
        {
          related_invoice_id: related.id,
          related_accounting_entity_id: related.accounting_entity_id,
          platform_accounting_entity_id: accountingEntityId,
        },
      );
    }

    // 2. Construir el DTO del riel tienda con la información de la nota.
    //    Mapeo equivalente al que usa `mapMvpV1ToLegacyCreateDto` en C.1.
    const noteDto: any = {
      invoice_type: type,
      customer: dto.customer ?? {
        tax_id: '',
        tax_id_dv: '',
        legal_name: 'Plataforma',
      },
      items: (dto.items ?? []).map((line: any) => ({
        description: line.description,
        quantity: Number(line.quantity) || 1,
        unit_price: Number(line.unit_price) || 0,
        note_concept_code: dto.note_concept_code,
      })),
      currency: 'COP',
      related_invoice_id: related.id,
      note_concept_code: dto.note_concept_code,
      reason: dto.reason,
      // profile_id propagado de C.1 si viene
      profile_id: dto.profile_id ?? undefined,
    };

    // 3. Delegar en InvoicingService.create() del riel tienda, dentro de un
    //    RequestContext sintetizado para que el `getContext()` interno lea
    //    platform_org y store_id=undefined (ADR-7: org requerido, store
    //    opcional). El calculador, validador y cadena UBL del riel tienda
    //    operan exactamente igual que para una nota de tienda, sin saber
    //    que el caller es plataforma.
    const created = await RequestContextService.run(
      {
        user_id: actorUserId,
        organization_id: platformOrgId,
        store_id: undefined,
        is_super_admin: true,
        is_owner: false,
        app_type: 'VENDIX_ADMIN',
        roles: ['SUPER_ADMIN'],
        permissions: ['superadmin:fiscal:invoicing'],
        request_id: `platform-credit-note-${related.id}-${Date.now()}`,
      },
      () => this.invoicing.create(noteDto),
    );

    // 4. Auditar el acto (CP-platform-invoicing-parity B.4-style audit).
    await this.audit.log({
      action: 'CREATE',
      resource: 'invoices',
      resourceId: created.id,
      oldValues: null,
      newValues: {
        invoice_type: type,
        related_invoice_id: related.id,
        note_concept_code: dto.note_concept_code,
        reason: dto.reason,
      },
      userId: actorUserId,
      organizationId: platformOrgId,
      storeId: undefined,
      metadata: { source: 'platform-fiscal', rail: 'credit_note' },
    });

    return {
      invoice_id: created.id,
      invoice_number: created.invoice_number,
      invoice_type: type,
      related_invoice_id: related.id,
      status: created.status,
      cufe: created.cufe,
    };
  }
}
