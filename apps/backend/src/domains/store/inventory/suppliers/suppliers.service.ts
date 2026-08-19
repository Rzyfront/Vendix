import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { supplier_state_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateInventorySupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { BadRequestException } from '@nestjs/common';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  TERMINAL_PURCHASE_ORDER_STATUS,
  TERMINAL_DISPATCH_NOTE_STATUS,
} from '@common/constants/supplier-lifecycle.constants';
// QUI-656: el perfil CONSUME el contrato de métrica, no define su propio
// criterio de "compra reconocida". Agregar una tercera definición garantizaría
// un tercer desacuerdo — que es exactamente el bug de QUI-625.
import { PURCHASE_COMMITTED_STATES } from '../../analytics/analytics-metrics.contract';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: StorePrismaService,
    private readonly operatingScopeService: OperatingScopeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async getSupplierScopeWhere() {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }

    const scope = await this.operatingScopeService.getOperatingScope(
      context.organization_id,
    );

    if (scope === 'ORGANIZATION') {
      return { organization_id: context.organization_id, store_id: null };
    }

    if (!context.store_id) {
      throw new BadRequestException('Store context is required for suppliers');
    }

    return { organization_id: context.organization_id, store_id: context.store_id };
  }

  async create(createSupplierDto: CreateInventorySupplierDto) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }
    const scopeWhere = await this.getSupplierScopeWhere();

    const supplier = await this.prisma.suppliers.create({
      data: {
        ...createSupplierDto,
        organization_id: context.organization_id,
        store_id: scopeWhere.store_id,
      },
      include: {
        addresses: true,
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });

    // Makes the supplier findable by description ("el proveedor de gaseosas del
    // sur") rather than only by exact name. Emitted only when the supplier belongs
    // to a store: `ai_embeddings` rows are store-scoped, and an organization-wide
    // supplier has no single store to attach one to — those are covered by the
    // backfill, which fans them out across the organization's stores.
    if (supplier.store_id) {
      this.eventEmitter.emit('supplier.created', {
        store_id: supplier.store_id,
        supplier_id: supplier.id,
      });
    }

    return supplier;
  }

  async findAll(query: SupplierQueryDto) {
    const scopeWhere = await this.getSupplierScopeWhere();
    const where: any = {
      ...scopeWhere,
      // Los archivados quedan fuera salvo que se pidan explícitamente, igual
      // que en brands.service.ts:89-90. Es lo que hace que "eliminar" se sienta
      // como eliminar sin destruir la fila.
      state: query.state ?? { not: 'archived' },
      email: query.email,
      phone: query.phone,
    };

    // Add search filter
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { contact_person: { contains: query.search } },
        { email: { contains: query.search } },
        { phone: { contains: query.search } },
        { mobile: { contains: query.search } },
        { website: { contains: query.search } },
        { tax_id: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.suppliers.findMany({
        where,
        include: {
          addresses: true,
          supplier_products: {
            include: {
              products: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
        skip,
        take: limit,
      }),
      this.prisma.suppliers.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  findActive(query: SupplierQueryDto) {
    return this.findAll({
      ...query,
      state: supplier_state_enum.active,
    });
  }

  /**
   * Devuelve el proveedor incluyendo archivados: los detalles de un documento
   * histórico deben poder resolver su proveedor aunque ya esté archivado.
   * Lanza 404 en lugar de devolver `null` — antes el `null` silencioso hacía
   * que `update()` fallara con un P2025 crudo de Prisma.
   */
  async findOne(id: number) {
    const scopeWhere = await this.getSupplierScopeWhere();
    const supplier = await this.prisma.suppliers.findFirst({
      where: { id, ...scopeWhere },
      include: {
        addresses: true,
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });

    if (!supplier) {
      throw new VendixHttpException(ErrorCodes.SUPPLIER_FIND_001);
    }

    return supplier;
  }

  async findSupplierProducts(supplierId: number) {
    const scopeWhere = await this.getSupplierScopeWhere();
    return this.prisma.supplier_products.findMany({
      where: {
        supplier_id: supplierId,
        suppliers: { is: scopeWhere },
      },
      include: {
        products: true,
        suppliers: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  /**
   * QUI-656 — resuelve el universo de compras del proveedor según el alcance
   * operativo de la organización.
   *
   * `ORGANIZATION`: la deuda y las compras son de TODA la organización, porque
   * el proveedor es único y compartido. `STORE`: se agrega por la tienda
   * activa, o un proveedor compartido entre tiendas mostraría deuda ajena.
   *
   * El filtro sale de `location.store_id` y no de `suppliers.store_id`: el
   * primero es NOT NULL y siempre resuelve a tienda; el segundo es nullable, y
   * filtrar por él borraría toda compra a proveedores de nivel organización.
   * Es el mismo universo que usan las analíticas de compras (QUI-624/625), que
   * es lo que hace que las cifras del perfil cuadren con ellas.
   */
  private async resolvePurchaseScope(): Promise<{
    organizationId: number;
    storeId: number | null;
  }> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }
    const scope = await this.operatingScopeService.getOperatingScope(
      context.organization_id,
    );
    return {
      organizationId: context.organization_id,
      storeId: scope === 'ORGANIZATION' ? null : (context.store_id ?? null),
    };
  }

  /**
   * QUI-656 — resuelve el proveedor para el PERFIL, aceptando también los de
   * nivel organización (`suppliers.store_id IS NULL`).
   *
   * `findOne` usa `getSupplierScopeWhere`, que en alcance STORE exige
   * `store_id = <tienda>` y por lo tanto no alcanza a un proveedor de
   * organización. Medido en la organización 6: el proveedor 109 tiene
   * `store_id NULL` y 22 órdenes — el de MAYOR volumen —, así que el perfil del
   * proveedor más importante era inalcanzable.
   *
   * El arreglo se limita al perfil a propósito: cambiar `getSupplierScopeWhere`
   * afectaría listado, edición y borrado, que tienen sus propias reglas de
   * aislamiento. Acá solo se LEE, y una compra a un proveedor de organización
   * aterriza igual en la tienda, así que su perfil le corresponde ver.
   */
  private async findSupplierForProfile(id: number) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }
    const supplier = await this.prisma.suppliers.findFirst({
      where: {
        id,
        organization_id: context.organization_id,
        ...(context.store_id
          ? { OR: [{ store_id: context.store_id }, { store_id: null }] }
          : {}),
      },
    });
    if (!supplier) {
      throw new VendixHttpException(ErrorCodes.SUPPLIER_FIND_001);
    }
    return supplier;
  }

  /** `where` de purchase_orders para el universo resuelto arriba. */
  private buildPurchaseOrderWhere(
    organizationId: number,
    storeId: number | null,
    supplierId: number,
  ) {
    return {
      organization_id: organizationId,
      supplier_id: supplierId,
      ...(storeId !== null ? { location: { store_id: storeId } } : {}),
    };
  }

  /**
   * QUI-656 — resumen del perfil del proveedor.
   *
   * Las dos cifras de deuda van SEPARADAS a propósito:
   *
   * - `outstanding_debt` sale de `accounts_payable`: es la deuda formalizada,
   *   la que cuadra contra contabilidad y contra el aging de QUI-542.
   * - `committed_amount` son OCs aprobadas que todavía no generaron CxP. La
   *   CxP nace atada a la RECEPCIÓN (`ap_reception_links`), no a la aprobación,
   *   así que entre aprobar y recibir existe un compromiso real que no está en
   *   `accounts_payable`.
   *
   * Sumarlas en un solo número mostraría una deuda que no cuadra con ningún
   * libro. Mostrar solo la primera subestima la exposición con el proveedor.
   */
  async getSupplierSummary(supplierId: number) {
    const supplier = await this.findSupplierForProfile(supplierId);
    const { organizationId, storeId } = await this.resolvePurchaseScope();
    const baseWhere = this.buildPurchaseOrderWhere(
      organizationId,
      storeId,
      supplierId,
    );

    // CP-ID-VNDX-2026-08-18-PO-PROD — F1.S8: 5ta card "YTD" desde el 1-ene.
    const yearStartIso = new Date(
      Date.UTC(new Date().getUTCFullYear(), 0, 1),
    ).toISOString();

    const [committed, lastOrder, payables, pendingReception, ytdPurchases] =
      await Promise.all([
        // Compras reconocidas: mismos estados que el contrato de métrica, para
        // que el perfil no invente un cuarto criterio de "cuánto le compré".
        this.prisma.purchase_orders.aggregate({
          where: {
            ...baseWhere,
            status: { in: [...PURCHASE_COMMITTED_STATES] },
          },
          _count: { _all: true },
          _sum: { subtotal_amount: true },
        }),
        this.prisma.purchase_orders.findFirst({
          where: baseWhere,
          orderBy: { order_date: 'desc' },
          select: { order_date: true, status: true },
        }),
        this.prisma.accounts_payable.findMany({
          where: {
            organization_id: organizationId,
            supplier_id: supplierId,
            ...(storeId !== null ? { store_id: storeId } : {}),
            status: 'open',
          },
          select: { balance: true, days_overdue: true, due_date: true },
        }),
        // Compromiso sin CxP: aprobadas/parciales que aún no formalizaron deuda.
        this.prisma.purchase_orders.aggregate({
          where: {
            ...baseWhere,
            status: { in: ['approved', 'partial'] },
          },
          _count: { _all: true },
          _sum: { total_amount: true },
        }),
        // CP-ID-VNDX-2026-08-18-PO-PROD — F1.S8: ytd desde 1-ene.
        this.prisma.purchase_orders.aggregate({
          where: {
            ...baseWhere,
            status: { in: [...PURCHASE_COMMITTED_STATES] },
            order_date: { gte: yearStartIso },
          },
          _sum: { subtotal_amount: true },
        }),
      ]);

    const orderCount = committed._count._all ?? 0;
    const totalPurchased = Number(committed._sum.subtotal_amount ?? 0);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    let outstanding = 0;
    let overdue = 0;
    let maxDaysOverdue = 0;
    for (const ap of payables) {
      const balance = Number(ap.balance ?? 0);
      outstanding += balance;
      if ((ap.days_overdue ?? 0) > 0) {
        overdue += balance;
        maxDaysOverdue = Math.max(maxDaysOverdue, ap.days_overdue ?? 0);
      }
    }

    return {
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      /**
       * La identidad viaja DENTRO del resumen a propósito: `GET /:id` resuelve
       * con `findOne`, que en alcance STORE no alcanza a un proveedor de
       * organización. Pedirla aparte obligaba al frontend a un forkJoin que
       * moría entero por ese 404 y dejaba el perfil en blanco.
       */
      supplier,
      /** Órdenes que cuentan como compra reconocida. */
      total_orders: orderCount,
      /** SUM(subtotal_amount) — SIN IVA, igual que el Resumen de Compras. */
      total_purchased: round2(totalPurchased),
      /** Derivado, no persistido. */
      average_order_value: orderCount > 0 ? round2(totalPurchased / orderCount) : 0,
      /** Deuda formalizada en accounts_payable. Cuadra con contabilidad. */
      outstanding_debt: round2(outstanding),
      overdue_debt: round2(overdue),
      max_days_overdue: maxDaysOverdue,
      /** OCs aprobadas/parciales sin CxP todavía: compromiso, no deuda. */
      committed_amount: round2(Number(pendingReception._sum.total_amount ?? 0)),
      committed_orders: pendingReception._count._all ?? 0,
      /**
       * CP-ID-VNDX-2026-08-18-PO-PROD — F1.S8: stats cards nuevas.
       * ytd_purchases: SUM(subtotal_amount) desde el 1-ene del año en curso.
       * open_pos_count: count de POs en 'approved'|'partial' (alias de committed_orders).
       *   Se duplica el campo con un nombre más claro para el consumidor.
       */
      ytd_purchases: round2(Number(ytdPurchases._sum.subtotal_amount ?? 0)),
      open_pos_count: pendingReception._count._all ?? 0,
      last_order_date: lastOrder?.order_date ?? null,
      /** El universo agregado, para que la UI pueda declararlo. */
      scope: storeId === null ? 'ORGANIZATION' : 'STORE',
    };
  }

  /** QUI-656 — historial paginado de OCs del proveedor. */
  async getSupplierPurchaseOrders(
    supplierId: number,
    page = 1,
    limit = 20,
  ) {
    await this.findSupplierForProfile(supplierId);
    const { organizationId, storeId } = await this.resolvePurchaseScope();
    const where = this.buildPurchaseOrderWhere(
      organizationId,
      storeId,
      supplierId,
    );

    const [total, data] = await Promise.all([
      this.prisma.purchase_orders.count({ where }),
      this.prisma.purchase_orders.findMany({
        where,
        orderBy: { order_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          order_number: true,
          status: true,
          payment_status: true,
          payment_plan: true,
          payment_due_date: true,
          subtotal_amount: true,
          tax_amount: true,
          total_amount: true,
          supplier_invoice_number: true,
          order_date: true,
          expected_date: true,
          received_date: true,
        },
      }),
    ]);

    /**
     * CP-ID-VNDX-2026-08-18-PO-PROD — F1.S10: enriquecemos cada PO con
     * `next_payment_date` y `next_payment_due_in_days` usando el mismo
     * patrón batched del helper de PurchaseOrdersService. Aquí se aplica
     * localmente para no inyectar el otro service.
     */
    const enriched = await this.decorateSupplierPOsWithNextPayment(data);

    return { data: enriched, total, page, limit };
  }

  /**
   * CP-ID-VNDX-2026-08-18-PO-PROD — F1.S10: decorador local de POs del
   * proveedor. Lee `purchase_order_payment_schedules` en una sola query
   * batched (status='planned' ASC), con fallback a `payment_due_date`.
   */
  private async decorateSupplierPOsWithNextPayment<
    T extends { id: number; payment_due_date?: Date | null }
  >(
    rows: T[],
  ): Promise<
    Array<
      T & {
        next_payment_date: string | null;
        next_payment_due_in_days: number | null;
      }
    >
  > {
    if (!rows.length) return [];
    const poIds = rows.map((r) => r.id);
    const map = new Map<number, { date: string | null }>();
    const rowsRaw: Array<{ purchase_order_id: number; scheduled_date: Date }> =
      await this.prisma.$queryRawUnsafe(
        `SELECT purchase_order_id, scheduled_date
         FROM purchase_order_payment_schedules
         WHERE purchase_order_id IN (${poIds.join(',')})
           AND status = 'planned'
         ORDER BY purchase_order_id ASC, scheduled_date ASC`,
      );
    for (const r of rowsRaw) {
      if (!map.has(r.purchase_order_id)) {
        map.set(r.purchase_order_id, {
          date: new Date(r.scheduled_date).toISOString().slice(0, 10),
        });
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((row) => {
      let next = map.get(row.id);
      if (!next || !next.date) {
        next = {
          date: row.payment_due_date
            ? new Date(row.payment_due_date).toISOString().slice(0, 10)
            : null,
        };
      }
      const days = next.date
        ? Math.ceil(
            (new Date(`${next.date}T00:00:00`).getTime() -
              new Date(`${today}T00:00:00`).getTime()) /
              86_400_000,
          )
        : null;
      return { ...row, next_payment_date: next.date, next_payment_due_in_days: days };
    });
  }

  /** QUI-656 — documentos de CxP del proveedor con saldo y vencimiento. */
  async getSupplierPayables(supplierId: number, page = 1, limit = 20) {
    await this.findSupplierForProfile(supplierId);
    const { organizationId, storeId } = await this.resolvePurchaseScope();
    const where = {
      organization_id: organizationId,
      supplier_id: supplierId,
      ...(storeId !== null ? { store_id: storeId } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.accounts_payable.count({ where }),
      this.prisma.accounts_payable.findMany({
        where,
        // Lo vencido primero: es lo que exige acción.
        orderBy: [{ status: 'asc' }, { due_date: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          document_number: true,
          source_type: true,
          source_id: true,
          original_amount: true,
          paid_amount: true,
          balance: true,
          due_date: true,
          status: true,
          days_overdue: true,
        },
      }),
    ]);

    // CP-ID-VNDX-2026-08-18-PO-PROD — F1.S9: desglose "Cuota N de M".
    // Para cada CxP cuyo source_type='purchase_order', enriquecer con:
    //   - po_id, payment_plan
    //   - installment_number (posición de la cuota dentro del plan)
    //   - total_installments (total de cuotas del plan)
    //   - installment_due_date (fecha de la cuota, distintos a due_date de CxP)
    // Implementación: batched query a purchase_order_payment_schedules para
    // todos los PO referenciados en la página, sin N+1.
    const poIds = Array.from(
      new Set(
        data
          .filter(
            (ap: any) => ap.source_type === 'purchase_order' && ap.source_id,
          )
          .map((ap: any) => Number(ap.source_id)),
      ),
    ).filter((id: unknown): id is number => Number.isFinite(id) && (id as number) > 0);

    let installmentMap = new Map<
      number,
      { total: number; byDate: Map<string, { installment_number: number }> }
    >();
    let poDatesMap = new Map<
      number,
      { payment_due_date: Date | null; payment_plan: string | null }
    >();

    if (poIds.length) {
      // CP-ID-VNDX-2026-08-18-PO-PROD — F1.S9: batched read.
      const [schedules, pos] = await Promise.all([
        this.prisma.$queryRawUnsafe<
          Array<{
            purchase_order_id: number;
            scheduled_date: Date;
            status: string;
          }>
        >(
          `SELECT purchase_order_id, scheduled_date, status
           FROM purchase_order_payment_schedules
           WHERE purchase_order_id IN (${poIds.join(',')})
           ORDER BY purchase_order_id ASC, scheduled_date ASC`,
        ),
        this.prisma.purchase_orders.findMany({
          where: { id: { in: poIds } },
          select: {
            id: true,
            payment_due_date: true,
            payment_plan: true,
          },
        }),
      ]);

      for (const s of schedules) {
        if (!installmentMap.has(s.purchase_order_id)) {
          installmentMap.set(s.purchase_order_id, {
            total: 0,
            byDate: new Map(),
          });
        }
        const entry = installmentMap.get(s.purchase_order_id)!;
        entry.total += 1;
        const dateKey = new Date(s.scheduled_date).toISOString().slice(0, 10);
        entry.byDate.set(dateKey, { installment_number: entry.total });
      }

      for (const po of pos) {
        poDatesMap.set(po.id, {
          payment_due_date: po.payment_due_date,
          payment_plan: po.payment_plan,
        });
      }
    }

    const enriched = data.map((ap) => {
      if (ap.source_type !== 'purchase_order' || !ap.source_id) {
        return { ...ap, installment_info: null };
      }
      const poId = Number(ap.source_id);
      const entry = installmentMap.get(poId);
      const poMeta = poDatesMap.get(poId);
      const dxKey = ap.due_date
        ? new Date(ap.due_date).toISOString().slice(0, 10)
        : null;
      const slot = dxKey && entry ? entry.byDate.get(dxKey) : null;
      return {
        ...ap,
        installment_info: {
          po_id: poId,
          payment_plan: poMeta?.payment_plan ?? null,
          installment_number: slot?.installment_number ?? null,
          total_installments: entry?.total ?? 0,
        },
      };
    });

    return { data: enriched, total, page, limit };
  }

  async update(id: number, updateSupplierDto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.suppliers.update({
      where: { id },
      data: updateSupplierDto,
      include: {
        addresses: true,
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  /**
   * Cuenta los documentos del proveedor que siguen abiertos.
   *
   * Usa `withoutScope()` con filtro explícito de organización a propósito: el
   * proveedor pertenece a la organización, así que una OC abierta en OTRA
   * tienda de la misma org también debe bloquear el archivado. El scope de
   * tienda filtra `purchase_orders` por `location.store_id`, y confiar en él
   * dejaría archivar un proveedor con trabajo pendiente en otra sede.
   */
  private async countOpenDocuments(supplierId: number, organizationId: number) {
    const client = this.prisma.withoutScope();

    const [open_purchase_orders, unpaid_payables, open_dispatch_notes] =
      await Promise.all([
        client.purchase_orders.count({
          where: {
            supplier_id: supplierId,
            organization_id: organizationId,
            status: { notIn: [...TERMINAL_PURCHASE_ORDER_STATUS] },
          },
        }),
        // `balance > 0` en lugar de `status`: accounts_payable.status es un
        // VarChar libre sin enum que lo restrinja, el saldo es un hecho.
        client.accounts_payable.count({
          where: {
            supplier_id: supplierId,
            organization_id: organizationId,
            balance: { gt: 0 },
          },
        }),
        client.dispatch_notes.count({
          where: {
            supplier_id: supplierId,
            // La relación se llama `store` (singular) en dispatch_notes.
            store: { organization_id: organizationId },
            status: { notIn: [...TERMINAL_DISPATCH_NOTE_STATUS] },
          },
        }),
      ]);

    return {
      open_purchase_orders,
      unpaid_payables,
      open_dispatch_notes,
      total:
        open_purchase_orders + unpaid_payables + open_dispatch_notes,
    };
  }

  /**
   * "Eliminar" = archivar. La fila persiste, así que toda la historia contable
   * (OC recibidas, CxP pagadas, facturas, retenciones) sigue resolviendo su
   * proveedor; solo desaparece de listados y selectores.
   *
   * Se bloquea si hay documentos abiertos: archivar un proveedor con una OC en
   * curso lo volvería invisible mientras el trabajo sigue vivo.
   */
  async remove(id: number) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }

    const supplier = await this.findOne(id);

    if (supplier.state === supplier_state_enum.archived) {
      return supplier;
    }

    const open = await this.countOpenDocuments(id, context.organization_id);

    if (open.total > 0) {
      throw new VendixHttpException(
        ErrorCodes.SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS,
        undefined,
        {
          open_purchase_orders: open.open_purchase_orders,
          unpaid_payables: open.unpaid_payables,
          open_dispatch_notes: open.open_dispatch_notes,
        },
      );
    }

    // Un proveedor archivado no puede seguir siendo el carrier por defecto de
    // un método de envío ni de una ruta: ambas FKs son SetNull, así que los
    // desvinculamos explícitamente para que ningún flujo nuevo lo resuelva.
    //
    // Todo va por el `tx` del callback, nunca por `this.prisma`: `$transaction`
    // sale del baseClient (ya sin scope de tenant) y usar otro cliente adentro
    // tomaría una segunda conexión del pool además de romper la atomicidad.
    return this.prisma.$transaction(async (tx: any) => {
      await tx.shipping_methods.updateMany({
        where: { default_carrier_supplier_id: id },
        data: { default_carrier_supplier_id: null },
      });

      await tx.dispatch_routes.updateMany({
        where: { external_carrier_supplier_id: id },
        data: { external_carrier_supplier_id: null },
      });

      return tx.suppliers.update({
        where: { id },
        data: { state: supplier_state_enum.archived },
      });
    });
  }

  /**
   * Transición explícita activo ↔ inactivo. `archived` no es un destino válido
   * aquí: archivar tiene un único camino auditado (DELETE) que además valida
   * documentos abiertos.
   */
  async setState(id: number, state: supplier_state_enum) {
    if (state === supplier_state_enum.archived) {
      throw new VendixHttpException(
        ErrorCodes.SUPPLIER_STATE_INVALID_TRANSITION,
        'Use DELETE /store/inventory/suppliers/:id to archive a supplier',
      );
    }

    await this.findOne(id);

    return this.prisma.suppliers.update({
      where: { id },
      data: { state },
      include: {
        addresses: true,
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  async addProductToSupplier(supplierId: number, productId: number, data: any) {
    await this.findOne(supplierId);
    return this.prisma.supplier_products.create({
      data: {
        supplier_id: supplierId,
        product_id: productId,
        ...data,
      },
      include: {
        products: true,
        suppliers: true,
      },
    });
  }

  async removeProductFromSupplier(supplierId: number, productId: number) {
    return this.prisma.supplier_products.delete({
      where: {
        supplier_id_product_id: {
          supplier_id: supplierId,
          product_id: productId,
        },
      },
    });
  }
}
