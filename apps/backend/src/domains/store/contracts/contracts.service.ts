import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type invoices } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  ErrorCodeEntry,
  ErrorCodes,
  VendixHttpException,
} from 'src/common/errors';
import {
  buildContractSnapshot,
  contractNumberPrefix,
  nextContractNumber,
} from './contracts-snapshot';

/**
 * C.1 — Contratos de obra desde cotizacion aceptada (DB-04, FB-06, ERR-01,
 * ERR-05; ADR-01, ADR-03, ADR-04).
 *
 * La aceptacion es el momento juridico donde nace el compromiso: solo una
 * cotizacion `accepted` con destino `contract` crea la ficha. `sale` sigue
 * fluyendo por `convertToOrder` (intacto, fuera de este dominio) y el
 * bloqueo mutuo del lado contrato vive aca: destino distinto de `contract`
 * se rechaza con `QUOTE_DESTINATION_001`.
 *
 * Idempotencia en dos capas: comprobacion previa (mensaje 409 accionable
 * con el contrato existente) + `contracts.quotation_id` UNIQUE como red
 * ante doble POST concurrente (la violacion se traduce al mismo 409).
 *
 * C.2 — lectura y transiciones de la ficha (FB-07, ERR-06): `findAll`
 * devuelve el mismo envoltorio `{ data, pagination }` que el frontend
 * `PaginatedContractsResponse`; `updateStatus` solo admite
 * `draft -> active` y `draft|active -> cancelled`; `invoiced` deriva de la
 * aceptación fiscal y no se establece con PATCH administrativo. La transición
 * inválida responde 422
 * `CONTRACT_STATUS_001`.
 */

/** Estados de la ficha (espejo de `ContractStatus` del frontend). */
export type ContractStatus = 'draft' | 'active' | 'invoiced' | 'cancelled';

/**
 * C.2 (ERR-06): alias al catalogo central. Mismo codigo, mismo 422.
 */
export const CONTRACT_STATUS_ENTRY: ErrorCodeEntry =
  ErrorCodes.CONTRACT_STATUS_001;

/** Transiciones validas por estado (FB-07). */
export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['cancelled'],
  invoiced: [],
  cancelled: [],
};

