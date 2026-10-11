import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateQuotationDto,
  UpdateQuotationDto,
  QuotationQueryDto,
} from './dto';
import { quotation_status_enum, Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from '../orders/orders.service';
import { QuotationProfilesService } from '../backend-quotations-profiles/quotation-profiles.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { EmailService } from '../../../email/email.service';
import { generateQuotationEmailHtml } from '../../../email/templates/quotation-email.template';
import {
  resolveTierSnapshotsForItems,
  type TierSnapshot,
} from '../products/services/tier-snapshot.util';
import { PriceResolverService } from '../products/services/price-resolver.service';
import { TaxesService } from '../taxes/taxes.service';
import { ProfilesService } from '../invoicing/profiles/profiles.service';
import { normalizeAndAssertProfileConfig } from '../invoicing/profiles/invoice-profile-config.validator';
import { DIAN_INVOICE_OPERATION_TYPES } from '../invoicing/providers/dian-direct/constants/dian-document-types';
import { resolveAiuComponentsBasis } from '../invoicing/profiles/invoice-profile-config.contract';
import {
  buildAiuNote,
  DIAN_AIU_NOTE_MAX_LENGTH,
  DIAN_AIU_NOTE_MIN_LENGTH,
} from '../invoicing/providers/dian-direct/xml/ubl-common.builder';
import { dianLineExtension } from '../invoicing/utils/dian-money.util';
import {
  matchesCatalogPrice,
  resolveQuotationLine,
  summarizeQuotationLines,
  type QuotationLineRate,
  type ResolvedQuotationLine,
} from './quotation-line-tax.util';
import { resolvePackSize } from '../products/services/packaging.util';
import {
  normalizePriceUnitLines,
  resolveLineTotal,
} from '../products/services/price-unit.util';
import {
  buildQuotationContractEconomicSnapshot,
  type FrozenInvoiceProfile,
  type FrozenQuotationProfile,
  type QuotationContractEconomicSnapshot,
} from './quotation-contract-economics';
import type { ProfileContractCostLine } from '../invoicing/profiles/profile-contract-economics';
import type { QuotationProfileConfig } from '../backend-quotations-profiles/quotation-profile-config';

/**
 * Total BRUTO de cada línea, antes del descuento.
 *
 * La cabecera resta el descuento UNA sola vez
 * (`grand_total = subtotal - descuentos + impuestos`), así que el subtotal
 * tiene que ser bruto para que la cuenta cierre. El modal del panel manda
 * `total_price` ya neteado (`precio × cantidad - descuento`) y sumarlo tal cual
 * restaba el descuento dos veces: 3 unidades a $5.000 con $1.000 de descuento
 * se guardaban en $13.000 mientras la UI mostraba $14.000, y la orden
 * convertida heredaba el faltante porque `convertToOrder` copia los totales.
 *
 * El total lo deriva el servidor por la misma razón que la escala: la
 * cotización es un documento que se le manda al cliente y no puede depender
 * de la aritmética del cliente HTTP. Para una PRESENTACIÓN la escala resuelve
 * a 1 (`priceUnitByIndex` en `null`), porque ahí `unit_price` es el precio del
 * paquete y `quantity` cuenta paquetes.
 */
export function resolveGrossLineTotals(
  items: Array<{ unit_price: number; quantity: number }>,
  priceUnits: { priceUnitByIndex: Array<number | null> },
): number[] {
  return items.map((item, index) =>
    resolveLineTotal(
      Number(item.unit_price),
      Number(item.quantity),
      priceUnits.priceUnitByIndex[index],
    ),
  );
}

/** Tasas y semántica de precio de una línea, resueltas antes de persistir. */
type QuotationLineTaxContext = {
  rates: QuotationLineRate[];
  declared_gross: boolean;
};

type QuotationTaxableItem = {
  product_id?: number | null;
  product_variant_id?: number | null;
  unit_price: unknown;
  quantity: unknown;
  discount_amount?: unknown;
  tax_rate?: unknown;
};

@Injectable()
export class QuotationsService {
  private readonly priceResolver = new PriceResolverService();

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly ordersService: OrdersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
    private readonly profilesService: QuotationProfilesService,
    private readonly taxesService?: TaxesService,
    private readonly invoiceProfilesService?: ProfilesService,
  ) {}

  // VALID_TRANSITIONS state machine
  private readonly VALID_TRANSITIONS: Record<string, string[]> = {
    draft: ['sent', 'cancelled'],
    sent: ['accepted', 'rejected', 'expired', 'cancelled'],
    // F-002 (ADR-04): `accepted->contracted` marca contrato creado sin
    // contaminar `converted`, que sigue significando solo venta.
    accepted: ['converted', 'contracted', 'cancelled'],
    rejected: [],
    expired: [],
    converted: [],
    contracted: [],
    cancelled: [],
  };

  private readonly QUOTATION_INCLUDE = {
    quotation_items: {
      include: {
        // P1-1: las asignaciones viajan para que el modal, al reabrir una
        // cotización, estime el impuesto con el flag incluido/agregado y el
        // tipo fiscal reales en vez de sumar `tax_rate` a ciegas.
        product: {
          include: {
            product_tax_assignments: {
              include: {
                tax_categories: { include: { tax_rates: true } },
              },
            },
          },
        },
        product_variant: true,
      },
    },
    customer: {
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
      },
    },
    created_by_user: {
      select: {
        id: true,
        first_name: true,
        last_name: true,
      },
    },
    converted_order: {
      select: {
        id: true,
        order_number: true,
        state: true,
        grand_total: true,
      },
    },
  };

  async create(createQuotationDto: CreateQuotationDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    if (createQuotationDto.destination === 'contract') {
      return this.createContractQuotation(createQuotationDto, context, store_id);
    }
    this.assertNoContractEconomicsFields(createQuotationDto);

    const quotation_number = await this.generateQuotationNumber(store_id);

    // Calculate totals from items
    const items = createQuotationDto.items || [];

    // Multi-tarifa: validar permission + resolver snapshots por línea.
    const tierSnapshots = await resolveTierSnapshotsForItems(
      this.prisma,
      items,
      context,
    );


    // Precio por N unidades de stock: la cotizacion es un documento que se le
    // manda al cliente, asi que el total lo recalcula el servidor por la misma
    // razon que la orden — la escala es del producto y cualquier superficie
    // puede llegar con la aritmetica vieja. Va ANTES del reduce del subtotal
    // para que la cabecera salga de las lineas ya corregidas.
    // Se excluyen las PRESENTACIONES (packSize > 1): ahi `unit_price` es el
    // precio del paquete y `quantity` cuenta paquetes.
    const priceUnits = await normalizePriceUnitLines(this.prisma as any, items, {
      isPresentationAtIndex: (index) =>
        resolvePackSize(
          tierSnapshots[index]?.units_per_package,
          tierSnapshots[index]?.override_units_per_package,
        ) > 1,
    });

    // P1-1: el impuesto lo resuelve el servidor con las tasas asignadas al
    // producto (incluido vs agregado, tipo real). Lo que mande el cliente en
    // `tax_amount_item` ya no decide nada.
    const taxContexts = await this.loadLineTaxContexts(items, tierSnapshots);
    const resolvedLines = this.resolveLines(
      items,
      taxContexts,
      priceUnits.priceUnitByIndex,
    );
    const header = summarizeQuotationLines(
      resolvedLines,
      items.map((item) => item.discount_amount),
    );
    const subtotal = header.subtotal;
    const totalDiscount = header.discount;
    const totalTax = header.tax;
    const grand_total = header.grand_total;

    // F-003 — precarga desde el perfil con la version congelada. Solo
    // rellena vacios: lo digitado manda. `resolveForQuotation` valida el
    // tenant (ERR-04 si es ajeno, 404 si no existe).
    let profileConfig: {
      payment_terms?: string;
      notes?: string;
      validity_days?: number;
    } | null = null;
    if (createQuotationDto.profile_id != null) {
      const resolved = await this.profilesService.resolveForQuotation(
        createQuotationDto.profile_id,
      );
      profileConfig = (resolved as any)?.current_config ?? null;
    }
    const pickText = (
      own: string | undefined | null,
      fromProfile?: string | null,
    ) =>
      own !== undefined && own !== null && own !== ''
        ? own
        : (fromProfile ?? own ?? null);
    const validityDays = profileConfig?.validity_days;
    const validUntil =
      createQuotationDto.valid_until != null &&
      createQuotationDto.valid_until !== ''
        ? new Date(createQuotationDto.valid_until)
        : validityDays != null && validityDays > 0
          ? new Date(Date.now() + validityDays * 86400000)
          : null;

    const quotation = await this.prisma.quotations.create({
      data: {
        store_id,
        customer_id: createQuotationDto.customer_id,
        quotation_number,
        status: quotation_status_enum.draft,
        // A.1 (ADR-01): destino fijo al crear; sin valor nace `sale`.
        destination: (createQuotationDto.destination as any) ?? 'sale',
        profile_id: createQuotationDto.profile_id ?? null,
        channel: (createQuotationDto.channel as any) || 'pos',
        subtotal_amount: subtotal,
        discount_amount: totalDiscount,
        tax_amount: totalTax,
        grand_total,
        valid_until: validUntil,
        notes: pickText(createQuotationDto.notes, profileConfig?.notes),
        internal_notes: createQuotationDto.internal_notes,
        terms_and_conditions: pickText(
          createQuotationDto.terms_and_conditions,
          profileConfig?.payment_terms,
        ),
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
        quotation_items: {
          create: items.map((item, index) => {
            const tierSnap = tierSnapshots[index];
            return {
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              product_name: item.product_name,
              variant_sku: item.variant_sku,
              quantity: item.quantity,
              unit_price: item.unit_price,
              discount_amount: item.discount_amount || 0,
              ...this.lineTaxColumns(resolvedLines[index]),
              notes: item.notes,
              // Multi-tarifa snapshot
              applied_price_tier_id: tierSnap?.tier_id ?? null,
              applied_price_tier_name_snapshot: tierSnap?.tier_name ?? null,
              stock_units_consumed: tierSnap?.stock_units_consumed ?? null,
              price_unit_quantity: priceUnits.priceUnitByIndex[index],
              updated_at: new Date(),
            };
          }),
        },
      },
      include: this.QUOTATION_INCLUDE,
    });

    this.eventEmitter.emit('quotation.created', {
      store_id,
      quotation_id: quotation.id,
      quotation_number: quotation.quotation_number,
    });

    return quotation;
  }

  /** Contract quotes use direct-cost lines and a frozen billing-profile engine. */
  private async createContractQuotation(
    dto: CreateQuotationDto,
    context: NonNullable<ReturnType<typeof RequestContextService.getContext>>,
    store_id: number,
  ) {
    if (!context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    await this.assertContractCustomer(dto.customer_id, context.organization_id, store_id);
    const snapshot = await this.resolveContractEconomicsSnapshot({
      invoice_profile_id: dto.invoice_profile_id,
      profile_id: dto.profile_id,
      contract_object: dto.contract_object,
      due_date: dto.due_date,
      aiu_value: dto.aiu_value,
      items: dto.items ?? [],
    });
    const quotation_number = await this.generateQuotationNumber(store_id);
    const quotationProfileConfig = snapshot.quotation_profile?.config ?? null;
    const pickText = (
      own: string | undefined | null,
      fromProfile?: string | null,
    ) =>
      own !== undefined && own !== null && own !== ''
        ? own
        : (fromProfile ?? own ?? null);
    const validityDays = quotationProfileConfig?.validity_days;
    const validUntil =
      dto.valid_until != null && dto.valid_until !== ''
        ? new Date(dto.valid_until)
        : validityDays != null && validityDays > 0
          ? new Date(Date.now() + validityDays * 86400000)
          : null;
    const totals = snapshot.calculation.totals;

    const quotation = await this.prisma.quotations.create({
      data: {
        store_id,
        customer_id: dto.customer_id,
        quotation_number,
        status: quotation_status_enum.draft,
        destination: 'contract',
        profile_id: dto.profile_id ?? null,
        invoice_profile_id: snapshot.invoice_profile.profile_id,
        invoice_profile_version: snapshot.invoice_profile.version,
        contract_economic_snapshot: this.toContractSnapshotJson(snapshot),
        channel:
          (dto.channel as Prisma.quotationsCreateInput['channel']) || 'pos',
        subtotal_amount: new Prisma.Decimal(totals.gross_subtotal),
        discount_amount: new Prisma.Decimal(totals.discount_amount),
        tax_amount: new Prisma.Decimal(totals.tax_amount),
        grand_total: new Prisma.Decimal(totals.total_amount),
        valid_until: validUntil,
        notes: pickText(dto.notes, quotationProfileConfig?.notes),
        internal_notes: dto.internal_notes,
        terms_and_conditions: pickText(
          dto.terms_and_conditions,
          quotationProfileConfig?.payment_terms,
        ),
        created_by_user_id: context.user_id,
        updated_at: new Date(),
        quotation_items: {
          create: this.contractCostQuotationItems(dto.items ?? []),
        },
      },
      include: this.QUOTATION_INCLUDE,
    });

    this.eventEmitter.emit('quotation.created', {
      store_id,
      quotation_id: quotation.id,
      quotation_number: quotation.quotation_number,
    });
    return quotation;
  }

  async previewContractEconomics(dto: {
    quotation_id?: number;
    invoice_profile_id?: number;
    contract_object?: string;
    due_date?: string;
    aiu_value?: number;
    items?: CreateQuotationDto['items'];
  }) {
    let quotation: any = null;
    if (dto.quotation_id != null) {
      quotation = await this.findOne(dto.quotation_id);
      if (quotation.destination !== 'contract') {
        throw new BadRequestException(
          'La vista previa de economía AIU sólo aplica a cotizaciones de contrato.',
        );
      }
      if (quotation.status !== quotation_status_enum.draft) {
        throw new BadRequestException(
          'Solo se puede previsualizar la economía de un contrato en borrador.',
        );
      }
    }

    const existingSnapshot = quotation
      ? this.readContractEconomicSnapshot(quotation.contract_economic_snapshot)
      : null;
    const items =
      dto.items ??
      (quotation?.quotation_items.map((item: any) => ({
        ...item,
        unit_price: Number(item.unit_price),
        discount_amount: Number(item.discount_amount ?? 0),
      })) as CreateQuotationDto['items'] | undefined) ??
      [];
    return this.resolveContractEconomicsSnapshot({
      invoice_profile_id: dto.invoice_profile_id,
      profile_id: quotation?.profile_id ?? undefined,
      contract_object: dto.contract_object,
      due_date: dto.due_date,
      aiu_value: dto.aiu_value,
      items,
      existing_snapshot: existingSnapshot,
      quotation_profile: existingSnapshot?.quotation_profile,
    });
  }

  async findAll(query: QuotationQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.quotationsWhereInput = {
      ...(search && {
        OR: [
          {
            quotation_number: { contains: search, mode: 'insensitive' as any },
          },
          { notes: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(status && { status: status as quotation_status_enum }),
      ...(customer_id && { customer_id }),
      ...(date_from &&
        date_to && {
          created_at: {
            gte: new Date(date_from),
            lte: new Date(date_to),
          },
        }),
    };

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [rawData, total] = await Promise.all([
      this.prisma.quotations.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.QUOTATION_INCLUDE,
      }),
      this.prisma.quotations.count({ where }),
    ]);
    const data = await this.withContractReferences(rawData);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const quotation = await this.prisma.quotations.findFirst({
      where: { id },
      include: this.QUOTATION_INCLUDE,
    });
    if (!quotation) throw new NotFoundException('Cotización no encontrada');
    return (await this.withContractReferences([quotation]))[0];
  }

  /** Attach only tenant-owned contract references; to-one relation includes
   * cannot apply a nested WHERE, so query the relation with an explicit scope. */
  private async withContractReferences<
    T extends { id: number; status?: string },
  >(rows: T[]) {
    const context = RequestContextService.getContext();
    const quotationIds = rows
      .filter((row) => row.status === 'contracted')
      .map((row) => row.id);
    if (!quotationIds.length || !context?.store_id || !context.organization_id) {
      return rows.map((row) => ({ ...row, contract: null }));
    }
    const contracts = await this.prisma.contracts.findMany({
      where: {
        quotation_id: { in: quotationIds },
        store_id: context.store_id,
        organization_id: context.organization_id,
      },
      select: {
        quotation_id: true,
        id: true,
        contract_number: true,
        status: true,
      },
    });
    const byQuotationId = new Map(
      contracts.map((contract) => [
        contract.quotation_id,
        {
          id: contract.id,
          contract_number: contract.contract_number,
          status: contract.status,
        },
      ]),
    );
    return rows.map((row) => ({
      ...row,
      contract: byQuotationId.get(row.id) ?? null,
    }));
  }

  async update(id: number, updateQuotationDto: UpdateQuotationDto) {
    // A.1 (ADR-01, ERR-01): el destino se fija al crear y jamas se edita.
    // Cualquier presencia (incluso el mismo valor) se rechaza: corregir un
    // destino mal marcado exige cancelar y recrear la cotizacion.
    if ((updateQuotationDto as any).destination !== undefined) {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_DESTINATION_001,
        undefined,
        {
          quotation_id: id,
          attempted_destination: (updateQuotationDto as any).destination,
        },
      );
    }
    const quotation = await this.findOne(id);
    if (quotation.status !== quotation_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden editar cotizaciones en estado borrador',
      );
    }

    if (quotation.destination === 'contract') {
      return this.updateContractQuotation(id, quotation, updateQuotationDto);
    }
    this.assertNoContractEconomicsFields(updateQuotationDto);

    // If items are provided, delete and recreate
    if (updateQuotationDto.items) {
      const ctx = RequestContextService.getContext();
      const tierSnapshots = await resolveTierSnapshotsForItems(
        this.prisma,
        updateQuotationDto.items,
        ctx,
      );
      // Fuera de la transacción: las tasas se leen por el cliente scoped y no
      // ocupan una segunda conexión mientras `tx` sostiene locks.
      const taxContexts = await this.loadLineTaxContexts(
        updateQuotationDto.items,
        tierSnapshots,
      );

      return this.prisma.$transaction(async (tx) => {
        await tx.quotation_items.deleteMany({ where: { quotation_id: id } });

        const items = updateQuotationDto.items!;
        // Misma correccion que en create. El cliente Prisma que entra es `tx`:
        // tomar `this.prisma` dentro de la transaccion abriria una segunda
        // conexion del pool y perderia el scoping de tenant.
        const priceUnits = await normalizePriceUnitLines(tx as any, items, {
          isPresentationAtIndex: (index) =>
            resolvePackSize(
              tierSnapshots[index]?.units_per_package,
              tierSnapshots[index]?.override_units_per_package,
            ) > 1,
        });
        const resolvedLines = this.resolveLines(
          items,
          taxContexts,
          priceUnits.priceUnitByIndex,
        );
        const header = summarizeQuotationLines(
          resolvedLines,
          items.map((item) => item.discount_amount),
        );
        const subtotal = header.subtotal;
        const totalDiscount = header.discount;
        const totalTax = header.tax;
        const grand_total = header.grand_total;

        return tx.quotations.update({
          where: { id },
          data: {
            customer_id:
              updateQuotationDto.customer_id ?? quotation.customer_id,
            channel: (updateQuotationDto.channel as any) ?? quotation.channel,
            valid_until: updateQuotationDto.valid_until
              ? new Date(updateQuotationDto.valid_until)
              : quotation.valid_until,
            notes: updateQuotationDto.notes ?? quotation.notes,
            internal_notes:
              updateQuotationDto.internal_notes ?? quotation.internal_notes,
            terms_and_conditions:
              updateQuotationDto.terms_and_conditions ??
              quotation.terms_and_conditions,
            subtotal_amount: subtotal,
            discount_amount: totalDiscount,
            tax_amount: totalTax,
            grand_total,
            updated_at: new Date(),
            quotation_items: {
              create: items.map((item, index) => {
                const tierSnap = tierSnapshots[index];
                return {
                  product_id: item.product_id,
                  product_variant_id: item.product_variant_id,
                  product_name: item.product_name,
                  variant_sku: item.variant_sku,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  discount_amount: item.discount_amount || 0,
                  ...this.lineTaxColumns(resolvedLines[index]),
                  notes: item.notes,
                  applied_price_tier_id: tierSnap?.tier_id ?? null,
                  applied_price_tier_name_snapshot:
                    tierSnap?.tier_name ?? null,
                  stock_units_consumed: tierSnap?.stock_units_consumed ?? null,
                  price_unit_quantity: priceUnits.priceUnitByIndex[index],
                  updated_at: new Date(),
                };
              }),
            },
          },
          include: this.QUOTATION_INCLUDE,
        });
      });
    }

    // Update without items
    // A.1: `destination` fuera del spread por defensa en profundidad (el
    // guard de arriba ya lo rechaza; esto impide que llegue a Prisma).
    const {
      items: _items,
      destination: _destination,
      ...updateData
    } = updateQuotationDto as any;
    return this.prisma.quotations.update({
      where: { id },
      data: {
        ...updateData,
        valid_until: updateData.valid_until
          ? new Date(updateData.valid_until)
          : undefined,
        updated_at: new Date(),
      },
      include: this.QUOTATION_INCLUDE,
    });
  }

  private async updateContractQuotation(
    id: number,
    quotation: any,
    dto: UpdateQuotationDto,
  ) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    await this.assertContractCustomer(
      dto.customer_id ?? quotation.customer_id,
      context.organization_id,
      context.store_id,
    );
    const existingSnapshot = this.readContractEconomicSnapshot(
      quotation.contract_economic_snapshot,
    );
    if (!existingSnapshot && dto.invoice_profile_id == null) {
      throw new BadRequestException(
        'Esta cotización de contrato no tiene economía congelada. Selecciona explícitamente un perfil AIU para recalcularla.',
      );
    }

    const items =
      dto.items ??
      (quotation.quotation_items.map((item: any) => ({
        ...item,
        unit_price: Number(item.unit_price),
        discount_amount: Number(item.discount_amount ?? 0),
      })) as CreateQuotationDto['items']);
    const recalculate =
      !existingSnapshot ||
      dto.items !== undefined ||
      dto.invoice_profile_id !== undefined ||
      dto.contract_object !== undefined ||
      dto.aiu_value !== undefined ||
      dto.due_date !== undefined;
    const snapshot = recalculate
      ? await this.resolveContractEconomicsSnapshot({
          invoice_profile_id: dto.invoice_profile_id,
          profile_id: quotation.profile_id ?? undefined,
          contract_object:
            dto.contract_object ?? existingSnapshot?.contract_object,
          due_date: dto.due_date ?? existingSnapshot?.due_date,
          // A stored snapshot's `aiu_value` is a calculated output for
          // contract-basis profiles. The resolver only reuses it as an input
          // when the frozen profile explicitly uses an AIU-based component
          // basis.
          aiu_value: dto.aiu_value,
          items,
          existing_snapshot: existingSnapshot,
          quotation_profile: existingSnapshot?.quotation_profile,
        })
      : existingSnapshot;

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // Raw transaction clients are unscoped: CAS includes both tenant anchors
      // and the draft state before any line deletion/recreation.
      const locked = await tx.quotations.updateMany({
        where: {
          id,
          store_id: context.store_id,
          status: quotation_status_enum.draft,
          updated_at: quotation.updated_at,
          store: { is: { organization_id: context.organization_id } },
        },
        data: { updated_at: now },
      });
      if (locked.count !== 1) {
        throw new BadRequestException(
          'La cotización dejó de ser un borrador editable; vuelve a cargarla antes de guardar.',
        );
      }

      if (dto.items !== undefined) {
        await tx.quotation_items.deleteMany({ where: { quotation_id: id } });
      }

      const data: Prisma.quotationsUncheckedUpdateInput = {
        customer_id: dto.customer_id,
        channel: dto.channel as Prisma.quotationsUncheckedUpdateInput['channel'],
        valid_until:
          dto.valid_until !== undefined
            ? dto.valid_until
              ? new Date(dto.valid_until)
              : null
            : undefined,
        notes: dto.notes,
        internal_notes: dto.internal_notes,
        terms_and_conditions: dto.terms_and_conditions,
        updated_at: now,
        ...(recalculate && snapshot
          ? {
              contract_economic_snapshot: this.toContractSnapshotJson(snapshot),
              invoice_profile_id: snapshot.invoice_profile.profile_id,
              invoice_profile_version: snapshot.invoice_profile.version,
              subtotal_amount: new Prisma.Decimal(
                snapshot.calculation.totals.gross_subtotal,
              ),
              discount_amount: new Prisma.Decimal(
                snapshot.calculation.totals.discount_amount,
              ),
              tax_amount: new Prisma.Decimal(snapshot.calculation.totals.tax_amount),
              grand_total: new Prisma.Decimal(snapshot.calculation.totals.total_amount),
            }
          : {}),
        ...(dto.items !== undefined
          ? { quotation_items: { create: this.contractCostQuotationItems(dto.items) } }
          : {}),
      };
      return tx.quotations.update({
        where: { id },
        data,
        include: this.QUOTATION_INCLUDE,
      });
    });
  }

  async remove(id: number) {
    const quotation = await this.findOne(id);
    if (quotation.status !== quotation_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden eliminar cotizaciones en estado borrador',
      );
    }
    return this.prisma.quotations.delete({ where: { id } });
  }

  // State transition methods
  async send(id: number) {
    const quotation = await this.transition(id, 'sent', {
      sent_at: new Date(),
    });

    // Send email if customer has email (fire-and-forget)
    if (quotation.customer?.email) {
      this.sendQuotationEmail(quotation).catch((err) => {
        // Log but don't throw - the status change already succeeded
        console.error(
          `Failed to send quotation email for ${quotation.quotation_number}:`,
          err,
        );
      });
    }

    return quotation;
  }

  async accept(id: number) {
    return this.transition(id, 'accepted', { accepted_at: new Date() });
  }

  async reject(id: number) {
    return this.transition(id, 'rejected', { rejected_at: new Date() });
  }

  async cancel(id: number) {
    const quotation = await this.findOne(id);
    const allowed = this.VALID_TRANSITIONS[quotation.status] || [];
    if (!allowed.includes('cancelled')) {
      throw new BadRequestException(
        `No se puede cancelar una cotización en estado "${quotation.status}"`,
      );
    }
    const context = RequestContextService.getContext();
    const marked = await this.prisma.quotations.updateMany({
      where: {
        id,
        status: quotation.status,
        ...(context?.store_id && { store_id: context.store_id }),
        ...(context?.organization_id && {
          store: { is: { organization_id: context.organization_id } },
        }),
      } satisfies Prisma.quotationsWhereInput,
      data: { status: quotation_status_enum.cancelled, updated_at: new Date() },
    });
    if (marked.count !== 1) {
      throw new BadRequestException(
        'La cotización cambió de estado y ya no puede cancelarse.',
      );
    }
    return this.findOne(id);
  }

  async convertToOrder(id: number) {
    const quotation = await this.findOne(id);
    if (quotation.status !== quotation_status_enum.accepted) {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_CONVERT_STATUS_001,
        undefined,
        {
          current_status: quotation.status,
          required_status: quotation_status_enum.accepted,
        },
      );
    }

    // F-001 (ADR-01, ERR-01): lado venta del bloqueo mutuo. Solo destino
    // `sale` crea orden; `contract`/`other` se rechazan con el mismo codigo
    // que el lado contrato, para que ninguna via produzca doble ingreso.
    if ((quotation as any).destination !== 'sale') {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_DESTINATION_001,
        'Solo las cotizaciones con destino venta crean orden.',
        {
          quotation_id: quotation.id,
          destination: (quotation as any).destination,
          required_destination: 'sale',
        },
      );
    }

    if (!quotation.customer_id) {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_CONVERT_CUSTOMER_001,
        undefined,
        { quotation_id: quotation.id },
      );
    }

    const context = RequestContextService.getContext();

    // P1-1: la línea de orden sigue ADR-08 — `unit_price` es la BASE neta
    // por unidad de precio y `tax_amount_item` el impuesto POR UNIDAD de
    // precio. `orders.create` escala ese escalar por `line_units` al escribir
    // `order_item_taxes`, así que mandarle el impuesto de LÍNEA (lo que guarda
    // `quotation_items.tax_amount_item`) lo multiplicaba otra vez por la
    // cantidad. Se re-resuelve con el mismo resolver que usó la cotización
    // (precio declarado + tasas del producto): cotizaciones viejas, grabadas
    // con el impuesto sumado a ciegas, se convierten con el impuesto correcto.
    const quotationItems: any[] = quotation.quotation_items;
    const tierSnapshots = await resolveTierSnapshotsForItems(
      this.prisma,
      quotationItems.map((item) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        quantity: item.quantity,
        applied_price_tier_id: item.applied_price_tier_id,
      })),
      context,
    );
    const taxContexts = await this.loadLineTaxContexts(
      quotationItems.map((item) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        unit_price: Number(item.unit_price),
        quantity: item.quantity,
        discount_amount: Number(item.discount_amount || 0),
        tax_rate: item.tax_rate != null ? Number(item.tax_rate) : undefined,
      })),
      tierSnapshots,
    );
    const priceUnitByIndex = quotationItems.map((item) =>
      item.price_unit_quantity != null ? Number(item.price_unit_quantity) : null,
    );
    const resolvedLines = this.resolveLines(
      quotationItems,
      taxContexts,
      priceUnitByIndex,
    );
    const header = summarizeQuotationLines(
      resolvedLines,
      quotationItems.map((item) => Number(item.discount_amount || 0)),
    );

    // Map quotation items to order items format. B.3: sin producto viaja
    // como linea `custom` (el DTO de orden lo admite con product_id ausente).
    const orderItems = quotationItems.map((item: any, index: number) => {
      const line = resolvedLines[index];
      return {
        ...(item.product_id == null ? { item_type: 'custom' } : {}),
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        product_name: item.product_name,
        variant_sku: item.variant_sku,
        quantity: item.quantity,
        unit_price: line.unit_base_price,
        total_price: line.line_net_total,
        tax_rate: line.tax_rate > 0 ? line.tax_rate : undefined,
        tax_amount_item:
          line.unit_tax_amount > 0 ? line.unit_tax_amount : undefined,
        // Escala de la línea: `orders.create` la lee para `line_units` al
        // escalar el impuesto por unidad a `order_item_taxes`.
        price_unit_quantity: priceUnitByIndex[index],
        // Bruto por unidad explícito: sin él `orders.create` lo deriva de
        // `unit_price` con las tasas de catálogo, que para un precio manual
        // (bruto declarado, todo incluido) no reproduce lo cotizado.
        final_unit_price: line.unit_final_price,
        ...(line.declared_gross
          ? {
              is_price_overridden: true,
              price_override_reason: `Precio de cotización ${quotation.quotation_number}`,
            }
          : {}),
        // Multi-tarifa: propagar el tier elegido al convertir cotización a orden.
        applied_price_tier_id: item.applied_price_tier_id ?? undefined,
      };
    });

    // Create order using OrdersService
    const order = await this.ordersService.create(
      {
        customer_id: quotation.customer_id!,
        items: orderItems,
        subtotal: header.subtotal,
        tax_amount: header.tax,
        discount_amount: header.discount,
        total_amount: header.grand_total,
        internal_notes: `Convertida desde cotización ${quotation.quotation_number}`,
        channel: quotation.channel,
      } as any,
      { id: context?.user_id },
    );

    // Update quotation status
    const updated = await this.prisma.quotations.update({
      where: { id },
      data: {
        status: quotation_status_enum.converted,
        converted_at: new Date(),
        converted_order_id: order.id,
        updated_at: new Date(),
      },
      include: this.QUOTATION_INCLUDE,
    });

    this.eventEmitter.emit('quotation.converted', {
      quotation_id: id,
      order_id: order.id,
      quotation_number: quotation.quotation_number,
      order_number: order.order_number,
    });

    return updated;
  }

  async duplicate(id: number) {
    const quotation = await this.findOne(id);
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const quotation_number = await this.generateQuotationNumber(store_id);

    const duplicated = await this.prisma.quotations.create({
      data: {
        store_id,
        customer_id: quotation.customer_id,
        quotation_number,
        status: quotation_status_enum.draft,
        // A.1: el duplicado hereda el destino (fijado al crear, no editable).
        destination: (quotation as any).destination ?? 'sale',
        profile_id:
          (quotation as any).destination === 'contract'
            ? quotation.profile_id ?? null
            : undefined,
        contract_economic_snapshot:
          quotation.contract_economic_snapshot ?? Prisma.DbNull,
        invoice_profile_id: quotation.invoice_profile_id ?? null,
        invoice_profile_version: quotation.invoice_profile_version ?? null,
        channel: quotation.channel,
        subtotal_amount: quotation.subtotal_amount,
        discount_amount: quotation.discount_amount,
        tax_amount: quotation.tax_amount,
        grand_total: quotation.grand_total,
        notes: quotation.notes,
        internal_notes: quotation.internal_notes,
        terms_and_conditions: quotation.terms_and_conditions,
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
        quotation_items: {
          create: quotation.quotation_items.map((item: any) => ({
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            product_name: item.product_name,
            variant_sku: item.variant_sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_amount: item.discount_amount,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
            total_price: item.total_price,
            notes: item.notes,
            updated_at: new Date(),
          })),
        },
      },
      include: this.QUOTATION_INCLUDE,
    });

    return duplicated;
  }

  async getStats() {
    const [total, draft, sent, accepted, converted, totalValue] =
      await Promise.all([
        this.prisma.quotations.count(),
        this.prisma.quotations.count({ where: { status: 'draft' } }),
        this.prisma.quotations.count({ where: { status: 'sent' } }),
        this.prisma.quotations.count({ where: { status: 'accepted' } }),
        this.prisma.quotations.count({ where: { status: 'converted' } }),
        this.prisma.quotations.aggregate({ _sum: { grand_total: true } }),
      ]);

    const pending = draft + sent;
    const conversionRate =
      accepted + converted > 0 && total > 0
        ? ((accepted + converted) / total) * 100
        : 0;
    const averageValue =
      total > 0 ? Number(totalValue._sum.grand_total || 0) / total : 0;

    return {
      total,
      pending,
      conversion_rate: Math.round(conversionRate * 100) / 100,
      average_value: Math.round(averageValue * 100) / 100,
      draft,
      sent,
      accepted,
      converted,
    };
  }

  // Private helpers
  private assertNoContractEconomicsFields(
    dto: Pick<
      CreateQuotationDto,
      'invoice_profile_id' | 'contract_object' | 'aiu_value' | 'due_date'
    >,
  ): void {
    if (
      dto.invoice_profile_id !== undefined ||
      dto.contract_object !== undefined ||
      dto.aiu_value !== undefined ||
      dto.due_date !== undefined
    ) {
      throw new BadRequestException(
        'Los campos de economía AIU sólo se admiten en cotizaciones con destino contrato.',
      );
    }
  }

  private async assertContractCustomer(
    customer_id: number | null | undefined,
    organization_id: number,
    store_id: number,
  ): Promise<void> {
    if (customer_id == null) {
      throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    }
    const customer = await this.prisma.users.findFirst({
      where: {
        id: customer_id,
        organization_id,
        store_users: { some: { store_id } },
        user_roles: { some: { roles: { name: 'customer' } } },
      },
      select: { id: true },
    });
    if (!customer) throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
  }

  private async resolveContractEconomicsSnapshot(input: {
    invoice_profile_id?: number;
    profile_id?: number;
    contract_object?: string | null;
    due_date?: string | null;
    aiu_value?: string | number;
    items: CreateQuotationDto['items'];
    existing_snapshot?: QuotationContractEconomicSnapshot | null;
    quotation_profile?: FrozenQuotationProfile | null;
  }): Promise<QuotationContractEconomicSnapshot> {
    if (!input.items.length) {
      throw new BadRequestException(
        'Agrega al menos una línea de costo directo para cotizar el contrato.',
      );
    }
    if (input.items.length > 100) {
      throw new BadRequestException(
        'Una cotización de contrato admite hasta 100 líneas de costo directo.',
      );
    }
    await this.assertContractItemReferences(input.items);

    const invoiceProfile =
      input.invoice_profile_id != null
        ? await this.resolveInvoiceProfileSnapshot(input.invoice_profile_id)
        : (input.existing_snapshot?.invoice_profile ?? null);
    if (!invoiceProfile) {
      throw new BadRequestException(
        'Selecciona un perfil de facturación AIU para definir impuestos y condiciones del contrato.',
      );
    }

    const quotationProfile =
      input.quotation_profile ??
      input.existing_snapshot?.quotation_profile ??
      (input.profile_id != null
        ? await this.resolveQuotationProfileSnapshot(input.profile_id)
        : null);
    const costLines = this.contractCostLines(input.items);
    const componentsBasis = resolveAiuComponentsBasis(
      invoiceProfile.config.aiu,
    );
    const aiuConfig = invoiceProfile.config.aiu;
    const pureAiuNoSumada =
      aiuConfig?.accounting_model === 'no_sumada' &&
      Object.values(aiuConfig.components ?? {}).reduce(
        (sum, value) => sum + Number(value || 0),
        0,
      ) === 100 &&
      costLines.every(
        (line) => Number(line.unit_price) === 0 && Number(line.discount_amount ?? 0) === 0,
      );
    const aiu_value =
      input.aiu_value ??
      (componentsBasis === 'aiu' || pureAiuNoSumada
        ? input.existing_snapshot?.aiu_value
        : undefined);
    return buildQuotationContractEconomicSnapshot({
      frozen_at: new Date().toISOString(),
      invoice_profile: invoiceProfile,
      quotation_profile: quotationProfile,
      contract_object:
        input.contract_object ?? input.existing_snapshot?.contract_object,
      due_date: input.due_date ?? input.existing_snapshot?.due_date,
      aiu_value,
      cost_lines: costLines,
    });
  }

  private async resolveInvoiceProfileSnapshot(
    profile_id: number,
  ): Promise<FrozenInvoiceProfile> {
    if (!this.invoiceProfilesService) {
      throw new Error(
        'ProfilesService must be provided by QuotationsModule to quote contracts.',
      );
    }
    // ProfilesService.findOne uses the store-scoped Prisma client. A foreign
    // profile and a missing profile therefore have the same non-enumerating 404.
    const profile = await this.invoiceProfilesService.findOne(profile_id);
    if (profile.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_006,
        'El perfil de facturación AIU está inactivo. Actívalo antes de usarlo en una cotización.',
        { profile_id, operation_type: profile.operation_type },
      );
    }
    if (profile.operation_type !== DIAN_INVOICE_OPERATION_TYPES.AIU) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_008,
        'La cotización de contrato requiere un perfil de operación AIU (09).',
        {
          profile_id,
          profile_operation_type: profile.operation_type,
          required_operation_type: DIAN_INVOICE_OPERATION_TYPES.AIU,
        },
      );
    }
    const version = profile.version;
    if (!version || version.version !== profile.current_version) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_009,
        'El perfil AIU no tiene una versión vigente comprometida. Guarda el perfil antes de cotizar.',
        { profile_id, current_version: profile.current_version },
      );
    }
    const config = normalizeAndAssertProfileConfig(version.config, {
      operation_type: profile.operation_type,
      profile_id,
    });
    if (
      config.dian.document_type != null &&
      config.dian.document_type !== 'sales_invoice'
    ) {
      throw new BadRequestException(
        'La cotización de contrato requiere un perfil para factura de venta electrónica.',
      );
    }
    return {
      profile_id: profile.id,
      version: version.version,
      name: profile.name,
      config,
    };
  }

  private async resolveQuotationProfileSnapshot(
    profile_id: number,
  ): Promise<FrozenQuotationProfile> {
    const profile = await this.profilesService.resolveForQuotation(profile_id);
    const version = profile.version;
    if (!version || version.version !== profile.current_version) {
      throw new BadRequestException(
        'El perfil de cotización no tiene una versión vigente; guárdalo antes de usarlo.',
      );
    }
    return {
      profile_id: profile.id,
      version: version.version,
      config: profile.current_config as QuotationProfileConfig,
    };
  }

  private contractCostLines(
    items: CreateQuotationDto['items'],
  ): ProfileContractCostLine[] {
    return items.map((item, index) => {
      const unit_price = this.normalizeContractMoney(item.unit_price);
      const quantity = Number(item.quantity);
      const discount_amount = this.normalizeContractMoney(
        item.discount_amount ?? 0,
      );
      if (
        !Number.isFinite(Number(unit_price)) ||
        Number(unit_price) < 0 ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(Number(discount_amount)) ||
        Number(discount_amount) < 0
      ) {
        throw new BadRequestException(
          `La línea ${index + 1} requiere cantidad, costo y descuento no negativos válidos.`,
        );
      }
      const net = Number(
        dianLineExtension({ quantity, unit_price, discount_amount }),
      );
      if (!Number.isFinite(net) || net < 0) {
        throw new BadRequestException(
          `El descuento de la línea ${index + 1} supera su costo directo.`,
        );
      }
      return {
        description: item.product_name,
        quantity,
        unit_price,
        discount_amount,
      };
    });
  }

  private normalizeContractMoney(value: number | string): string {
    return new Prisma.Decimal(value)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);
  }

  private async assertContractItemReferences(
    items: CreateQuotationDto['items'],
  ): Promise<void> {
    const productIds = Array.from(
      new Set(items.flatMap((item) => (item.product_id ? [item.product_id] : []))),
    );
    const variantIds = Array.from(
      new Set(
        items.flatMap((item) =>
          item.product_variant_id ? [item.product_variant_id] : [],
        ),
      ),
    );
    const [products, variants] = await Promise.all([
      productIds.length
        ? this.prisma.products.findMany({
            where: { id: { in: productIds } },
            select: { id: true },
          })
        : Promise.resolve([] as Array<{ id: number }>),
      variantIds.length
        ? this.prisma.product_variants.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, product_id: true },
          })
        : Promise.resolve([] as Array<{ id: number; product_id: number }>),
    ]);
    if (products.length !== productIds.length || variants.length !== variantIds.length) {
      throw new BadRequestException(
        'Una o más referencias de producto no existen en esta tienda.',
      );
    }
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    for (const item of items) {
      if (item.product_variant_id == null) continue;
      const variant = variantById.get(item.product_variant_id);
      if (!variant || (item.product_id != null && variant.product_id !== item.product_id)) {
        throw new BadRequestException(
          'La variante indicada no pertenece al producto de esta línea.',
        );
      }
    }
  }

  private contractCostQuotationItems(items: CreateQuotationDto['items']) {
    return items.map((item) => {
      const unit_price = this.normalizeContractMoney(item.unit_price);
      const discount_amount = this.normalizeContractMoney(
        item.discount_amount ?? 0,
      );
      return {
        product_id: item.product_id ?? null,
        product_variant_id: item.product_variant_id ?? null,
        product_name: item.product_name,
        variant_sku: item.variant_sku ?? null,
        quantity: item.quantity,
        unit_price,
        discount_amount,
        // Contract quotes preserve direct cost only; fiscal rules and generated
        // A/I/U lines live in contract_economic_snapshot, never product taxes.
        tax_rate: null,
        tax_amount_item: null,
        total_price: dianLineExtension({
          quantity: item.quantity,
          unit_price,
          discount_amount,
        }),
        notes: item.notes ?? null,
        applied_price_tier_id: null,
        applied_price_tier_name_snapshot: null,
        stock_units_consumed: null,
        price_unit_quantity: null,
        updated_at: new Date(),
      };
    });
  }

  private readContractEconomicSnapshot(
    value: unknown,
  ): QuotationContractEconomicSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.schema_version !== 1 ||
      typeof candidate.frozen_at !== 'string' ||
      typeof candidate.contract_object !== 'string' ||
      !(candidate.due_date === null || typeof candidate.due_date === 'string') ||
      !candidate.invoice_profile ||
      typeof candidate.invoice_profile !== 'object' ||
      !Array.isArray(candidate.invoice_lines) ||
      !candidate.calculation ||
      typeof candidate.calculation !== 'object'
    ) {
      return null;
    }
    return value as QuotationContractEconomicSnapshot;
  }

  private toContractSnapshotJson(
    snapshot: QuotationContractEconomicSnapshot,
  ): Prisma.InputJsonValue {
    // Prisma JSON columns accept JSON primitives/objects, not class instances
    // like Decimal; stringify also strips any absent optional fields.
    return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
  }

  private assertContractQuotationAiuNote(snapshotValue: unknown): void {
    const snapshot = this.readContractEconomicSnapshot(snapshotValue);
    if (!snapshot) {
      throw new BadRequestException(
        'No se puede enviar o aceptar esta cotización de contrato: falta la economía AIU congelada. Elige un perfil de facturación AIU y vuelve a guardar el borrador.',
      );
    }
    const note = buildAiuNote(snapshot.contract_object);
    if (
      note.length < DIAN_AIU_NOTE_MIN_LENGTH ||
      note.length > DIAN_AIU_NOTE_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `No se puede enviar o aceptar la cotización: el objeto del contrato debe generar una nota AIU de ${DIAN_AIU_NOTE_MIN_LENGTH} a ${DIAN_AIU_NOTE_MAX_LENGTH} caracteres contando el prefijo DIAN.`,
      );
    }
  }

  private assertContractDueDate(snapshotValue: unknown): void {
    const snapshot = this.readContractEconomicSnapshot(snapshotValue);
    if (
      snapshot?.invoice_profile.config.dian.payment_method_code === '2' &&
      !snapshot.due_date
    ) {
      throw new BadRequestException(
        'No se puede enviar o aceptar esta cotización de contrato a crédito sin una fecha de vencimiento acordada.',
      );
    }
  }

  private async sendQuotationEmail(quotation: any): Promise<void> {
    const storeName = await this.getStoreName();
    const html = generateQuotationEmailHtml({
      quotation_number: quotation.quotation_number,
      customer_name: `${quotation.customer.first_name} ${quotation.customer.last_name}`,
      valid_until: quotation.valid_until
        ? new Date(quotation.valid_until).toLocaleDateString('es-CO', {
            timeZone: 'UTC',
          })
        : null,
      items: quotation.quotation_items.map((item: any) => ({
        product_name: item.product_name,
        variant_sku: item.variant_sku,
        applied_price_tier_name_snapshot:
          item.applied_price_tier_name_snapshot ?? null,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
        total_price: Number(item.total_price),
      })),
      subtotal: Number(quotation.subtotal_amount),
      discount: Number(quotation.discount_amount),
      tax: Number(quotation.tax_amount),
      total: Number(quotation.grand_total),
      notes: quotation.notes,
      terms_and_conditions: quotation.terms_and_conditions,
      store_name: storeName,
    });

    await this.emailService.sendEmail(
      quotation.customer.email,
      `Cotización ${quotation.quotation_number} - ${storeName}`,
      html,
    );
  }

  private async getStoreName(): Promise<string> {
    try {
      const context = RequestContextService.getContext();
      if (context?.store_id) {
        const store = await this.prisma.stores.findFirst({
          where: { id: context.store_id },
          select: { name: true },
        });
        return store?.name || 'Vendix';
      }
    } catch {}
    return 'Vendix';
  }

  private async transition(
    id: number,
    newStatus: string,
    extraData: Record<string, any> = {},
  ) {
    const quotation = await this.findOne(id);
    const allowed = this.VALID_TRANSITIONS[quotation.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `No se puede cambiar de "${quotation.status}" a "${newStatus}"`,
      );
    }
    if (
      quotation.destination === 'contract' &&
      (newStatus === 'sent' || newStatus === 'accepted')
    ) {
      this.assertContractQuotationAiuNote(quotation.contract_economic_snapshot);
      this.assertContractDueDate(quotation.contract_economic_snapshot);
      return this.transitionContractQuotation(
        id,
        quotation,
        newStatus,
        extraData,
      );
    }
    return this.prisma.quotations.update({
      where: { id },
      data: {
        status: newStatus as quotation_status_enum,
        ...extraData,
        updated_at: new Date(),
      },
      include: this.QUOTATION_INCLUDE,
    });
  }

  private async transitionContractQuotation(
    id: number,
    quotation: any,
    newStatus: string,
    extraData: Record<string, any>,
  ) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const marked = await this.prisma.quotations.updateMany({
      where: {
        id,
        status: quotation.status,
        updated_at: quotation.updated_at,
        store_id: context.store_id,
        store: { is: { organization_id: context.organization_id } },
      },
      data: {
        status: newStatus as quotation_status_enum,
        ...extraData,
        updated_at: new Date(),
      },
    });
    if (marked.count !== 1) {
      throw new BadRequestException(
        'La cotización cambió mientras se validaba su economía AIU. Recárgala y revisa el borrador antes de continuar.',
      );
    }
    return this.findOne(id);
  }

  /**
   * P1-1 — tasas de cada línea y si su precio es de catálogo o manual.
   *
   * Producto: las tasas salen de `calculateProductTaxes` (asignación ?? tasa
   * para `is_inclusive`, tipo fiscal de la categoría). El precio es de
   * CATÁLOGO si coincide al centavo con alguno publicado (base, oferta,
   * override de variante, precio de la tarifa aplicada); si no, es MANUAL y se
   * trata como bruto declarado (regla del POS).
   *
   * Línea libre (sin producto): la tasa que digitó el usuario, agregada sobre
   * el precio (así la rotula el modal: «% IVA» sobre el precio neto). Sin
   * categoría no hay tipo fiscal que afirmar: `tax_type` queda `null`.
   */
  private async loadLineTaxContexts(
    items: QuotationTaxableItem[],
    tierSnapshots: Array<TierSnapshot | null | undefined>,
  ): Promise<QuotationLineTaxContext[]> {
    const productIds = Array.from(
      new Set(
        items
          .map((item) => item.product_id)
          .filter((id): id is number => id != null)
          .map(Number),
      ),
    );
    const variantIds = Array.from(
      new Set(
        items
          .map((item) => item.product_variant_id)
          .filter((id): id is number => id != null)
          .map(Number),
      ),
    );

    const [products, variants] = await Promise.all([
      productIds.length > 0
        ? this.prisma.products.findMany({
            where: { id: { in: productIds } },
            select: {
              id: true,
              base_price: true,
              is_on_sale: true,
              sale_price: true,
            },
          })
        : Promise.resolve([] as any[]),
      variantIds.length > 0
        ? this.prisma.product_variants.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              product_id: true,
              price_override: true,
              is_on_sale: true,
              sale_price: true,
            },
          })
        : Promise.resolve([] as any[]),
    ]);
    const productById = new Map<number, any>(
      (products as any[]).map((p) => [Number(p.id), p]),
    );
    const variantById = new Map<number, any>(
      (variants as any[]).map((v) => [Number(v.id), v]),
    );

    const ratesByProduct = new Map<number, QuotationLineRate[]>();
    for (const productId of productIds) {
      const info = this.taxesService
        ? await this.taxesService.calculateProductTaxes(productId, 0)
        : { taxes: [] as any[] };
      ratesByProduct.set(
        productId,
        (info.taxes ?? [])
          .filter((t: any) => Number(t.rate) > 0)
          .map((t: any) => ({
            rate: Number(t.rate),
            is_inclusive: t.is_inclusive === true,
            tax_type: t.tax_type ?? null,
            name: t.name ?? null,
            tax_rate_id: t.tax_rate_id ?? null,
          })),
      );
    }

    return items.map((item, index) => {
      const unitPrice = Number(item.unit_price) || 0;
      if (item.product_id == null) {
        const rate = Number(item.tax_rate || 0);
        return {
          rates:
            rate > 0
              ? [
                  {
                    rate,
                    is_inclusive: false,
                    tax_type: null,
                    name: null,
                    tax_rate_id: null,
                  },
                ]
              : [],
          declared_gross: false,
        };
      }

      const productId = Number(item.product_id);
      const product = productById.get(productId);
      const variant =
        item.product_variant_id != null
          ? variantById.get(Number(item.product_variant_id))
          : undefined;
      const rates = ratesByProduct.get(productId) ?? [];
      if (!product || rates.length === 0) {
        // Sin producto resoluble o sin impuestos asignados no hay nada que
        // despejar: el precio es la base.
        return { rates, declared_gross: false };
      }

      const num = (v: unknown): number | null =>
        v != null && Number.isFinite(Number(v)) ? Number(v) : null;
      const candidates: Array<number | null> = [
        num(product.base_price),
        product.is_on_sale ? num(product.sale_price) : null,
        num(variant?.price_override),
        variant?.is_on_sale ? num(variant?.sale_price) : null,
      ];
      const tierSnap = tierSnapshots[index];
      if (tierSnap) {
        candidates.push(
          this.priceResolver.resolveWithTier({
            product: {
              base_price: Number(product.base_price || 0),
              is_on_sale: !!product.is_on_sale,
              sale_price: num(product.sale_price),
              track_inventory: true,
              has_multiple_price_tiers: true,
            },
            variant: variant
              ? {
                  id: variant.id,
                  price_override: num(variant.price_override),
                  is_on_sale: !!variant.is_on_sale,
                  sale_price: num(variant.sale_price),
                  track_inventory_override: null,
                }
              : undefined,
            priceTier: {
              id: tierSnap.tier_id,
              name: tierSnap.tier_name,
              discount_percentage: tierSnap.discount_percentage,
              is_package_unit: tierSnap.is_package_unit,
              units_per_package: tierSnap.units_per_package,
            },
            tierOverrides: [
              {
                variant_id: item.product_variant_id ?? null,
                override_price: tierSnap.override_price,
                override_units_per_package: tierSnap.override_units_per_package,
              },
            ],
            taxRate: 0,
          }).unitPrice,
        );
      }

      return {
        rates,
        declared_gross: !matchesCatalogPrice(unitPrice, candidates),
      };
    });
  }

  private resolveLines(
    items: QuotationTaxableItem[],
    contexts: QuotationLineTaxContext[],
    priceUnitByIndex: Array<number | null>,
  ): ResolvedQuotationLine[] {
    return items.map((item, index) =>
      resolveQuotationLine(
        {
          unit_price: Number(item.unit_price) || 0,
          quantity: Number(item.quantity) || 0,
          discount_amount: Number(item.discount_amount || 0),
          price_unit_quantity: priceUnitByIndex[index] ?? null,
        },
        contexts[index]?.rates ?? [],
        { declared_gross: contexts[index]?.declared_gross ?? false },
      ),
    );
  }

  /**
   * Columnas fiscales de `quotation_items`. Contrato que leen el impreso
   * (`quotation.provider.ts`, agrupa por tarifa sumando `tax_amount_item` con
   * base `total_price`) y el snapshot de contratos:
   *  - `unit_price` (no se toca acá): el precio DECLARADO de la línea, el que
   *    el modal vuelve a cargar al editar.
   *  - `total_price`: base NETA de la línea antes del descuento (INV-0).
   *  - `tax_amount_item`: impuesto de la LÍNEA completa. A diferencia de
   *    `order_items` (ADR-08, por unidad), aquí es total de línea porque así
   *    lo suma el impreso; `convertToOrder` lo re-expresa por unidad.
   *  - `tax_rate`: Σ de fracciones.
   */
  private lineTaxColumns(line: ResolvedQuotationLine) {
    return {
      tax_rate: line.tax_rate > 0 ? line.tax_rate : null,
      tax_amount_item: line.line_tax_total,
      total_price: line.line_net_total,
    };
  }

  private async generateQuotationNumber(storeId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const prefix = `QT-${year}${month}${day}-`;

    const lastQuotation = await this.prisma.quotations.findFirst({
      where: {
        store_id: storeId,
        quotation_number: { startsWith: prefix },
      },
      orderBy: { quotation_number: 'desc' },
    });

    let sequence = 1;
    if (lastQuotation) {
      const lastSequence = parseInt(lastQuotation.quotation_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }
}
