import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateKdsDto, UpdateKdsDto } from './dto';

/**
 * KdsService — estaciones de preparación (QUI-651).
 *
 * Espejo de `CashRegistersService`: mismo CRUD, mismo scoping automático por
 * `StorePrismaService`. Lo que agrega, y caja no necesita, es la gestión del
 * KDS POR DEFECTO, que es una pieza funcional y no una comodidad:
 * `fireOrderItemsInTx` resuelve la estación destino de cada item con
 * `products.kds_id ?? <estación por defecto>` y falla con
 * KITCHEN_FIRE_NO_DEFAULT_KDS cuando no hay ninguna. Una tienda sin default no
 * puede enviar nada a cocina.
 *
 * La DB refuerza la invariante con el índice único parcial
 * `kds_one_default_per_store` (`WHERE is_default`), así que promover una
 * estación exige degradar la anterior EN LA MISMA TRANSACCIÓN.
 */
@Injectable()
export class KdsService {
  constructor(private prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }

  /**
   * El `_count` (sesiones, productos, tickets) es contrato con el frontend:
   * con él decide entre borrado físico (`hard=true`, sin historial) y baja
   * lógica. No quitarlo sin coordinar con el agente de consumo.
   */
  private static readonly KDS_COUNT_INCLUDE = {
    _count: { select: { sessions: true, products: true, tickets: true } },
  } as const;

  async findAll() {
    return this.prisma.kds.findMany({
      orderBy: [{ is_default: 'desc' }, { is_active: 'desc' }, { name: 'asc' }],
      include: KdsService.KDS_COUNT_INCLUDE,
    });
  }

  async findOne(id: number) {
    const station = await this.prisma.kds.findFirst({
      where: { id },
      include: KdsService.KDS_COUNT_INCLUDE,
    });
    if (!station) throw new VendixHttpException(ErrorCodes.KDS_NOT_FOUND);
    return station;
  }