export interface ContractQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private contractInclude() {
    const context = RequestContextService.getContext();
    return {
      quotation: {
        select: {
          id: true,
          quotation_number: true,
          destination: true,
          status: true,
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
      invoices: {
        where: {
          status: { notIn: ['cancelled', 'voided'] },
          // Relation filters are explicit even though the outer contract query
          // is scoped: a nested relation must never expose another tenant's row.
          store_id: context?.store_id ?? -1,
          organization_id: context?.organization_id ?? -1,
        },
        select: {
          id: true,
          invoice_number: true,
          status: true,
          total_amount: true,
          dian_status: true,
          accepted_at: true,
          cufe: true,
        },
        take: 1,
        orderBy: [
          { created_at: 'desc' },
          { id: 'desc' },
        ],
      },
    } satisfies Prisma.contractsInclude;
  }

  /** Return a singular, minimal active invoice rather than Prisma's list. */
  private withInvoice<
    T extends {
      status: string;
      invoices?: Array<
        Pick<
          invoices,
          | 'id'
          | 'invoice_number'
          | 'status'
          | 'total_amount'
          | 'dian_status'
          | 'accepted_at'
          | 'cufe'
        >
      >;
    },
  >(row: T) {
    const { invoices, ...contract } = row;
    const sourceInvoice = invoices?.[0] ?? null;
    const fiscallyAccepted = Boolean(
      sourceInvoice?.status === 'accepted' &&
        sourceInvoice.accepted_at &&
        sourceInvoice.cufe?.trim(),
    );
    const effectiveStatus = fiscallyAccepted
      ? 'invoiced'
      : contract.status === 'invoiced'
        ? 'active'
        : contract.status;
    const invoice = sourceInvoice
      ? (({ accepted_at: _accepted_at, cufe: _cufe, ...publicInvoice }) =>
          publicInvoice)(sourceInvoice)
      : null;
    return {
      ...contract,
      administrative_status: contract.status,
      status: effectiveStatus,
      invoice,
    };
  }

  private acceptedFiscalInvoiceWhere(): Prisma.invoicesWhereInput {
    const context = RequestContextService.getContext();
    return {
      store_id: context?.store_id ?? -1,
      organization_id: context?.organization_id ?? -1,
      status: 'accepted',
      accepted_at: { not: null },
      cufe: { not: '' },
    };
  }

  /**
   * C.2 (FB-07) — listado paginado con el mismo envoltorio
   * `{ data, pagination }` que `PaginatedContractsResponse` del frontend.
   * Lecturas scopeadas por la extension de tenant (`findMany`/`count`,
   * jamas `findUnique` bajo extension).
   */
  async findAll(query: ContractQuery) {
    const rawPage = Number(query.page ?? 1);
    const rawLimit = Number(query.limit ?? 10);
    const page = Number.isFinite(rawPage)
      ? Math.max(1, Math.floor(rawPage))
      : 1;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
      : 10;
    const skip = (page - 1) * limit;
    const search = query.search?.trim() || undefined;

    const predicates: Prisma.contractsWhereInput[] = [];
    if (search) {
      predicates.push({
        OR: [
          { contract_number: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.status === 'invoiced') {
      predicates.push({
        invoices: { some: this.acceptedFiscalInvoiceWhere() },
      });
    } else if (query.status === 'active') {
      predicates.push({
        status: { in: ['active', 'invoiced'] },
        NOT: { invoices: { some: this.acceptedFiscalInvoiceWhere() } },
      });
    } else if (query.status) {
      predicates.push({ status: query.status });
    }
    const where: Prisma.contractsWhereInput =
      predicates.length > 1 ? { AND: predicates } : predicates[0] ?? {};

    const [data, total] = await Promise.all([
      this.prisma.contracts.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: this.contractInclude(),
      }),
      this.prisma.contracts.count({ where }),
    ]);

    return {
      data: data.map((contract) => this.withInvoice(contract)),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * C.2 (FB-07) — ficha por id. 404 accionable con el id en `details`
   * para que la ficha navegue o reintente en vez de pintar en blanco.
   */
  async findOne(id: number) {
    const contract = await this.prisma.contracts.findFirst({
      where: { id },
      include: this.contractInclude(),
    });
    if (!contract) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Contrato no encontrado en esta tienda.',
        { contract_id: id },
      );
    }
    return this.withInvoice(contract);
  }

  /**
   * C.2/P1.4 — `draft -> active` y `draft|active -> cancelled`. `invoiced`
   * deriva de aceptación fiscal y no es editable con PATCH. La cancelación se
   * serializa con la creación de facturas y se bloquea ante cualquier factura
   * todavía activa.
   */
  async updateStatus(id: number, status: ContractStatus) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id || !context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const scope = {
      store_id: context.store_id,
      organization_id: context.organization_id,
    };

    await this.prisma.withoutScope().$transaction(async (tx: any) => {
      // Invoice creation takes this same row lock before checking the contract,
      // so cancellation cannot race past a concurrent draft creation.
      await tx.$queryRaw`
        SELECT id FROM contracts
        WHERE id = ${id}
          AND store_id = ${scope.store_id}
          AND organization_id = ${scope.organization_id}
        FOR UPDATE
      `;

      const current = await tx.contracts.findFirst({
        where: { id, ...scope },
        select: {
          id: true,
          status: true,
          updated_at: true,
          invoices: {
            where: {
              status: { notIn: ['cancelled', 'voided'] },
              ...scope,
            },
            select: {
              id: true,
              invoice_number: true,
              status: true,
              total_amount: true,
              dian_status: true,
              accepted_at: true,
              cufe: true,
            },
            take: 1,
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          },
        },
      });
      if (!current) {
        throw new VendixHttpException(
          ErrorCodes.SYS_NOT_FOUND_001,
          'Contrato no encontrado en esta tienda.',
          { contract_id: id },
        );
      }

      if (status === 'cancelled') {
        const activeInvoice = await tx.invoices.findFirst({
          where: {
            contract_id: id,
            ...scope,
            status: { notIn: ['cancelled', 'voided'] },
          },
          select: { id: true, invoice_number: true, status: true },
        });
        if (activeInvoice) {
          const accepted = activeInvoice.status === 'accepted';
          throw new VendixHttpException(
            ErrorCodes.CONTRACT_INVOICE_001,
            accepted
              ? 'No se puede cancelar este contrato porque su factura ya fue aceptada fiscalmente. La política de reversión mediante nota crédito debe definirse antes de habilitar esta acción.'
              : 'No se puede cancelar este contrato mientras tenga una factura activa. Descarta el borrador o resuelve/anula primero el documento fiscal y vuelve a intentarlo.',
            {
              contract_id: id,
              invoice_id: activeInvoice.id,
              invoice_number: activeInvoice.invoice_number,
              invoice_status: activeInvoice.status,
              required_action: accepted
                ? 'credit_note_policy_pending'
                : 'resolve_invoice_first',
            },
          );
        }
      }

      const projected = this.withInvoice(current);
      const from = projected.status as ContractStatus;
      const allowed = CONTRACT_TRANSITIONS[from] ?? [];
      if (!allowed.includes(status)) {
        throw new VendixHttpException(
          CONTRACT_STATUS_ENTRY,
          `No se puede cambiar el contrato de "${from}" a "${status}".`,
          {
            contract_id: id,
            current_status: from,
            administrative_status: current.status,
            attempted_status: status,
            allowed_transitions: allowed,
          },
        );
      }

      const result = await tx.contracts.updateMany({
        where: {
          id,
          ...scope,
          status: current.status,
          updated_at: current.updated_at,
        },
        data: { status, updated_at: new Date() },
      });
      if (result.count !== 1) {
        throw new VendixHttpException(
          CONTRACT_STATUS_ENTRY,
          'El contrato cambió durante la actualización. Vuelve a consultar y reintenta.',
          { contract_id: id },
        );
      }

      return true;
    });
    return this.findOne(id);
  }

  async createFromQuotation(quotation_id: number) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id || !context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const scope = {
      organization_id: context.organization_id,
      store_id: context.store_id,
      user_id: context.user_id,
    };

    // Lectura scopeada (`findFirst`, no `findUnique`: la extension de
    // tenant fusiona `store_id` al where y `findUnique` se volveria invalido).
    const quotation = await this.prisma.quotations.findFirst({
      where: { id: quotation_id },
      include: { quotation_items: true },
    });
    if (!quotation) {
      throw new NotFoundException('Cotización no encontrada');
    }

    // Idempotencia capa 1: la ficha existente manda al contrato, no a un error
    // generico. Va ANTES de los gates de destino/estado: el reintento sobre
    // una cotizacion ya contratada debe resolver a la ficha, no a un 422.
    const existing = await this.prisma.contracts.findFirst({
      where: {
        quotation_id,
        store_id: scope.store_id,
        organization_id: scope.organization_id,
      },
    });
    if (existing) throw this.alreadyContracted(quotation_id, existing.id);

    // ADR-01: `sale` solo admite `convertToOrder`, `contract` solo admite
    // crear contrato. Este es el lado contrato del bloqueo mutuo (el lado
    // venta, `convertToOrder`, queda intacto por alcance de C.1).
    if ((quotation as any).destination !== 'contract') {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_DESTINATION_001,
        'Solo las cotizaciones con destino contrato crean contrato.',
        {
          quotation_id,
          destination: (quotation as any).destination,
          required_destination: 'contract',
        },
      );
    }

    if (quotation.status !== ('accepted' as any)) {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_CONVERT_STATUS_001,
        'La cotización debe estar aceptada para crear el contrato.',
        {
          quotation_id,
          current_status: quotation.status,
          required_status: 'accepted',
        },
      );
    }

