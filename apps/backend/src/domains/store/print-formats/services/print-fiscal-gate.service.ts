import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { FiscalProductionReadinessService } from '../../../store/invoicing/providers/fiscal-production-readiness.service';

/**
 * Por qué el predicado "ticket vs FE" deja de ser una comparación póstuma.
 *
 * Hasta hoy, `PosTicketService.printTicket()` elegía `pos_electronic_invoice`
 * si y solo si la orden YA tenía una factura emitida (`electronicInvoice?.id`).
 * Eso es una conmutación POST-carga: imprime el documento que ya existe, pero
 * nunca decide "esta venta DEBE salir como FE" — la venta sin factura previa
 * sale como ticket común aunque la tienda tenga DIAN producción activa.
 *
 * Este servicio invierte la decisión al momento de imprimir: pregunta primero
 * "¿la tienda PUEDE y DEBE emitir FE en producción?", y solo si la respuesta
 * es NO imprime `pos_sale_ticket`. Es la única ruta que el motor nuevo
 * debería consultar; el switch inline en el servicio frontend queda muerto y
 * se elimina en el Paso 4.
 *
 * Tres razones justifican ordenarlo como precedencia, no como overrides:
 *  1. Una orden ya con factura SIEMPRE se reimprime como FE — la existencia
 *     del documento fiscal es el hecho dominante.
 *  2. Si la tienda puede emitir FE en producción, la venta SIN factura previa
 *     requiere emisión arriba del print (`requiresInvoiceEmission: true`).
 *  3. Solo lo que no cae en 1 ni 2 termina como ticket común.
 *
 * `resolveOwnSoftwareConfig({ requireProduction: true })` ya valida TODO lo
 * que la DIAN exige para emitir (cert vigente, resolución activa, ClTec propia
 * del rango, etc.); aquí se reutiliza y se interpreta su excepción como
 * "esta tienda todavía no puede emitir FE en producción".
 */
export interface PrintTarget {
  formatType: print_format_type_enum;
  documentId: number;
  /**
   * Por qué se eligió este destino. Útil para logs del gateway, para la UI de
   * preview del Hub y para distinguir en auditoría entre "el documento ya era
   * una FE" y "la tienda tiene FE activa".
   */
  reason:
    | 'electronic_invoice_already_issued'
    | 'store_has_fe_production'
    | 'no_fiscal_activation';
  /**
   * TRUE cuando el caller debe emitir la FE antes de llamar al renderer.
   * El renderer actual busca la factura por `documentId` y lanza
   * PRINT_DOCUMENT_NOT_FOUND_001 si no existe — esta señal le indica al
   * orquestador del flujo que primero debe gatillar la emisión.
   *
   * NO se implementa la emisión en este sprint (es carril del del
   * `invoicing/*`); el gate solo expone la decisión.
   */
  requiresInvoiceEmission: boolean;
}

@Injectable()
export class PrintFiscalGateService {
  private readonly logger = new Logger(PrintFiscalGateService.name);

  constructor(
    private readonly storePrisma: StorePrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly readiness: FiscalProductionReadinessService,
  ) {}