  async create(dto: CreateKdsDto) {
    const storeId = this.requireStoreId();

    const dup = await this.prisma.kds.findFirst({ where: { code: dto.code } });
    if (dup) throw new VendixHttpException(ErrorCodes.KDS_DUP_CODE);

    // La PRIMERA estación de la tienda es default por fuerza, aunque el caller
    // no lo pida: si quedara sin default, la tienda no podria firear.
    const existingCount = await this.prisma.kds.count();
    const shouldBeDefault = dto.is_default === true || existingCount === 0;

    return (this.prisma as any).$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (shouldBeDefault) {
          await this.demoteCurrentDefault(tx, storeId);
        }
        return tx.kds.create({
          data: {
            store_id: storeId,
            name: dto.name,
            code: dto.code,
            description: dto.description ?? null,
            is_active: dto.is_active ?? true,
            is_default: shouldBeDefault,
            location_id: dto.location_id ?? null,
            updated_at: new Date(),
          },
        });
      },
    );
  }

  async update(id: number, dto: UpdateKdsDto) {
    const storeId = this.requireStoreId();
    const current = await this.findOne(id);

    if (dto.code && dto.code !== current.code) {
      const dup = await this.prisma.kds.findFirst({
        where: { code: dto.code, id: { not: id } },
      });
      if (dup) throw new VendixHttpException(ErrorCodes.KDS_DUP_CODE);
    }

    // Un default no se puede desactivar ni degradar sin promover otro antes:
    // dejaría a la tienda sin estación a la cual rutear.
    if (current.is_default && dto.is_default === false) {
      throw new VendixHttpException(ErrorCodes.KDS_DEFAULT_PROTECTED);
    }
    if (current.is_default && dto.is_active === false) {
      throw new VendixHttpException(ErrorCodes.KDS_DEFAULT_PROTECTED);
    }
    // Promover una estación inactiva la dejaria como default inalcanzable: el
    // fire filtra por `is_active`.
    if (dto.is_default === true && dto.is_active === false) {
      throw new VendixHttpException(ErrorCodes.KDS_DEFAULT_MUST_BE_ACTIVE);
    }

    return (this.prisma as any).$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (dto.is_default === true && !current.is_default) {
          await this.demoteCurrentDefault(tx, storeId);
        }
        await tx.kds.updateMany({
          where: { id, store_id: storeId },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.code !== undefined && { code: dto.code }),
            ...(dto.description !== undefined && {
              description: dto.description,
            }),
            ...(dto.is_active !== undefined && { is_active: dto.is_active }),
            ...(dto.is_default !== undefined && { is_default: dto.is_default }),
            ...(dto.location_id !== undefined && {
              location_id: dto.location_id,
            }),
            updated_at: new Date(),
          },
        });
        return tx.kds.findFirst({ where: { id, store_id: storeId } });
      },
    );
  }

  /**
   * Reactivación explícita de una estación dada de baja lógica. Siempre
   * permitida (incluso sobre el default: un default nunca está inactivo, así
   * que no hay conflicto posible) e idempotente: si ya está activa, no-op.
   * No toca `is_default`: promover es trabajo de `update({ is_default })`.
   */
  async activate(id: number) {
    const storeId = this.requireStoreId();
    const current = await this.findOne(id);
    if (current.is_active) return current;

    await this.prisma.kds.updateMany({
      where: { id, store_id: storeId },
      data: { is_active: true, updated_at: new Date() },
    });
    return this.findOne(id);
  }

  /**
   * Baja lógica (vía normal). No se borra la fila: `kitchen_tickets.kds_id`
   * es NOT NULL con FK RESTRICT, así que borrar una estación con historial
   * fallaria — y debe fallar, no arrastrar los tickets. Para borrar la fila
   * ver `hardDelete` (`DELETE ?hard=true`).
   */
  async remove(id: number, hard = false) {
    if (hard) return this.hardDelete(id);

    const storeId = this.requireStoreId();
    const current = await this.findOne(id);
    if (current.is_default) {
      throw new VendixHttpException(ErrorCodes.KDS_DEFAULT_PROTECTED);
    }

    const openSession = await this.prisma.kds_sessions.findFirst({
      where: { kds_id: id, status: 'open' },
      select: { id: true },
    });
    if (openSession) {
      throw new VendixHttpException(ErrorCodes.KDS_HAS_OPEN_SESSION);
    }

    await this.prisma.kds.updateMany({
      where: { id, store_id: storeId },
      data: { is_active: false, updated_at: new Date() },
    });
    return this.findOne(id);
  }

  /**
   * Borrado FÍSICO. Solo procede sobre una estación sin historial:
   *
   *  1. El default nunca se borra (promover otra antes).
   *  2. Con sesión abierta, 409 `KDS_HAS_OPEN_SESSION` — el chequeo va ANTES
   *     del de historial porque una sesión abierta también cuenta como
   *     historial y el operador necesita el mensaje accionable (cerrarla).
   *  3. Con sesiones (cualquier estado) o tickets, 409 `KDS_HAS_HISTORY` con
   *     conteos en `details`: la vía es la baja lógica.
   *  4. Con productos apuntando (`products.kds_id`), 409 `KDS_HAS_PRODUCTS`:
   *     la FK es SET NULL y la DB dejaría borrar, pero huérfanos de tablero
   *     caerían al default en el fire. Reasignar antes de reintentar.
   *
   * Sin historial borra con `deleteMany({ id, store_id })` — forma scope-safe
   * (el scope mergearía un `delete` único en `{ AND: [...] }` y Prisma lo
   * rechazaría antes de llegar a SQL).
   */
  async hardDelete(id: number) {
    const storeId = this.requireStoreId();
    const current = await this.findOne(id);
    if (current.is_default) {
      throw new VendixHttpException(
        ErrorCodes.KDS_DEFAULT_PROTECTED,
        `La estación ${id} es la estación por defecto: promueve otra antes de eliminarla`,
        { kds_id: id },
      );
    }

    const openSession = await this.prisma.kds_sessions.findFirst({
      where: { kds_id: id, status: 'open' },
      select: { id: true },
    });
    if (openSession) {
      throw new VendixHttpException(
        ErrorCodes.KDS_HAS_OPEN_SESSION,
        undefined,
        { kds_id: id, open_session_id: openSession.id },
      );
    }

    const [sessionCount, ticketCount] = await Promise.all([
      this.prisma.kds_sessions.count({ where: { kds_id: id } }),
      this.prisma.kitchen_tickets.count({ where: { kds_id: id } }),
    ]);
    if (sessionCount > 0 || ticketCount > 0) {
      throw new VendixHttpException(
        ErrorCodes.KDS_HAS_HISTORY,
        `La estación ${id} tiene historial (${sessionCount} sesiones, ${ticketCount} tickets): desactívala en lugar de eliminarla`,
        { kds_id: id, sessions: sessionCount, tickets: ticketCount },
      );
    }

    const productCount = await this.prisma.products.count({
      where: { kds_id: id },
    });
    if (productCount > 0) {
      throw new VendixHttpException(
        ErrorCodes.KDS_HAS_PRODUCTS,
        `La estación ${id} tiene ${productCount} producto(s) asignado(s): reasígnalos a otra estación antes de eliminarla`,
        { kds_id: id, products: productCount },
      );
    }

    const deleted = await this.prisma.kds.deleteMany({
      where: { id, store_id: storeId },
    });
    if (deleted.count !== 1) {
      throw new VendixHttpException(ErrorCodes.KDS_NOT_FOUND);
    }
    return { deleted: true, id };
  }

  /**
   * Degrada la estación default vigente. Es un paso separado y no un
   * `updateMany` combinado porque el índice único parcial rechaza el estado
   * intermedio con dos defaults: hay que soltar el viejo antes de poner el nuevo.
   */
  private async demoteCurrentDefault(
    tx: Prisma.TransactionClient,
    storeId: number,
  ): Promise<void> {
    await tx.kds.updateMany({
      where: { store_id: storeId, is_default: true },
      data: { is_default: false, updated_at: new Date() },
    });
  }
}
