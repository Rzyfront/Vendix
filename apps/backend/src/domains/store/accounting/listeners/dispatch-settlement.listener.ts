import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AccountsPayableService } from '../../accounts-payable/accounts-payable.service';
import { AutoEntryService } from '../auto-entries/auto-entry.service';

/**
 * Plan Despacho Economía — FASE 5 paso 17.
 *
 * Listener de `dispatch_route.settlement`: cuando el ejecutor externo cierra
 * una ruta con costo > 0, este listener:
 *   1. Crea la CxP contra el transportador (reutiliza `accounts_payable`).
 *   2. Paga de inmediato la CxP (pago inmediato, decisión #3 — vía
 *      `registerPayment`).
 *   3. Dispara el devengo contable del costo (`onDispatchRouteSettlement`
 *      en AutoEntryService) — DR 523550 / CR 2205.
 *
 * El pago de la CxP dispara `ap.payment.registered`, que ya genera el asiento
 * DR 2205 / CR banco (existente). No creamos pipelines paralelos.
 *
 * Idempotencia: si ya existe una CxP `source_type='dispatch_route'` con
 * `source_id=route_id`, no se crea otra.
 */
@Injectable()
export class DispatchSettlementListener implements OnModuleInit {
  private readonly logger = new Logger(DispatchSettlementListener.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly apService: AccountsPayableService,
    private readonly autoEntryService: AutoEntryService,
  ) {}

  onModuleInit(): void {
    this.logger.log('Dispatch settlement listener ready');
  }

  @OnEvent('dispatch_route.settlement')
  async handle(data: {
    route_id: number;
    route_number?: string;
    store_id: number;
    organization_id: number;
    transporter_supplier_id: number | null;
    gross_cost: number;
    deliveries_count?: number;
    settlement_type: 'per_delivery' | 'per_route';
    user_id?: number;
  }) {
    try {
      const ctx = RequestContextService.getContext() ?? {} as any;
      // Si el emisor ya pobló el contexto (caso típico), lo usamos para
      // asegurar multi-tenant scope.
      const ctx_org = (ctx as any).organization_id ?? data.organization_id;
      const ctx_store = (ctx as any).store_id ?? data.store_id;
      if (!ctx_org || !ctx_store) {
        this.logger.warn(
          `dispatch_route.settlement: contexto incompleto, saltando CxP. route=${data.route_id}`,
        );
        return;
      }

      // Sin transportador no podemos crear la CxP — sólo emitimos el devengo.
      // (El caso "vehiculo interno con costo" no genera CxP, sólo gasto.)
      if (!data.transporter_supplier_id) {
        await this.autoEntryService.onDispatchRouteSettlement({
          route_id: data.route_id,
          route_number: data.route_number,
          organization_id: ctx_org,
          store_id: ctx_store,
          transporter_supplier_id: null,
          gross_cost: data.gross_cost,
          net_amount: data.gross_cost,
          settlement_type: data.settlement_type,
          user_id: data.user_id,
        });
        return;
      }

      // Idempotencia: ¿ya existe CxP para esta ruta?
      // Solo se usa `id` (el bloque de abajo loguea y retorna); un select de
      // más campos disparaba `Unknown field paid` (el campo real es
      // `paid_amount`) y el catch lo tragaba, dejando la CxP sin crear.
      const existing_ap = await this.prisma.accounts_payable.findFirst({
        where: {
          source_type: 'dispatch_route',
          source_id: data.route_id,
        },
        select: { id: true },
      });
      if (existing_ap) {
        this.logger.log(
          `dispatch_route.settlement: CxP ya existe para route=${data.route_id} (ap=${existing_ap.id}). Saltando creación.`,
        );
        return;
      }

      // 1. Resolver el supplier (con su snapshot) y la retención de transporte.
      // Scope tenant-safe tolerante al operating scope: en orgs con scope
      // ORGANIZATION los suppliers viven con store_id=null (ver
      // suppliers.service getSupplierScopeWhere); un filtro fijo `store_id:
      // ctx_store` nunca los encuentra. Guardamos por organization_id y
      // aceptamos tanto el supplier de esta tienda como el org-level.
      const supplier = await this.prisma.suppliers.findFirst({
        where: {
          id: data.transporter_supplier_id,
          organization_id: ctx_org,
          OR: [{ store_id: ctx_store }, { store_id: null }],
        },
      });
      if (!supplier) {
        this.logger.warn(
          `dispatch_route.settlement: supplier ${data.transporter_supplier_id} no encontrado en store=${ctx_store}`,
        );
        return;
      }

      // 2. Crear la CxP (neto = gross por ahora — sin retención practicada
      //    en v1; la retención se cubre vía `withholding-flow` cuando esté
      //    cableada a la CxP del transportador en iteraciones futuras).
      const ap = await this.apService.createFromEvent({
        source_type: 'dispatch_route',
        source_id: data.route_id,
        organization_id: ctx_org,
        store_id: ctx_store,
        supplier_id: supplier.id,
        original_amount: data.gross_cost,
        notes: `Liquidación transporte - Ruta ${data.route_number ?? data.route_id}`,
      });

      // 3. Pago inmediato (decisión #3).
      await this.apService.registerPayment(ap.id, {
        amount: data.gross_cost,
        payment_method: 'cash',
        notes: `Pago inmediato al cerrar ruta ${data.route_number ?? data.route_id}`,
      }, data.user_id ?? ctx.user_id ?? 0);

      // 4. Devengo contable (DR 523550 / CR 2205).
      await this.autoEntryService.onDispatchRouteSettlement({
        route_id: data.route_id,
        route_number: data.route_number,
        organization_id: ctx_org,
        store_id: ctx_store,
        transporter_supplier_id: supplier.id,
        gross_cost: data.gross_cost,
        net_amount: data.gross_cost,
        settlement_type: data.settlement_type,
        user_id: data.user_id,
        supplier: {
          id: supplier.id,
          name: supplier.name,
          tax_id: supplier.tax_id ?? undefined,
        },
      });

      this.logger.log(
        `dispatch_route.settlement procesado: route=${data.route_id} ap=${ap.id} gross=${data.gross_cost}`,
      );
    } catch (err: any) {
      this.logger.error(
        `dispatch_route.settlement FAILED para route=${data.route_id}: ${err?.message}`,
        err?.stack,
      );
      // No relanzamos: la ruta ya está cerrada y el evento ya se emitió.
    }
  }
}