  /**
   * Resuelve el destino de impresión para un documento POS.
   *
   * Precedencia:
   *  1. `invoiceId` provisto por el caller → FE con ese id (reimpresión).
   *  2. La orden ya tiene factura emitida → FE con el id de esa factura.
   *  3. La tienda tiene FE de producción activa para su entidad contable
     → FE con `orderId` y `requiresInvoiceEmission: true`.
   *  4. Ninguna de las anteriores → ticket común con `orderId`.
   */
  async resolvePosPrintTarget(params: {
    storeId: number;
    organizationId: number;
    orderId?: number;
    invoiceId?: number;
  }): Promise<PrintTarget> {
    // 1. Caller ya pasó el id de factura — siempre gana.
    if (params.invoiceId) {
      return {
        formatType: 'pos_electronic_invoice' as print_format_type_enum,
        documentId: params.invoiceId,
        reason: 'electronic_invoice_already_issued',
        requiresInvoiceEmission: false,
      };
    }

    // 2. La orden ya produjo FE — usar esa fila.
    if (params.orderId) {
      const order = await this.storePrisma.orders.findFirst({
        where: { id: params.orderId, store_id: params.storeId },
        select: {
          id: true,
          invoices: {
            where: { invoice_number: { not: null } },
            select: { id: true, invoice_number: true },
            take: 1,
            orderBy: { created_at: 'desc' },
          },
        },
      });

      const existing = order?.invoices?.[0];
      if (existing?.invoice_number) {
        return {
          formatType: 'pos_electronic_invoice' as print_format_type_enum,
          documentId: existing.id,
          reason: 'electronic_invoice_already_issued',
          requiresInvoiceEmission: false,
        };
      }
    }

    // 3. ¿La tienda PUEDE emitir FE en producción? Si sí, marcamos que el
    //    orquestador debe emitirla antes de pedir el render.
    if (params.orderId) {
      const canEmit = await this.storeCanEmitFeInProduction(
        params.storeId,
        params.organizationId,
      );
      if (canEmit) {
        return {
          formatType: 'pos_electronic_invoice' as print_format_type_enum,
          documentId: params.orderId,
          reason: 'store_has_fe_production',
          requiresInvoiceEmission: true,
        };
      }
    }

    // 4. Sin activación fiscal → ticket común.
    if (!params.orderId) {
      // Sin orderId ni invoiceId el gate no tiene sobre qué decidir.
      // Lanzar aquí preserva el contrato: cada llamada al gate produce un
      // destino concreto; nunca un "no sé".
      throw new Error(
        'PrintFiscalGate.resolvePosPrintTarget: se requiere orderId o invoiceId',
      );
    }
    return {
      formatType: 'pos_sale_ticket' as print_format_type_enum,
      documentId: params.orderId,
      reason: 'no_fiscal_activation',
      requiresInvoiceEmission: false,
    };
  }

  /**
   * ¿La tienda tiene configuración DIAN propia habilitada en producción para
   * `invoicing` sobre SU entidad contable?
   *
   * Estrategia:
   *  - Buscar TODAS las `dian_configurations` candidatas del tenant: tipo
   *    `invoicing`, ambiente `production`, habilitación `enabled`, y que
   *    correspondan a esta tienda (store_id = X) o al consolidado de la org
   *    (store_id IS NULL — `fiscal_scope = ORGANIZATION`).
   *  - Para cada una, delegar a `resolveOwnSoftwareConfig({ requireProduction:
   *    true })`: ese método ejecuta la batería completa de checks de la DIAN
   *    (cert vigente, NIT del cert, resolución no agotada, ClTec propia, etc.)
   *    y lanza si algo no cumple. La primera que pase es la que cuenta.
   *  - Si ninguna pasa, la tienda NO puede emitir FE en producción ahora.
   *
   * Sin re-implementar la batería: una decisión de impresión que no pasara
   * por la misma lista de chequeos que el gate de emisión divergería en
   * cuanto la DIAN agregue un nuevo requisito, y la divergencia se descubriría
   * como "el ticket salió aunque la tienda no puede facturar".
   */
  private async storeCanEmitFeInProduction(
    storeId: number,
    organizationId: number,
  ): Promise<boolean> {
    const candidates = await this.orgPrisma
      .withoutScope()
      .dian_configurations.findMany({
        where: {
          organization_id: organizationId,
          configuration_type: 'invoicing',
          environment: 'production',
          enablement_status: 'enabled',
          OR: [{ store_id: storeId }, { store_id: null }],
        },
        select: {
          id: true,
          accounting_entity_id: true,
          store_id: true,
        },
        orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
      });

    if (!candidates.length) {
      return false;
    }

    for (const cfg of candidates) {
      try {
        await this.readiness.resolveOwnSoftwareConfig({
          organization_id: organizationId,
          store_id: storeId,
          accounting_entity_id: cfg.accounting_entity_id,
          configuration_type: 'invoicing',
          document_type: 'sales_invoice',
          requireProduction: true,
        });
        return true;
      } catch (err) {
        // No listo todavía (cert vencido, resolución agotada, ClTec
        // contaminada, etc.). Probamos con la siguiente configuración.
        this.logger.debug(
          `PrintFiscalGate: dian_configurations ${cfg.id} no lista para emitir FE (${(err as Error)?.message ?? err}); probando siguiente.`,
        );
      }
    }

    return false;
  }
}