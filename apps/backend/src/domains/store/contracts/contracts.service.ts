import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { QuotationProfilesService } from '../backend-quotations-profiles/quotation-profiles.service';
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
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly profilesService: QuotationProfilesService,
  ) {}

  private readonly CONTRACT_INCLUDE = {
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
  };

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
      where: { quotation_id },
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

    // ADR-03: el contrato congela la version VIGENTE del perfil. Sin perfil
    // (cotizo desde cero) el snapshot guarda `profile: null` y los totales
    // mandan. `resolveForQuotation` valida el tenant (ERR-04 si es ajeno).
    const profile = (quotation as any).profile_id
      ? await this.profilesService.resolveForQuotation(
          (quotation as any).profile_id,
        )
      : null;

    const snapshot = buildContractSnapshot(quotation, profile as any);

    try {
      // El cliente de `$transaction` es el BASE (sin extension de scoping):
      // todo `where` lleva `store_id` a mano y la creacion inyecta el tenant
      // explicito (misma disciplina que `QuotationProfilesService`).
      return await this.prisma
        .withoutScope()
        .$transaction(async (tx: any) => {
          // Idempotencia capa 2 (dentro de la transaccion): cierra la
          // carrera entre la comprobacion previa y el INSERT.
          const raced = await tx.contracts.findFirst({
            where: { quotation_id },
            select: { id: true },
          });
          if (raced) throw this.alreadyContracted(quotation_id, raced.id);

          const prefix = contractNumberPrefix();
          const last = await tx.contracts.findFirst({
            where: {
              store_id: scope.store_id,
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
              customer_id: quotation.customer_id,
              status: 'draft',
              subtotal_amount: quotation.subtotal_amount,
              discount_amount: quotation.discount_amount,
              tax_amount: quotation.tax_amount,
              grand_total: quotation.grand_total,
              snapshot,
              profile_id: (quotation as any).profile_id ?? null,
              profile_version: profile
                ? (profile as any).current_version ?? null
                : null,
              notes: quotation.notes ?? null,
              created_by: scope.user_id ?? null,
              updated_at: new Date(),
            },
            include: this.CONTRACT_INCLUDE,
          });

          // La cotizacion solo marca estado (ADR-04): `accepted->contracted`
          // queda reservado al flujo de contratos. `updateMany` con filtro
          // de tenant (escritura scope-safe) + conteo verificado.
          const marked = await tx.quotations.updateMany({
            where: { id: quotation_id, store_id: scope.store_id },
            data: {
              status: 'contracted' as any,
              updated_at: new Date(),
            },
          });
          if (marked.count === 0) {
            throw new NotFoundException(
              'Cotización no encontrada para marcar el contrato',
            );
          }

          return contract;
        });
    } catch (error) {
      // Idempotencia capa 3 (red de la red): si el UNIQUE de
      // `quotation_id` choco dentro de la transaccion, el contrato ya
      // existe — se responde el mismo 409 con la ficha real.
      if (this.isUniqueViolation(error)) {
        const winner = await this.prisma.contracts.findFirst({
          where: { quotation_id },
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
