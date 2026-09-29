import { supplier_state_enum } from '@prisma/client';
import { RegisteredTool } from '../interfaces/tool.interface';
import { SuppliersService } from '../../../domains/store/inventory/suppliers/suppliers.service';
import { SupplierQueryDto } from '../../../domains/store/inventory/suppliers/dto/supplier-query.dto';

export interface SupplierToolDeps {
  suppliersService: SuppliersService;
}

const SUPPLIER_STATES = Object.values(supplier_state_enum);

function compactSupplier(s: any) {
  return {
    supplier_id: s.id,
    name: s.name,
    code: s.code,
    state: s.state,
    contact_person: s.contact_person ?? null,
    email: s.email ?? null,
    phone: s.phone ?? null,
    tax_id: s.tax_id ?? null,
    products_count: Array.isArray(s.supplier_products)
      ? s.supplier_products.length
      : undefined,
  };
}

/**
 * O-38 / O-41 — Proveedores read-first (P0 operativo, paso 8 del lote O).
 *
 * Subdominio con 0 cobertura: se expone búsqueda, resumen y cartera ANTES de
 * cualquier mutación P1 (`manage_suppliers` O-40). Los dos reads son la cadena
 * de validación obligatoria de esas mutaciones: el agente resuelve el
 * `supplier_id` con `find_supplier` y audita OCs + cartera con
 * `get_supplier_summary` antes de proponer cambios.
 */
export function createSupplierTools(deps: SupplierToolDeps): RegisteredTool[] {
  const { suppliersService } = deps;

  return [
    // ─── O-38: find_supplier (READ) ────────────────────────────────────
    {
      name: 'find_supplier',
      version: '1',
      domain: 'suppliers',
      readOnly: true,
      description:
        'Localiza proveedores por nombre, código, contacto, correo, teléfono o NIT. Es el PRIMER paso de cualquier flujo sobre un proveedor concreto: devuelve el supplier_id que get_supplier_summary necesita. Si vuelve más de un candidato, muéstrale las opciones al usuario en vez de adivinar.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Nombre, fragmento del nombre, código, contacto, correo, teléfono o NIT del proveedor.',
          },
          state: {
            type: 'string',
            enum: SUPPLIER_STATES,
            description:
              'Restringe por estado. Omitirlo excluye los archivados; pasa "archived" para consultarlos explícitamente.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de candidatos. Por defecto 5, máximo 20.',
          },
        },
        required: ['query'],
      },
      requiredPermissions: ['store:inventory:suppliers:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: la búsqueda de proveedores está acotada por tenant.',
          });
        }

        const search = String(args.query ?? '').trim();
        if (!search) {
          return JSON.stringify({
            error:
              'query vacío. Pásale el nombre, el código o el NIT del proveedor.',
          });
        }

        if (
          args.state !== undefined &&
          !SUPPLIER_STATES.includes(args.state)
        ) {
          return JSON.stringify({
            error: `state "${args.state}" inválido. Valores válidos: ${SUPPLIER_STATES.join(', ')}.`,
          });
        }

        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);

        try {
          const query: SupplierQueryDto = {
            page: 1,
            limit,
            search,
            ...(args.state ? { state: args.state } : {}),
          };
          const result = await suppliersService.findAll(query);
          const candidatos = (result.data ?? []).map(compactSupplier);

          if (!candidatos.length) {
            return JSON.stringify({
              busqueda: search,
              encontrados: 0,
              candidatos: [],
              nota: 'Ningún proveedor coincide. La búsqueda cubre nombre, código, contacto, correo, teléfono y NIT. Si el proveedor está archivado, repite con state "archived".',
            });
          }

          return JSON.stringify({
            busqueda: search,
            encontrados: candidatos.length,
            total_coincidencias: result.meta?.total ?? candidatos.length,
            hay_mas:
              (result.meta?.total ?? candidatos.length) > candidatos.length,
            resolucion:
              candidatos.length === 1
                ? 'Coincidencia única: puedes usar su supplier_id directamente.'
                : 'Varias coincidencias: confirma con el usuario cuál antes de actuar.',
            candidatos,
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo buscar el proveedor: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },

    // ─── O-41: get_supplier_summary (READ) ───────────────────────────────
    {
      name: 'get_supplier_summary',
      version: '1',
      domain: 'suppliers',
      readOnly: true,
      description:
        'Resumen 360° de un proveedor: identidad, compras reconocidas (sin IVA, igual que el Resumen de Compras), deuda formalizada y vencida, compromiso sin CxP, YTD, última orden, más su historial de órdenes de compra y su cartera abierta. Úsalo antes de crear una OC o de negociar con el proveedor.',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: {
            type: 'number',
            description:
              'ID del proveedor. Resuélvelo con find_supplier si solo tienes el nombre.',
          },
          include_orders: {
            type: 'boolean',
            description:
              'Incluye el historial paginado de OCs del proveedor (por defecto true).',
          },
          include_payables: {
            type: 'boolean',
            description:
              'Incluye la cartera abierta del proveedor (por defecto true).',
          },
        },
        required: ['supplier_id'],
      },
      requiredPermissions: ['store:inventory:suppliers:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: el resumen de proveedor está acotado por tenant.',
          });
        }

        const supplierId = Number(args.supplier_id);
        if (!Number.isInteger(supplierId) || supplierId <= 0) {
          return JSON.stringify({ error: 'supplier_id inválido.' });
        }

        try {
          const withOrders = args.include_orders !== false;
          const withPayables = args.include_payables !== false;

          const [summary, orders, payables] = await Promise.all([
            suppliersService.getSupplierSummary(supplierId),
            withOrders
              ? suppliersService.getSupplierPurchaseOrders(supplierId, 1, 10)
              : Promise.resolve(null),
            withPayables
              ? suppliersService.getSupplierPayables(supplierId, 1, 20)
              : Promise.resolve(null),
          ]);

          return JSON.stringify({
            resumen: {
              supplier_id: summary.supplier_id,
              proveedor: summary.supplier_name,
              identidad: summary.supplier
                ? compactSupplier(summary.supplier)
                : undefined,
              total_ordenes: summary.total_orders,
              // SUM(subtotal_amount): SIN IVA, igual que el Resumen de Compras.
              total_comprado_sin_iva: summary.total_purchased,
              ticket_promedio: summary.average_order_value,
              deuda_formalizada: summary.outstanding_debt,
              deuda_vencida: summary.overdue_debt,
              max_dias_vencido: summary.max_days_overdue,
              // Aprobadas/parciales sin CxP: compromiso, no deuda.
              compromiso_sin_cxp: summary.committed_amount,
              ordenes_abiertas: summary.open_pos_count,
              comprado_ytd_sin_iva: summary.ytd_purchases,
              ultima_orden: summary.last_order_date,
              alcance: summary.scope,
            },
            ...(orders ? { ordenes_compra: orders } : {}),
            ...(payables ? { cartera_abierta: payables } : {}),
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo obtener el resumen del proveedor ${supplierId}: ${error?.message ?? 'error desconocido'}`,
            next_step:
              'Verifica el supplier_id con find_supplier: el proveedor puede no existir en esta tienda u organización.',
          });
        }
      },
    },
  ];
}
