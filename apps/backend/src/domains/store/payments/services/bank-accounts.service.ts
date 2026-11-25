import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  BankAccountPolicy,
  bankAccountAvailableInStoreWhere,
  canModifyBankAccount,
  isBankAccountAvailableInStore,
  resolveBankAccountPolicy,
} from '@common/helpers/bank-account-availability.helper';
import {
  BankAccountOptionDto,
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from '../dto/bank-account.dto';

/**
 * QUI-728 — proyección de `bank_accounts` para transferencia.
 *
 * Invive en el MÓDULO DE PAYMENTS (no en bank-reconciliation / accounting, que
 * es territorio de E.2). Solo expone la proyección mínima
 * `{ id, name, bank_name, account_number }` para el selector del cajero y el
 * CRUD de settings. No toca balances, chart_account ni column_mapping.
 *
 * Imagen 21:9 por cuenta: `bank_accounts.image_s3_key` se persiste como S3
 * key crudo; la URL pre-firmada (TTL 300s) se calcula en lectura vía
 * `S3Service.getPresignedUrl` y se devuelve como `image_url` en el DTO. Si la
 * firma falla, se devuelve `null` y el listado sigue sirviéndose — un fallo
 * de S3 no debe romper el selector de cuentas del cajero.
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Service: S3Service,
    private readonly fiscalScopeService: FiscalScopeService,
  ) {}

  /**
   * Firma la URL pre-firmada del logo de la cuenta. Devuelve `null` si el key
   * está ausente o si la firma falla (defensivo: no romper el listado si S3
   * se cae, el cajero igual ve nombre y número de cuenta).
   */
  private async signImageUrl(
    key: string | null | undefined,
  ): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.s3Service.getPresignedUrl(key, 300);
    } catch {
      return null;
    }
  }

  /**
   * Lista las cuentas bancarias disponibles para la tienda del contexto:
   * `status='active'` y disponibles en la tienda (QUI-1061: propias de la
   * tienda o de la organización disponibles en todas / asignadas a esta
   * tienda; ver `bankAccountAvailableInStoreWhere`). Proyección mínima.
   */
  async listForStore(): Promise<BankAccountOptionDto[]> {
    const storeId = this.getContextStoreId();

    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) {
      throw new NotFoundException('Tienda no encontrada para listar cuentas bancarias');
    }

    const accounts = await this.prisma.bank_accounts.findMany({
      where: {
        ...bankAccountAvailableInStoreWhere(storeId, store.organization_id),
        status: 'active',
      },
      orderBy: { bank_name: 'asc' },
      select: {
        id: true,
        name: true,
        bank_name: true,
        account_number: true,
        image_s3_key: true,
      },
    });

    return Promise.all(
      accounts.map(async (a) => ({
        ...a,
        image_url: await this.signImageUrl(a.image_s3_key),
      })),
    );
  }

  /**
   * Alta de cuenta bancaria, IDEMPOTENTE dentro de lo que la tienda ve.
   *
   * El editor de `custom_config.accounts` reenvía la lista completa en cada
   * guardado, así que "la cuenta ya existe" es el camino NORMAL, no un error del
   * usuario: se devuelve la fila existente para que la ref del `custom_config`
   * SIEMPRE quede con un `bank_accounts.id` real (sin id el cobro caía en
   * "Pagos sin asignar").
   *
   * QUI-1061 — la unicidad sigue el `fiscal_scope` de la organización:
   * - Solo cuentan las cuentas DISPONIBLES en esta tienda (propias o de la
   *   organización disponibles aquí). Una cuenta de OTRA tienda con el mismo
   *   número ya no se ve ni bloquea (antes: 409).
   * - Scope STORE: si no existe, se crea como cuenta de la tienda. La misma
   *   cuenta física en dos tiendas son dos registros independientes.
   * - Scope ORGANIZATION: si no existe, la crea un usuario de organización
   *   como cuenta de organización disponible en todas las tiendas (el default
   *   de la decisión). Si ya existe en la organización pero no está asignada
   *   a esta tienda → `BANK_ACCOUNT_NOT_ASSIGNED_TO_STORE` (no se duplica).
   * - Una cuenta `closed` que se vuelve a dar de alta se REACTIVA (si quien
   *   da de alta puede modificarla), para no quemar el número.
   */
  async create(dto: CreateBankAccountDto): Promise<BankAccountOptionDto> {
    const storeId = this.getContextStoreId();
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) {
      throw new NotFoundException('Tienda no encontrada para crear la cuenta bancaria');
    }
    const policy = await this.resolvePolicy(store.organization_id, storeId);

    const candidates = await this.prisma.bank_accounts.findMany({
      where: {
        ...bankAccountAvailableInStoreWhere(storeId, store.organization_id),
        account_number: dto.account_number,
      },
      select: {
        id: true,
        name: true,
        bank_name: true,
        account_number: true,
        status: true,
        store_id: true,
        image_s3_key: true,
      },
    });
    // La cuenta propia de la tienda manda sobre la de organización.
    const existing =
      candidates.find((c) => c.store_id === storeId) ?? candidates[0] ?? null;

    if (existing) {
      if (existing.status !== 'active') {
        if (!canModifyBankAccount(existing, policy)) {
          throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
        }
        const reactivated = await this.prisma.bank_accounts.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            // El alta puede traer imagen nueva; si no la trae, se conserva la
            // que la cuenta ya tenía antes de cerrarse.
            ...(dto.image_s3_key !== undefined && {
              image_s3_key: dto.image_s3_key,
            }),
          },
          select: {
            id: true,
            name: true,
            bank_name: true,
            account_number: true,
            image_s3_key: true,
          },
        });
        return {
          ...reactivated,
          image_url: await this.signImageUrl(reactivated.image_s3_key),
        };
      }
      const { status: _status, store_id: _storeId, ...projection } = existing;
      return {
        ...projection,
        image_url: await this.signImageUrl(existing.image_s3_key),
      };
    }

    let ownerStoreId: number | null = storeId;
    if (policy.fiscal_scope === 'ORGANIZATION') {
      const orgLevel = await this.prisma.bank_accounts.findFirst({
        where: {
          organization_id: store.organization_id,
          store_id: null,
          account_number: dto.account_number,
        },
        select: { id: true },
      });
      if (orgLevel) {
        throw new VendixHttpException(
          ErrorCodes.BANK_ACCOUNT_NOT_ASSIGNED_TO_STORE,
        );
      }
      if (!policy.can_manage_organization_accounts) {
        throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
      }
      ownerStoreId = null;
    }

    const account = await this.prisma.bank_accounts.create({
      data: {
        organization_id: store.organization_id,
        // Scope STORE → cuenta de la tienda; scope ORGANIZATION → cuenta de
        // organización (`available_in_all_stores` toma su default `true`).
        store_id: ownerStoreId,
        name: dto.name,
        bank_name: dto.bank_name,
        account_number: dto.account_number,
        bank_code: dto.bank_code ?? null,
        currency: dto.currency ?? 'COP',
        // Sin esto la imagen 21:9 de una cuenta NUEVA se perdía en silencio: el
        // DTO la acepta y el editor la manda en el POST inicial (la cuenta aún
        // no tiene id, así que no hay PATCH que la salve), pero el `data` no la
        // escribía. Toda cuenta recién creada quedaba sin imagen.
        ...(dto.image_s3_key !== undefined && {
          image_s3_key: dto.image_s3_key,
        }),
      },
      select: {
        id: true,
        name: true,
        bank_name: true,
        account_number: true,
        image_s3_key: true,
      },
    });

    return {
      ...account,
      image_url: await this.signImageUrl(account.image_s3_key),
    };
  }

  async update(id: number, dto: UpdateBankAccountDto): Promise<BankAccountOptionDto> {
    const storeId = this.getContextStoreId();
    const owned = await this.assertOwned(id, storeId);

    if (dto.account_number !== undefined) {
      const duplicate = await this.prisma.bank_accounts.findFirst({
        where: {
          organization_id: owned.organization_id,
          store_id: owned.store_id,
          account_number: dto.account_number,
          id: { not: id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_DUPLICATE);
      }
    }

    const account = await this.prisma.bank_accounts.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.bank_name !== undefined && { bank_name: dto.bank_name }),
        ...(dto.account_number !== undefined && { account_number: dto.account_number }),
        ...(dto.bank_code !== undefined && { bank_code: dto.bank_code }),
        ...(dto.image_s3_key !== undefined && { image_s3_key: dto.image_s3_key }),
      },
      select: {
        id: true,
        name: true,
        bank_name: true,
        account_number: true,
        image_s3_key: true,
      },
    });

    return {
      ...account,
      image_url: await this.signImageUrl(account.image_s3_key),
    };
  }

  /**
   * Cierre lógico: `status='closed'` (las cuentas con pagos asociados usan
   * ON DELETE RESTRICT; nunca borrado físico). Devuelve la proyección.
   */
  async close(id: number): Promise<BankAccountOptionDto> {
    const storeId = this.getContextStoreId();
    await this.assertOwned(id, storeId);

    const account = await this.prisma.bank_accounts.update({
      where: { id },
      data: { status: 'closed' },
      select: {
        id: true,
        name: true,
        bank_name: true,
        account_number: true,
        image_s3_key: true,
      },
    });

    return {
      ...account,
      image_url: await this.signImageUrl(account.image_s3_key),
    };
  }

  private getContextStoreId(): number {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new ForbiddenException('Se requiere contexto de tienda para esta operación');
    }
    return storeId;
  }

  private async resolvePolicy(
    organizationId: number,
    storeId: number,
  ): Promise<BankAccountPolicy> {
    return resolveBankAccountPolicy(this.fiscalScopeService, {
      organization_id: organizationId,
      store_id: storeId,
      context: RequestContextService.getContext(),
    });
  }

  /**
   * La cuenta debe estar DISPONIBLE en la tienda (QUI-1061) y el contexto
   * debe poder modificarla: en scope ORGANIZATION una cuenta de organización
   * solo la edita/cierra un usuario de organización.
   */
  private async assertOwned(
    id: number,
    storeId: number,
  ): Promise<{ id: number; organization_id: number; store_id: number | null }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) {
      throw new NotFoundException('Tienda no encontrada');
    }
    const account = await this.prisma.bank_accounts.findFirst({
      where: { id },
      select: {
        id: true,
        organization_id: true,
        store_id: true,
        available_in_all_stores: true,
        store_assignments: { select: { store_id: true } },
      },
    });
    if (!account) {
      throw new NotFoundException('Cuenta bancaria no encontrada');
    }
    if (
      !isBankAccountAvailableInStore(account, storeId, store.organization_id)
    ) {
      throw new ForbiddenException('La cuenta bancaria no pertenece a esta tienda');
    }
    const policy = await this.resolvePolicy(store.organization_id, storeId);
    if (!canModifyBankAccount(account, policy)) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
    }
    return {
      id: account.id,
      organization_id: account.organization_id,
      store_id: account.store_id,
    };
  }
}
