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

  async findAll() {
    return this.prisma.kds.findMany({
      orderBy: [{ is_default: 'desc' }, { is_active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { sessions: true, products: true } } },
    });
  }

  async findOne(id: number) {
    const station = await this.prisma.kds.findFirst({ where: { id } });
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
   * Baja lógica. No se borra la fila: `kitchen_tickets.kds_id` es NOT NULL con
   * FK RESTRICT, así que borrar una estación con historial fallaria — y debe
   * fallar, no arrastrar los tickets.
   */
  async remove(id: number) {
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
