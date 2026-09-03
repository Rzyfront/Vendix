import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
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
   * `status='active'` y scope `organization_id` + (`store_id === null` o
   * `=== store_id`). Devuelve la proyección mínima.
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
        organization_id: store.organization_id,
        status: 'active',
        OR: [{ store_id: null }, { store_id: storeId }],
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
   * Alta de cuenta bancaria, IDEMPOTENTE por `(organization_id, account_number)`.
   *
   * El editor de `custom_config.accounts` reenvía la lista completa en cada
   * guardado, así que "la cuenta ya existe" es el camino NORMAL, no un error del
   * usuario: se devuelve la fila existente para que la ref del `custom_config`
   * SIEMPRE quede con un `bank_accounts.id` real.
   *
   * Sin esta idempotencia el `create` violaba `@@unique([organization_id,
   * account_number])` y la ref se guardaba sin `id` — dejando la cuenta
   * inseleccionable en el cobro (`bank_account_id` NULL → "Pagos sin asignar").
   *
   * Dos matices deliberados:
   * - Una cuenta `closed` que se vuelve a dar de alta se REACTIVA: si no, el
   *   número quedaría quemado para siempre por el unique.
   * - Si la cuenta existe pero pertenece a OTRA tienda de la organización, no se
   *   devuelve (sería fuga entre tiendas) ni se puede crear (unique por org):
   *   409 explícito. Misma regla de pertenencia que ERR-04.
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

    const existing = await this.prisma.bank_accounts.findFirst({
      where: {
        organization_id: store.organization_id,
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

    if (existing) {
      if (existing.store_id !== null && existing.store_id !== storeId) {
        throw new ConflictException(
          'Ya existe una cuenta con ese número en otra tienda de la organización.',
        );
      }
      if (existing.status !== 'active') {
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

    const account = await this.prisma.bank_accounts.create({
      data: {
        organization_id: store.organization_id,
        store_id: storeId,
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
    await this.assertOwned(id, storeId);

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

  private async assertOwned(id: number, storeId: number): Promise<void> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) {
      throw new NotFoundException('Tienda no encontrada');
    }
    const account = await this.prisma.bank_accounts.findFirst({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException('Cuenta bancaria no encontrada');
    }
    if (
      account.organization_id !== store.organization_id ||
      (account.store_id !== null && account.store_id !== storeId)
    ) {
      throw new ForbiddenException('La cuenta bancaria no pertenece a esta tienda');
    }
  }
}
