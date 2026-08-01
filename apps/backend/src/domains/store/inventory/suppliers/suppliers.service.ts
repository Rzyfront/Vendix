import { Injectable } from '@nestjs/common';
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

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: StorePrismaService,
    private readonly operatingScopeService: OperatingScopeService,
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

    return this.prisma.suppliers.create({
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
