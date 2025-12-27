import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { purchase_order_status_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: StorePrismaService) { }

  async create(createPurchaseOrderDto: CreatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Process items to handle new product creation
      const processedItems: any[] = [];
      const organization_id = RequestContextService.getOrganizationId();

      if (!organization_id) {
        throw new BadRequestException('Organization ID not found in context');
      }

      for (const item of createPurchaseOrderDto.items) {
        let finalProductId = item.product_id;

        // If product_id is 0 or missing, and we have name/sku, create the product
        if ((!finalProductId || finalProductId === 0) && item.product_name) {
          // Check if product with SKU exists to avoid duplicates? 
          // Start simple: Create new product
          // Resolve store_id for the new product
          let storeId: number | undefined;

          // Try to get store from location if possible, or fallback to first store of org
          const location = await tx.inventory_locations.findUnique({
            where: { id: createPurchaseOrderDto.location_id },
            select: { store_id: true }
          });

          if (location?.store_id) {
            storeId = location.store_id;
          } else {
            const firstStore = await tx.stores.findFirst({
              where: { organization_id }
            });
            storeId = firstStore?.id;
          }

          if (!storeId) {
            throw new BadRequestException('Cannot create new product: No store found for this organization.');
          }

          const newProduct = await tx.products.create({
            data: {
              name: item.product_name,
              slug: item.product_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') + `-${Date.now()}`,
              description: item.product_description || '',
              sku: item.sku || `GEN-${Date.now()}`,
              base_price: 0, // 'base_price' is required, setting to 0 as it's a new product
              stock_quantity: 0, // 'stock_quantity' correct field name
              state: 'active', // 'state' enum (using 'active' or 'inactive')
              store_id: storeId, // 'store_id' is required
            }
          });
          finalProductId = newProduct.id;

          // Optionally create a supplier_product entry?
          // For now, minimal valid product creation.
          finalProductId = newProduct.id;
        }

        // If we still don't have a valid ID and it was supposed to be new, throw error? 
        // For now, assume if ID is 0 and no name, it's invalid, but let Prisma fail on FK.

        processedItems.push({
          ...item,
          product_id: finalProductId,
          // Remove temp fields to avoid prisma error if it tries to map them to order item (though strict typing might strip them, manual mapping is safer)
          product_name: undefined,
          sku: undefined,
          product_description: undefined
        });
      }

      // Calculate totals using processed items
      const subtotal = processedItems.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0,
      );

      const totalAmount =
        subtotal -
        (createPurchaseOrderDto.discount_amount || 0) +
        (createPurchaseOrderDto.tax_amount || 0) +
        (createPurchaseOrderDto.shipping_cost || 0);


      // Generate order number
      const date = new Date();
      const order_number = `PO-${date.getFullYear()}${(date.getMonth() + 1)
        .toString()
        .padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${Math.floor(
          Math.random() * 1000,
        )
          .toString()
          .padStart(3, '0')}`;

      // Create purchase order
      // We must construct the creation data carefully. 
      // The original code passed `...createPurchaseOrderDto`. We need to replace `items` with `processedItems`.

      // Clean up DTO to avoid spreading the old items array
      const { items, created_by_user_id, ...orderData } = createPurchaseOrderDto;
      const user_id = RequestContextService.getUserId();

      // Validate Location and Supplier existence to prevent FK errors
      if (orderData.location_id) {
        const locationExists = await tx.inventory_locations.findFirst({
          where: { id: orderData.location_id, organization_id }
        });
        if (!locationExists) {
          throw new BadRequestException(`La bodega con ID ${orderData.location_id} no existe o no está activa.`);
        }
      }

      if (orderData.supplier_id) {
        const supplierExists = await tx.suppliers.findFirst({
          where: { id: orderData.supplier_id, organization_id }
        });
        if (!supplierExists) {
          throw new BadRequestException(`El proveedor con ID ${orderData.supplier_id} no existe.`);
        }
      }

      const purchaseOrder = await tx.purchase_orders.create({
        data: {
          ...orderData,
          created_by_user_id: user_id,
          organization_id,
          order_number,
          subtotal_amount: subtotal,
          total_amount: totalAmount,
          order_date: new Date(),
          purchase_order_items: {
            create: processedItems.map(item => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              quantity_ordered: item.quantity,
              unit_cost: item.unit_price,
              // total_cost: item.quantity * item.unit_price, // Optional if we want to save it calculated
              notes: item.notes,
              batch_number: item.batch_number,
              manufacturing_date: item.manufacturing_date,
              expiration_date: item.expiration_date
            }))
          }
        },
        include: {
          suppliers: true,
          location: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });

      return purchaseOrder;
    });
  }

  findAll(query: PurchaseOrderQueryDto) {
    const where: any = {
      supplier_id: query.supplier_id,
      location_id: query.location_id,
      status: query.status,
    };

    // Add date range filter
    if (query.start_date || query.end_date) {
      where.order_date = {};
      if (query.start_date) {
        where.order_date.gte = new Date(query.start_date);
      }
      if (query.end_date) {
        where.order_date.lte = new Date(query.end_date);
      }
    }

    // Add total amount range filter
    if (query.min_total || query.max_total) {
      where.total_amount = {};
      if (query.min_total) {
        where.total_amount.gte = query.min_total;
      }
      if (query.max_total) {
        where.total_amount.lte = query.max_total;
      }
    }

    // Add search filter
    if (query.search) {
      where.OR = [
        { internal_reference: { contains: query.search } },
        { supplier_reference: { contains: query.search } },
        { notes: { contains: query.search } },
        { suppliers: { name: { contains: query.search } } },
      ];
    }

    return this.prisma.purchase_orders.findMany({
      where,
      include: {
        suppliers: true,
        location: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
      orderBy: {
        order_date: 'desc',
      },
    });
  }

  findByStatus(
    status: purchase_order_status_enum,
    query: PurchaseOrderQueryDto,
  ) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findPending(query: PurchaseOrderQueryDto) {
    return this.findAll({
      ...query,
      status: purchase_order_status_enum.approved,
    });
  }

  findBySupplier(supplierId: number, query: PurchaseOrderQueryDto) {
    return this.findAll({
      ...query,
      supplier_id: supplierId,
    });
  }

  findOne(id: number) {
    return this.prisma.purchase_orders.findUnique({
      where: { id },
      include: {
        suppliers: true,
        location: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async update(id: number, updatePurchaseOrderDto: UpdatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // If items are being updated, recalculate totals
      if (updatePurchaseOrderDto.items) {
        const subtotal = updatePurchaseOrderDto.items.reduce(
          (sum, item) => sum + item.quantity * item.unit_price,
          0,
        );

        const totalAmount =
          subtotal -
          (updatePurchaseOrderDto.discount_amount || 0) +
          (updatePurchaseOrderDto.tax_amount || 0) +
          (updatePurchaseOrderDto.shipping_cost || 0);

        (updatePurchaseOrderDto as any).subtotal = subtotal;
        (updatePurchaseOrderDto as any).total_amount = totalAmount;
      }

      return tx.purchase_orders.update({
        where: { id },
        data: updatePurchaseOrderDto,
        include: {
          suppliers: true,
          location: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  async approve(id: number) {
    return this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.approved,
        approved_date: new Date(),
      },
      include: {
        suppliers: true,
        location: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async cancel(id: number) {
    return this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.cancelled,
        cancelled_date: new Date(),
      },
      include: {
        suppliers: true,
        location: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async receive(
    id: number,
    items: Array<{ id: number; quantity_received: number }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Update purchase order items with received quantities
      for (const item of items) {
        await tx.purchase_order_items.update({
          where: { id: item.id },
          data: {
            quantity_received: { increment: item.quantity_received },
          },
        });
      }

      // Fetch the updated order to check status and process movements
      const purchaseOrder = await tx.purchase_orders.findUnique({
        where: { id },
        include: {
          purchase_order_items: true,
          location: true,
        },
      });

      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      // Create inventory movements for received items
      for (const item of items) {
        const orderItem = purchaseOrder.purchase_order_items.find(i => i.id === item.id);
        const productId = orderItem?.product_id;
        const productVariantId = orderItem?.product_variant_id;

        if (productId && item.quantity_received > 0) {
          await tx.inventory_movements.create({
            data: {
              organization_id: purchaseOrder.organization_id,
              product_id: productId,
              product_variant_id: productVariantId || null,
              to_location_id: purchaseOrder.location_id,
              quantity: item.quantity_received,
              movement_type: 'stock_in',
              source_order_type: 'purchase',
              source_order_id: id,
              reason: 'Purchase order receipt',
              created_at: new Date(),
            },
          });

          // Update stock levels
          await this.updateStockLevel(
            tx,
            productId,
            purchaseOrder.location_id!,
            item.quantity_received,
            productVariantId || undefined,
          );
        }
      }

      // Check cumulative status based on actual DB state
      const allItemsReceived = purchaseOrder.purchase_order_items.every(
        (item) => (item.quantity_received || 0) >= item.quantity_ordered
      );

      // Update purchase order status
      let newStatus = purchaseOrder.status;
      if (allItemsReceived) {
        newStatus = purchase_order_status_enum.received;
      }

      return tx.purchase_orders.update({
        where: { id },
        data: {
          status: newStatus,
          received_date: allItemsReceived ? new Date() : null,
        },
        include: {
          suppliers: true,
          location: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  remove(id: number) {
    return this.prisma.purchase_orders.delete({
      where: { id },
    });
  }

  private async updateStockLevel(
    tx: any,
    productId: number,
    locationId: number,
    quantityChange: number,
    productVariantId?: number,
  ) {
    // Use findFirst instead of findUnique to avoid composite key null issues
    const existingStock = await tx.stock_levels.findFirst({
      where: {
        product_id: productId,
        product_variant_id: productVariantId || null,
        location_id: locationId,
      },
    });

    if (existingStock) {
      const newQuantityOnHand = existingStock.quantity_on_hand + quantityChange;
      const newQuantityAvailable =
        existingStock.quantity_available + quantityChange;

      return tx.stock_levels.update({
        where: { id: existingStock.id },
        data: {
          quantity_on_hand: Math.max(0, newQuantityOnHand),
          quantity_available: Math.max(0, newQuantityAvailable),
          updated_at: new Date(),
        },
      });
    } else {
      return tx.stock_levels.create({
        data: {
          product_id: productId,
          product_variant_id: productVariantId || null,
          location_id: locationId,
          quantity_on_hand: Math.max(0, quantityChange),
          quantity_reserved: 0,
          quantity_available: Math.max(0, quantityChange),
          updated_at: new Date(), // Fixed field name to updated_at
        },
      });
    }
  }
}
