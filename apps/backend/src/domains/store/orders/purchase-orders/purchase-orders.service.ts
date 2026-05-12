import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { purchase_order_status_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { toTitleCase } from '@common/utils/format.util';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { CostingService } from '../../inventory/shared/services/costing.service';
import { AuditService } from '@common/audit/audit.service';
import { S3Service } from '@common/services/s3.service';
import { SettingsService } from '../../settings/settings.service';
import { CostPreviewDto } from './dto/cost-preview.dto';

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private costingService: CostingService,
    private auditService: AuditService,
    private s3Service: S3Service,
    private settingsService: SettingsService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(createPurchaseOrderDto: CreatePurchaseOrderDto) {
    const result = await this.prisma.$transaction(async (tx) => {
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
            select: { store_id: true },
          });

          if (location?.store_id) {
            storeId = location.store_id;
          } else {
            const firstStore = await tx.stores.findFirst({
              where: { organization_id },
            });
            storeId = firstStore?.id;
          }

          if (!storeId) {
            throw new BadRequestException(
              'Cannot create new product: No store found for this organization.',
            );
          }

          // Check if product with SKU exists to avoid duplicates
          const existingProduct = await tx.products.findFirst({
            where: {
              sku: item.sku,
              store_id: storeId,
              state: { not: 'archived' },
            },
          });

          // Normalize Data first
          // Normalize Booleanos (Si/No -> true/false)
          const normalizeBool = (val: any) => {
            if (typeof val === 'boolean') return val;
            if (typeof val === 'string') {
              const s = val.trim().toLowerCase();
              return (
                s === 'si' || s === 'yes' || s === 'verdadero' || s === 'true'
              );
            }
            return !!val;
          };

          const availableForEcommerce = normalizeBool(
            item.available_for_ecommerce ?? true,
          );
          const isOnSale = normalizeBool((item as any).is_on_sale ?? false);

          // Normalize State
          let productState: any = 'active';
          if (item.state && typeof item.state === 'string') {
            const s = item.state.trim().toLowerCase();
            if (s === 'activo' || s === 'active' || s === 'habilitado')
              productState = 'active';
            else if (
              s === 'inactivo' ||
              s === 'inactive' ||
              s === 'deshabilitado'
            )
              productState = 'inactive';
            else if (s === 'archivado' || s === 'archived')
              productState = 'archived';
          }

          // Price calculation
          let basePrice = item.base_price || 0;
          const cost = item.unit_price || 0;
          let margin = item.profit_margin || 0;
          if (margin > 0 && margin < 1) margin = margin * 100;

          if (
            margin > 0 &&
            cost > 0 &&
            (!item.base_price || item.base_price === 0)
          ) {
            basePrice = cost * (1 + margin / 100);
          }

          // Resolve Brand: trim + lowercase for search, Title Case for creation
          let brandId: number | undefined;
          if (item.brand_name) {
            const normalizedBrandName = item.brand_name.trim().toLowerCase();
            if (normalizedBrandName) {
              const brand = await tx.brands.findFirst({
                where: {
                  name: { equals: normalizedBrandName, mode: 'insensitive' },
                },
              });
              if (brand) {
                brandId = brand.id;
              } else {
                const titleCaseBrandName = toTitleCase(item.brand_name.trim());
                const newBrand = await tx.brands.create({
                  data: {
                    name: titleCaseBrandName,
                    description: 'Creada automáticamente por carga masiva PO',
                    state: 'active',
                  },
                });
                brandId = newBrand.id;
              }
            }
          }

          // Resolve Categories: split by ",", trim + lowercase for search, Title Case for creation
          const categoryIds: number[] = [];
          if (item.category_names) {
            const names = item.category_names
              .split(',')
              .map((n) => n.trim())
              .filter((n) => n);
            for (const name of names) {
              const normalizedCatName = name.toLowerCase();
              const slug = normalizedCatName
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)+/g, '');

              // Search by slug (already lowercase/normalized)
              const cat = await tx.categories.findFirst({
                where: { slug: slug, store_id: storeId },
              });
              if (cat) {
                categoryIds.push(cat.id);
              } else {
                const titleCaseCatName = toTitleCase(name);
                const newCat = await tx.categories.create({
                  data: {
                    name: titleCaseCatName,
                    slug: slug,
                    store_id: storeId,
                    state: 'active',
                  },
                });
                categoryIds.push(newCat.id);
              }
            }
          }

          if (existingProduct) {
            finalProductId = existingProduct.id;
            // Update existing product with new metadata if provided
            await tx.products.update({
              where: { id: existingProduct.id },
              data: {
                state: productState,
                weight: item.weight || existingProduct.weight,
                available_for_ecommerce: availableForEcommerce,
                is_on_sale: isOnSale,
                sale_price:
                  item.sale_price !== undefined
                    ? item.sale_price
                    : existingProduct.sale_price,
                brand_id:
                  brandId !== undefined ? brandId : existingProduct.brand_id,
                product_categories: {
                  deleteMany: {},
                  create: categoryIds.map((id) => ({ category_id: id })),
                },
                base_price:
                  basePrice > 0 ? basePrice : existingProduct.base_price,
                profit_margin:
                  margin > 0 ? margin : existingProduct.profit_margin,
                cost_price: cost > 0 ? cost : existingProduct.cost_price,
                description:
                  item.product_description || existingProduct.description,
              },
            });
          } else {
            const newProduct = await tx.products.create({
              data: {
                name: item.product_name,
                slug:
                  item.product_name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)+/g, '') + `-${Date.now()}`,
                description: item.product_description || '',
                sku: item.sku || `GEN-${Date.now()}`,
                base_price: basePrice,
                cost_price: cost,
                profit_margin: margin,
                stock_quantity: 0,
                state: productState,
                store_id: storeId,
                weight: item.weight || 0,
                available_for_ecommerce: availableForEcommerce,
                is_on_sale: isOnSale,
                sale_price: item.sale_price || 0,
                brand_id: brandId,
                product_categories: {
                  create: categoryIds.map((id) => ({ category_id: id })),
                },
              },
            });
            finalProductId = newProduct.id;
          }
        }

        processedItems.push({
          ...item,
          product_id: finalProductId,
          product_name: undefined,
          sku: undefined,
          product_description: undefined,
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
        .padStart(
          2,
          '0',
        )}${date.getDate().toString().padStart(2, '0')}-${Math.floor(
        Math.random() * 1000,
      )
        .toString()
        .padStart(3, '0')}`;

      const { items, created_by_user_id, ...orderData } =
        createPurchaseOrderDto;
      const user_id = RequestContextService.getUserId();

      // Validate Location and Supplier existence to prevent FK errors
      if (orderData.location_id) {
        const locationExists = await tx.inventory_locations.findFirst({
          where: { id: orderData.location_id, organization_id },
        });
        if (!locationExists) {
          throw new BadRequestException(
            `La bodega con ID ${orderData.location_id} no existe o no está activa.`,
          );
        }
      }

      if (orderData.supplier_id) {
        const supplierExists = await tx.suppliers.findFirst({
          where: { id: orderData.supplier_id, organization_id },
        });
        if (!supplierExists) {
          throw new BadRequestException(
            `El proveedor con ID ${orderData.supplier_id} no existe.`,
          );
        }
      }

      // Coerce ISO-string dates to Date before Prisma. `@IsDateString` only
      // validates the wire format; Prisma DateTime columns require Date or a
      // full ISO-8601 DateTime, so `YYYY-MM-DD` from <input type="date">
      // would otherwise blow up here.
      const toDate = (v: unknown): Date | undefined => {
        if (v == null || v === '') return undefined;
        if (v instanceof Date) return v;
        const d = new Date(String(v));
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const { expected_date: rawExpectedDate, ...orderDataRest } = orderData;

      const purchaseOrder = await tx.purchase_orders.create({
        data: {
          ...orderDataRest,
          expected_date: toDate(rawExpectedDate),
          created_by_user_id: user_id,
          organization_id,
          order_number,
          subtotal_amount: subtotal,
          total_amount: totalAmount,
          order_date: new Date(),
          purchase_order_items: {
            create: processedItems.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              quantity_ordered: item.quantity,
              unit_cost: item.unit_price,
              notes: item.notes,
              batch_number: item.batch_number,
              manufacturing_date: toDate(item.manufacturing_date),
              expiration_date: toDate(item.expiration_date),
            })),
          },
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

    // Audit log after transaction
    try {
      const user_id = RequestContextService.getUserId();
      await this.auditService.logCustom(
        user_id ?? 0,
        'PO_CREATED',
        'purchase_orders',
        { purchase_order_id: result.id, order_number: result.order_number },
        result.id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO create #${result.id}: ${error.message}`,
      );
    }

    return result;
  }

  async findAll(query: PurchaseOrderQueryDto) {
    const {
      page = 1,
      limit = 10,
      sort_by = 'order_date',
      sort_order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

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

    const include = {
      suppliers: true,
      location: true,
      purchase_order_items: {
        include: {
          products: true,
          product_variants: true,
        },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.purchase_orders.findMany({
        where,
        include,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.purchase_orders.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
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
    // Schema only carries `approved_by_user_id` (FK) — there is no
    // `approved_date` column. Audit timestamp is recorded via auditService.
    const approver_id = RequestContextService.getUserId() ?? null;
    const result = await this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.approved,
        approved_by_user_id: approver_id,
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

    // Audit log
    try {
      const user_id = RequestContextService.getUserId();
      await this.auditService.logCustom(
        user_id ?? 0,
        'PO_APPROVED',
        'purchase_orders',
        { purchase_order_id: id },
        id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO approve #${id}: ${error.message}`,
      );
    }

    return result;
  }

  async cancel(id: number) {
    // Schema has no `cancelled_date` column — cancellation timestamp is
    // captured by the audit log entry below.
    const result = await this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.cancelled,
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

    // Audit log
    try {
      const user_id = RequestContextService.getUserId();
      await this.auditService.logCustom(
        user_id ?? 0,
        'PO_CANCELLED',
        'purchase_orders',
        { purchase_order_id: id },
        id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO cancel #${id}: ${error.message}`,
      );
    }

    return result;
  }

  async receive(id: number, dto: ReceivePurchaseOrderDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Create reception record
      const user_id = RequestContextService.getUserId();
      const reception = await tx.purchase_order_receptions.create({
        data: {
          purchase_order_id: id,
          received_by_user_id: user_id,
          notes: dto.notes,
        },
      });

      // Process each item
      for (const item of dto.items) {
        if (item.quantity_received <= 0) continue;

        // Create reception item record
        await tx.purchase_order_reception_items.create({
          data: {
            reception_id: reception.id,
            purchase_order_item_id: item.id,
            quantity_received: item.quantity_received,
          },
        });

        // Increment quantity_received on purchase_order_items
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
        throw new NotFoundException('Purchase order not found');
      }

      // Read costing method from store settings
      const settings = await this.settingsService.getSettings();
      const costingMethod: 'weighted_average' | 'fifo' | 'lifo' =
        settings.inventory?.costing_method === 'fifo'
          ? 'fifo'
          : 'weighted_average';

      // Create inventory movements, update stock, and calculate cost for received items
      for (const item of dto.items) {
        if (item.quantity_received <= 0) continue;

        const orderItem = purchaseOrder.purchase_order_items.find(
          (i) => i.id === item.id,
        );
        const productId = orderItem?.product_id;
        const productVariantId = orderItem?.product_variant_id;

        if (productId) {
          // Update stock levels using StockLevelManager
          await this.stockLevelManager.updateStock(
            {
              product_id: productId,
              variant_id: productVariantId || undefined,
              location_id: purchaseOrder.location_id!,
              quantity_change: item.quantity_received,
              movement_type: 'stock_in',
              reason: 'Purchase order receipt',
              create_movement: true,
              source_module: 'pop_purchase',
            },
            tx,
          );

          // Calculate cost on receipt using CostingService
          try {
            await this.costingService.calculateCostOnReceipt(
              {
                product_id: productId,
                variant_id: productVariantId || undefined,
                location_id: purchaseOrder.location_id!,
                quantity_received: item.quantity_received,
                unit_cost: Number(orderItem.unit_cost || 0),
                costing_method: costingMethod,
                purchase_order_id: id,
                batch_number: orderItem.batch_number || undefined,
                manufacturing_date: orderItem.manufacturing_date || undefined,
                expiration_date: orderItem.expiration_date || undefined,
              },
              tx,
            );
          } catch (error) {
            this.logger.error(
              `Failed to calculate cost for PO item #${item.id}: ${error.message}`,
            );
          }
        }
      }

      // Determine new status based on cumulative quantities
      const all_items_received = purchaseOrder.purchase_order_items.every(
        (item) => (item.quantity_received || 0) >= item.quantity_ordered,
      );

      const some_items_received = purchaseOrder.purchase_order_items.some(
        (item) => (item.quantity_received || 0) > 0,
      );

      let newStatus = purchaseOrder.status;
      if (all_items_received) {
        newStatus = purchase_order_status_enum.received;
      } else if (
        some_items_received &&
        newStatus !== purchase_order_status_enum.received
      ) {
        newStatus = 'partial' as purchase_order_status_enum;
      }

      // Update purchase order status
      const updated_po = await tx.purchase_orders.update({
        where: { id },
        data: {
          status: newStatus,
          received_date: all_items_received ? new Date() : null,
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

      return { updated_po, all_items_received };
    });

    // Audit log after transaction
    try {
      const user_id = RequestContextService.getUserId();
      const audit_action = result.all_items_received
        ? 'PO_RECEIVED'
        : 'PO_PARTIALLY_RECEIVED';
      await this.auditService.logCustom(
        user_id ?? 0,
        audit_action,
        'purchase_orders',
        { purchase_order_id: id, items_count: dto.items.length },
        id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO receive #${id}: ${error.message}`,
      );
    }

    // Emit purchase_order.received for accounting ONLY when fully received
    if (result.all_items_received) {
      try {
        const total_amount = Number(result.updated_po.total_amount || 0);
        if (total_amount > 0) {
          this.eventEmitter.emit('purchase_order.received', {
            purchase_order_id: result.updated_po.id,
            organization_id: result.updated_po.organization_id,
            store_id: result.updated_po.location?.store_id,
            total_amount,
            user_id: RequestContextService.getUserId(),
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to emit purchase_order.received for PO #${id}: ${error.message}`,
        );
      }
    }

    return result.updated_po;
  }

  // ===== Receptions =====

  async getReceptions(purchaseOrderId: number) {
    return this.prisma.purchase_order_receptions.findMany({
      where: { purchase_order_id: purchaseOrderId },
      include: {
        received_by: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
        items: {
          include: {
            purchase_order_item: {
              include: {
                products: { select: { id: true, name: true } },
                product_variants: {
                  select: { id: true, sku: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: { received_at: 'desc' },
    });
  }

  // ===== Cost Summary =====

  async getCostSummary(purchaseOrderId: number) {
    return this.prisma.inventory_cost_layers.findMany({
      where: { purchase_order_id: purchaseOrderId },
      orderBy: { received_at: 'desc' },
    });
  }

  // ===== Timeline =====

  async getTimeline(purchaseOrderId: number) {
    const [auditLogs, receptions, payments] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where: { resource: 'purchase_orders', resource_id: purchaseOrderId },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.purchase_order_receptions.findMany({
        where: { purchase_order_id: purchaseOrderId },
        include: {
          received_by: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { received_at: 'desc' },
      }),
      this.prisma.purchase_order_payments.findMany({
        where: { purchase_order_id: purchaseOrderId },
        include: {
          created_by: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    const timeline = [
      ...auditLogs.map((l) => ({
        type: 'audit' as const,
        date: l.created_at || new Date(0),
        data: l,
      })),
      ...receptions.map((r) => ({
        type: 'reception' as const,
        date: r.received_at,
        data: r,
      })),
      ...payments.map((p) => ({
        type: 'payment' as const,
        date: p.created_at,
        data: p,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return timeline;
  }

  // ===== Attachments =====

  async addAttachment(
    purchaseOrderId: number,
    file: Express.Multer.File,
    dto: AddAttachmentDto,
  ) {
    // 1. Upload to S3 using S3Service (store the KEY, not the presigned URL)
    const s3Key = await this.s3Service.uploadFile(
      file.buffer,
      `purchase-orders/attachments/${purchaseOrderId}/${Date.now()}-${file.originalname}`,
      file.mimetype,
    );

    // 2. Create DB record with S3 key
    const userId = RequestContextService.getUserId();
    const attachment = await this.prisma.purchase_order_attachments.create({
      data: {
        purchase_order_id: purchaseOrderId,
        file_url: s3Key,
        file_name: file.originalname,
        file_type: file.mimetype,
        file_size: file.size,
        supplier_invoice_number: dto.supplier_invoice_number,
        supplier_invoice_date: dto.supplier_invoice_date
          ? new Date(dto.supplier_invoice_date)
          : null,
        supplier_invoice_amount: dto.supplier_invoice_amount,
        notes: dto.notes,
        uploaded_by_user_id: userId,
      },
    });

    // 3. Audit log
    try {
      await this.auditService.logCustom(
        userId ?? 0,
        'PO_ATTACHMENT_ADDED',
        'purchase_orders',
        { file_name: file.originalname, attachment_id: attachment.id },
        purchaseOrderId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO attachment #${purchaseOrderId}: ${error.message}`,
      );
    }

    return attachment;
  }

  async getAttachments(purchaseOrderId: number) {
    const attachments = await this.prisma.purchase_order_attachments.findMany({
      where: { purchase_order_id: purchaseOrderId },
      include: {
        uploaded_by: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Generate presigned URLs for each attachment
    return Promise.all(
      attachments.map(async (att) => ({
        ...att,
        download_url: await this.s3Service.signUrl(att.file_url),
      })),
    );
  }

  async removeAttachment(attachmentId: number) {
    const attachment = await this.prisma.purchase_order_attachments.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    // Delete from S3
    try {
      await this.s3Service.deleteFile(attachment.file_url);
    } catch (error) {
      this.logger.error(
        `Failed to delete S3 file ${attachment.file_url}: ${error.message}`,
      );
    }

    // Delete from DB
    await this.prisma.purchase_order_attachments.delete({
      where: { id: attachmentId },
    });

    return { deleted: true };
  }

  // ===== Payments =====

  async registerPayment(purchaseOrderId: number, dto: RegisterPaymentDto) {
    const po = await this.prisma.purchase_orders.findUnique({
      where: { id: purchaseOrderId },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }

    // Get existing payments total
    const existingPayments =
      await this.prisma.purchase_order_payments.aggregate({
        where: { purchase_order_id: purchaseOrderId },
        _sum: { amount: true },
      });

    const totalPaid =
      Number(existingPayments._sum.amount || 0) + Number(dto.amount);
    const totalAmount = Number(po.total_amount);

    if (totalPaid > totalAmount) {
      throw new BadRequestException(
        'El pago excedería el monto total de la orden',
      );
    }

    const userId = RequestContextService.getUserId();

    // Create payment record
    const payment = await this.prisma.purchase_order_payments.create({
      data: {
        purchase_order_id: purchaseOrderId,
        amount: dto.amount,
        payment_date: new Date(dto.payment_date),
        payment_method: dto.payment_method,
        reference: dto.reference,
        notes: dto.notes,
        created_by_user_id: userId,
      },
    });

    // Update payment_status on PO
    let paymentStatus: 'unpaid' | 'partial' | 'paid' = 'unpaid';
    if (totalPaid >= totalAmount) paymentStatus = 'paid';
    else if (totalPaid > 0) paymentStatus = 'partial';

    await this.prisma.purchase_orders.update({
      where: { id: purchaseOrderId },
      data: { payment_status: paymentStatus as any },
    });

    // Audit log
    try {
      await this.auditService.logCustom(
        userId ?? 0,
        'PO_PAYMENT_REGISTERED',
        'purchase_orders',
        {
          amount: dto.amount,
          method: dto.payment_method,
          payment_id: payment.id,
        },
        purchaseOrderId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO payment #${purchaseOrderId}: ${error.message}`,
      );
    }

    // Emit event for accounting
    try {
      this.eventEmitter.emit('purchase_order.payment', {
        purchase_order_id: purchaseOrderId,
        organization_id: po.organization_id,
        amount: Number(dto.amount),
        payment_method: dto.payment_method,
        user_id: userId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit purchase_order.payment for PO #${purchaseOrderId}: ${error.message}`,
      );
    }

    return payment;
  }

  async getPayments(purchaseOrderId: number) {
    return this.prisma.purchase_order_payments.findMany({
      where: { purchase_order_id: purchaseOrderId },
      include: {
        created_by: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getCostPreview(dto: CostPreviewDto) {
    const settings = await this.settingsService.getSettings();
    const costingMethod = settings.inventory?.costing_method || 'cpp';

    const items: Array<{
      product_id: number;
      product_variant_id: number | null;
      product_name: string;
      variant_name?: string;
      current_stock: number;
      current_cost_per_unit: number;
      global_stock: number;
      global_cost_per_unit: number;
      new_stock: number;
      new_cost_per_unit: number;
      incoming_quantity: number;
      incoming_cost: number;
      is_reactivation: boolean;
    }> = [];

    for (const item of dto.items) {
      const stockLevel = await this.prisma.stock_levels.findFirst({
        where: {
          product_id: item.product_id,
          product_variant_id: item.product_variant_id || null,
          location_id: dto.location_id,
        },
      });

      const currentStock = Number(stockLevel?.quantity_on_hand ?? 0);
      const currentCost = Number(stockLevel?.cost_per_unit ?? 0);

      // Global stock across all locations
      const allStockLevels = await this.prisma.stock_levels.findMany({
        where: {
          product_id: item.product_id,
          product_variant_id: item.product_variant_id || null,
          quantity_on_hand: { gt: 0 },
        },
      });
      const globalStock = allStockLevels.reduce(
        (sum, sl) => sum + (sl.quantity_on_hand ?? 0),
        0,
      );
      const globalValue = allStockLevels.reduce(
        (sum, sl) =>
          sum + (sl.quantity_on_hand ?? 0) * Number(sl.cost_per_unit ?? 0),
        0,
      );
      const globalCostPerUnit = globalStock > 0 ? globalValue / globalStock : 0;

      const newStock = globalStock + item.quantity;
      const isReactivation = globalStock <= 0;

      let newCostPerUnit: number;
      if (isReactivation || costingMethod === 'fifo') {
        // Stock at zero: previous CPP is orphaned, new cost = purchase price directly
        newCostPerUnit = item.unit_cost;
      } else {
        // CPP (weighted average) using global stock across all locations
        newCostPerUnit =
          (globalStock * globalCostPerUnit + item.quantity * item.unit_cost) /
          newStock;
      }

      // Round to 2 decimals for display
      newCostPerUnit = Math.round(newCostPerUnit * 100) / 100;

      // Fetch product name
      const product = await this.prisma.products.findUnique({
        where: { id: item.product_id },
        select: { name: true },
      });

      let variantName: string | undefined;
      if (item.product_variant_id) {
        const variant = await this.prisma.product_variants.findUnique({
          where: { id: item.product_variant_id },
          select: { name: true },
        });
        variantName = variant?.name || undefined;
      }

      items.push({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id || null,
        product_name: product?.name || 'Producto desconocido',
        variant_name: variantName,
        current_stock: currentStock,
        current_cost_per_unit: isReactivation
          ? 0
          : Math.round(currentCost * 100) / 100,
        global_stock: globalStock,
        global_cost_per_unit: Math.round(globalCostPerUnit * 100) / 100,
        new_stock: newStock,
        new_cost_per_unit: newCostPerUnit,
        incoming_quantity: item.quantity,
        incoming_cost: item.unit_cost,
        is_reactivation: isReactivation,
      });
    }

    return { costing_method: costingMethod, items };
  }

  remove(id: number) {
    return this.prisma.purchase_orders.delete({
      where: { id },
    });
  }
}