    if (!quotation.customer_id) {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_CONVERT_CUSTOMER_001,
        'La cotización debe tener un cliente para crear el contrato.',
        { quotation_id },
      );
    }

    // ADR-03: el contrato copia la versión de perfil y economía congelada al
    // cotizar. El perfil actual jamás reescribe ni completa un snapshot histórico.
    try {
      // El cliente de `$transaction` es el BASE (sin extension de scoping):
      // todo `where` lleva `store_id` a mano y la creacion inyecta el tenant
      // explicito (misma disciplina que `QuotationProfilesService`).
      const created = await this.prisma
        .withoutScope()
        .$transaction(async (tx: Prisma.TransactionClient) => {
          const prefix = contractNumberPrefix();
          // A dedicated namespace + store + daily series serializes contract
          // number allocation without colliding with other domains' locks.
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              ${scope.store_id}::int,
              hashtext(${'contracts:number:' + prefix})::int
            )
          `;

          // Re-read after obtaining the lock. Creation and cancellation both
          // race on this authoritative accepted-state check.
          const currentQuotation = await tx.quotations.findFirst({
            where: {
              id: quotation_id,
              store_id: scope.store_id,
              store: { is: { organization_id: scope.organization_id } },
            } satisfies Prisma.quotationsWhereInput,
            include: { quotation_items: true },
          });
          if (!currentQuotation) {
            throw new NotFoundException('Cotización no encontrada');
          }

          // Idempotencia capa 2 (dentro de la transaccion): cierra la
          // carrera entre la comprobacion previa y el INSERT.
          const raced = await tx.contracts.findFirst({
            where: {
              quotation_id,
              store_id: scope.store_id,
              organization_id: scope.organization_id,
            },
            select: { id: true },
          });
          if (raced) throw this.alreadyContracted(quotation_id, raced.id);

          if (currentQuotation.destination !== 'contract') {
            throw new VendixHttpException(ErrorCodes.QUOTE_DESTINATION_001);
          }
          if (currentQuotation.status !== 'accepted') {
            throw new VendixHttpException(
              ErrorCodes.QUOTE_CONVERT_STATUS_001,
              'La cotización debe estar aceptada para crear el contrato.',
              {
                quotation_id,
                current_status: currentQuotation.status,
                required_status: 'accepted',
              },
            );
          }
          if (!currentQuotation.customer_id) {
            throw new VendixHttpException(
              ErrorCodes.QUOTE_CONVERT_CUSTOMER_001,
              'La cotización debe tener un cliente para crear el contrato.',
              { quotation_id },
            );
          }

          // Transition first, conditionally. If cancellation won the race,
          // count=0 aborts the transaction before any contract INSERT.
          const marked = await tx.quotations.updateMany({
            where: {
              id: quotation_id,
              store_id: scope.store_id,
              store: { is: { organization_id: scope.organization_id } },
              destination: 'contract',
              status: 'accepted',
            } satisfies Prisma.quotationsWhereInput,
            data: { status: 'contracted', updated_at: new Date() },
          });
          if (marked.count !== 1) {
            throw new VendixHttpException(
              ErrorCodes.QUOTE_CONVERT_STATUS_001,
              'La cotización dejó de estar aceptada antes de crear el contrato.',
              { quotation_id, required_status: 'accepted' },
            );
          }

          // The contract inherits the accepted quote's frozen economics and
          // quotation terms. Never resolve a live profile during conversion.
          const snapshot = buildContractSnapshot(currentQuotation);

          const last = await tx.contracts.findFirst({
            where: {
              store_id: scope.store_id,
              organization_id: scope.organization_id,
              contract_number: { startsWith: prefix },
            },
            orderBy: { contract_number: 'desc' },
            select: { contract_number: true },
          });
          const contract_number = nextContractNumber(
            last?.contract_number ?? null,
            prefix,
          );

          const contract = await tx.contracts.create({
            data: {
              organization_id: scope.organization_id,
              store_id: scope.store_id,
              quotation_id,
              contract_number,
              customer_id: currentQuotation.customer_id,
              status: 'draft',
              subtotal_amount: currentQuotation.subtotal_amount,
              discount_amount: currentQuotation.discount_amount,
              tax_amount: currentQuotation.tax_amount,
              grand_total: currentQuotation.grand_total,
              snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
              profile_id: snapshot.profile?.profile_id ?? null,
              profile_version: snapshot.profile?.version ?? null,
              notes: currentQuotation.notes ?? null,
              created_by: scope.user_id ?? null,
              updated_at: new Date(),
            },
            include: this.contractInclude(),
          });

          return contract;
        });
      return this.withInvoice(created);
    } catch (error) {
      // Idempotencia capa 3 (red de la red): si el UNIQUE de
      // `quotation_id` choco dentro de la transaccion, el contrato ya
      // existe — se responde el mismo 409 con la ficha real.
      if (this.isUniqueViolation(error)) {
        const winner = await this.prisma.contracts.findFirst({
          where: {
            quotation_id,
            store_id: scope.store_id,
            organization_id: scope.organization_id,
          },
          select: { id: true },
        });
        if (winner) throw this.alreadyContracted(quotation_id, winner.id);
      }
      throw error;
    }
  }

  /** 409 ERR-05 con la ficha existente para navegar a ella. */
  private alreadyContracted(
    quotation_id: number,
    contract_id: number,
  ): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.QUOTE_CONTRACT_001,
      'Esta cotización ya tiene un contrato creado.',
      { quotation_id, contract_id },
    );
  }

  /** `P2002` es violacion de restriccion unica (codigo estable, no mensaje). */
  private isUniqueViolation(error: any): boolean {
    return error?.code === 'P2002';
  }
}
