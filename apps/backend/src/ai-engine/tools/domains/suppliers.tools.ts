import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  supplier_category_enum,
  supplier_state_enum,
} from '@prisma/client';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { SuppliersService } from '../../../domains/store/inventory/suppliers/suppliers.service';
import { SupplierQueryDto } from '../../../domains/store/inventory/suppliers/dto/supplier-query.dto';
import { CreateInventorySupplierDto } from '../../../domains/store/inventory/suppliers/dto/create-supplier.dto';
import { UpdateSupplierDto } from '../../../domains/store/inventory/suppliers/dto/update-supplier.dto';

export interface SupplierToolDeps {
  suppliersService: SuppliersService;
}

const SUPPLIER_STATES = Object.values(supplier_state_enum);

// `archived` no viaja en create/update/set_state: archivar va por DELETE
// (`remove`), que bloquea con documentos abiertos.
const MUTABLE_SUPPLIER_STATES: supplier_state_enum[] =
  SUPPLIER_STATES.filter((state) => state !== supplier_state_enum.archived);
const SUPPLIER_CATEGORIES = Object.values(supplier_category_enum);

function toolError(
  message: string,
  nextStep?: string,
  code?: string,
): string {
  return JSON.stringify({
    error: message,
    ...(nextStep ? { next_step: nextStep } : {}),
    ...(code ? { code } : {}),
  });
}

function previewError(
  target: string,
  message: string,
  domain = 'suppliers',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

function describeError(error: unknown): { code?: string; message: string } {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    const message =
      typeof response === 'string'
        ? response
        : (response?.message ?? error.message);
    return { code: error.errorCode, message };
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as
      | { message?: unknown; error_code?: string }
      | string;
    if (typeof response === 'string') return { message: response };
    const raw = response?.message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
    return {
      ...(response?.error_code && { code: response.error_code }),
      message,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Campos comerciales que `manage_suppliers` acepta en create/update. */
const SUPPLIER_SCALAR_FIELDS = [
  'name',
  'code',
  'contact_person',
  'email',
  'phone',
  'mobile',
  'website',
  'tax_id',
  'tax_regime',
  'person_type',
  'payment_terms',
  'currency',
  'lead_time_days',
  'notes',
  'state',
  'supplier_category',
] as const;

function pickSupplierScalars(
  args: Record<string, any>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of SUPPLIER_SCALAR_FIELDS) {
    const value = args[field];
    if (value === undefined || value === null) continue;
    picked[field] =
      field === 'lead_time_days' ? Number(value) : String(value);
  }
  return picked;
}

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

    // ─── O-39: get_supplier (READ) ─────────────────────────────────────
    // Detalle de un proveedor: identidad, contacto, fiscalidad, direcciones y
    // catálogo de productos que surte. Es la cadena obligatoria de
    // `manage_suppliers`: el agente lee el detalle antes de proponer cambios.
    {
      name: 'get_supplier',
      version: '1',
      domain: 'suppliers',
      readOnly: true,
      description:
        'Detalle completo de un proveedor: identidad, contacto, datos fiscales, direcciones y productos que surte. Cadena obligatoria antes de manage_suppliers. Resuelve el ID con find_supplier si solo tienes el nombre.',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: {
            type: 'number',
            description:
              'ID del proveedor. Resuélvelo con find_supplier si solo tienes el nombre.',
          },
          include_products: {
            type: 'boolean',
            description:
              'Incluye el catálogo de productos que surte (por defecto true).',
          },
        },
        required: ['supplier_id'],
      },
      requiredPermissions: ['store:inventory:suppliers:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: el detalle de proveedor está acotado por tenant.',
          });
        }

        const supplierId = toPositiveInt(args.supplier_id);
        if (!supplierId) {
          return JSON.stringify({ error: 'supplier_id inválido.' });
        }

        try {
          const supplier = await suppliersService.findOne(supplierId);
          const withProducts = args.include_products !== false;
          const products = withProducts
            ? (supplier.supplier_products ?? []).map((sp: any) => ({
                product_id: sp.product_id,
                name: sp.products?.name ?? null,
                sku: sp.products?.sku ?? null,
              }))
            : undefined;

          return JSON.stringify({
            proveedor: {
              ...compactSupplier(supplier),
              mobile: (supplier as any).mobile ?? null,
              website: (supplier as any).website ?? null,
              tax_regime: (supplier as any).tax_regime ?? null,
              person_type: (supplier as any).person_type ?? null,
              payment_terms: (supplier as any).payment_terms ?? null,
              currency: (supplier as any).currency ?? null,
              lead_time_days: (supplier as any).lead_time_days ?? null,
              notes: (supplier as any).notes ?? null,
              supplier_category:
                (supplier as any).supplier_category ?? null,
              direcciones: (supplier as any).addresses ?? [],
              ...(products ? { productos: products } : {}),
            },
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo leer el proveedor ${supplierId}: ${info.message}`,
            next_step:
              'Verifica el supplier_id con find_supplier: el proveedor puede no existir en esta tienda u organización.',
          });
        }
      },
    },

    // ─── O-40: manage_suppliers (WRITE) ────────────────────────────────
    // Crea, edita, cambia de estado o archiva proveedores. Archivar
    // (`delete`) conserva la fila y su historia contable; el servicio lo
    // bloquea si hay OCs abiertas, CxP con saldo o remisiones abiertas.
    // Cadena: find_supplier → get_supplier → write.
    {
      name: 'manage_suppliers',
      version: '1',
      domain: 'suppliers',
      description:
        'Crea, edita, cambia de estado (active/inactive) o archiva proveedores. Archivar conserva la historia contable pero exige cero documentos abiertos (OCs, CxP, remisiones). Lee primero con get_supplier. Acciones: create (name + code), update, set_state, delete (archiva).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'set_state', 'delete'],
            description: 'Acción sobre el proveedor.',
          },
          supplier_id: {
            type: 'number',
            description:
              'ID del proveedor (requerido para update, set_state y delete; resuélvelo con find_supplier).',
          },
          state: {
            type: 'string',
            enum: MUTABLE_SUPPLIER_STATES,
            description:
              'Estado destino (requerido para set_state; archived va por delete).',
          },
          name: { type: 'string', description: 'Nombre (create/update).' },
          code: { type: 'string', description: 'Código (create/update).' },
          contact_person: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          mobile: { type: 'string' },
          website: { type: 'string' },
          tax_id: { type: 'string' },
          tax_regime: { type: 'string' },
          person_type: { type: 'string' },
          payment_terms: { type: 'string' },
          currency: { type: 'string' },
          lead_time_days: { type: 'number' },
          notes: { type: 'string' },
          supplier_category: {
            type: 'string',
            enum: SUPPLIER_CATEGORIES,
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:inventory:suppliers:create',
        'store:inventory:suppliers:update',
        'store:inventory:suppliers:delete',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const action = String(args.action ?? '');
        if (!['create', 'update', 'set_state', 'delete'].includes(action)) {
          return previewError(
            'Proveedor',
            `action "${action}" inválida. Usa create, update, set_state o delete.`,
          );
        }

        if (!context.store_id && !context.organization_id) {
          return previewError(
            'Proveedor',
            'Sin tienda ni organización en contexto.',
          );
        }

        try {
          if (action === 'create') {
            const checked = toValidatedDto(
              CreateInventorySupplierDto,
              pickSupplierScalars(args),
            );
            if (!checked.ok) {
              return previewError('Nuevo proveedor', checked.message);
            }
            return {
              status: 'ok',
              target: `Nuevo proveedor — ${checked.dto.name} (${checked.dto.code})`,
              changes: [
                {
                  field: 'name',
                  label: 'Nombre',
                  from: null,
                  to: checked.dto.name,
                },
                {
                  field: 'code',
                  label: 'Código',
                  from: null,
                  to: checked.dto.code,
                },
                ...(checked.dto.email
                  ? [
                      {
                        field: 'email',
                        label: 'Correo',
                        from: null,
                        to: checked.dto.email,
                      },
                    ]
                  : []),
              ],
              domain: 'suppliers',
            };
          }

          const supplierId = toPositiveInt(args.supplier_id);
          if (!supplierId) {
            return previewError(
              'Proveedor',
              `${action} exige supplier_id (resuélvelo con find_supplier).`,
            );
          }
          let supplier: any;
          try {
            supplier = await suppliersService.findOne(supplierId);
          } catch {
            return previewError(
              `Proveedor #${supplierId}`,
              `El proveedor ${supplierId} no existe en esta tienda u organización.`,
            );
          }
          const label = `${supplier.name} (${supplier.code ?? `#${supplier.id}`})`;

          if (action === 'set_state') {
            const state = String(args.state ?? '');
            if (
              !MUTABLE_SUPPLIER_STATES.includes(state as supplier_state_enum)
            ) {
              return previewError(
                label,
                `state "${state}" inválido. Usa ${MUTABLE_SUPPLIER_STATES.join(' o ')} (archived va por delete).`,
              );
            }
            if (supplier.state === state) {
              return previewError(
                label,
                `El proveedor ya está en estado «${state}»: nada que cambiar.`,
              );
            }
            const unarchiving =
              supplier.state === supplier_state_enum.archived;
            return {
              status: unarchiving ? 'warning' : 'ok',
              target: label,
              changes: [
                {
                  field: 'state',
                  label: 'Estado',
                  from: supplier.state,
                  to: state,
                },
              ],
              ...(unarchiving
                ? {
                    message:
                      'Esto desarchiva al proveedor: vuelve a aparecer en listados y selectores.',
                  }
                : {}),
              domain: 'suppliers',
            };
          }

          if (action === 'delete') {
            if (supplier.state === supplier_state_enum.archived) {
              return previewError(
                label,
                'El proveedor ya está archivado: nada que archivar.',
              );
            }
            // Documentos abiertos que harían rechazar el archivado: se
            // anticipan aquí para no acuñar un token condenado.
            const summary = await suppliersService
              .getSupplierSummary(supplierId)
              .catch(() => null);
            const openPos = Number(summary?.open_pos_count ?? 0);
            const debt = Number(summary?.outstanding_debt ?? 0);
            if (openPos > 0 || debt > 0) {
              return previewError(
                label,
                `Tiene ${openPos} orden(es) abierta(s) y $${debt} de deuda formalizada: cierra o paga esos documentos antes de archivar.`,
              );
            }
            return {
              status: 'warning',
              target: label,
              changes: [
                {
                  field: 'state',
                  label: 'Estado',
                  from: supplier.state,
                  to: 'archived (conserva historia contable)',
                },
              ],
              message:
                'Archivar saca al proveedor de listados y lo desvincula como carrier por defecto, pero conserva sus OCs, CxP y retenciones. Se bloquea si aparecen documentos abiertos.',
              domain: 'suppliers',
            };
          }

          // update (el servicio no distingue archivados: la edición escalar
          // es inocua y desarchivar pasa por set_state).
          const scalars = pickSupplierScalars(args);
          const changedEntries = Object.entries(scalars).filter(
            ([field, value]) =>
              value !== undefined && String(supplier[field] ?? '') !== String(value),
          );
          if (!changedEntries.length) {
            return previewError(
              label,
              'No hay cambios: manda al menos un campo distinto al actual.',
            );
          }
          const checked = toValidatedDto(UpdateSupplierDto, scalars);
          if (!checked.ok) {
            return previewError(label, checked.message);
          }
          return {
            status: 'ok',
            target: label,
            changes: changedEntries.map(([field, value]) => ({
              field,
              label: field,
              from: supplier[field] ?? null,
              to: value,
            })),
            domain: 'suppliers',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Proveedor', info.message);
        }
      },
      handler: async (args) => {
        const action = String(args.action ?? '');

        try {
          if (action === 'create') {
            const checked = toValidatedDto(
              CreateInventorySupplierDto,
              pickSupplierScalars(args),
            );
            if (!checked.ok) return toolError(checked.message);
            const created = await suppliersService.create(checked.dto);
            return JSON.stringify({
              resumen: `Proveedor ${created.name} (${created.code}) creado`,
              supplier_id: created.id,
              siguiente_paso:
                'Créale su primera OC con manage_purchase_orders.',
            });
          }

          const supplierId = toPositiveInt(args.supplier_id);
          if (!supplierId) {
            return toolError(`${action} exige supplier_id.`);
          }

          if (action === 'set_state') {
            const state = String(args.state ?? '');
            if (
              !MUTABLE_SUPPLIER_STATES.includes(state as supplier_state_enum)
            ) {
              return toolError(
                `state "${state}" inválido. Usa ${MUTABLE_SUPPLIER_STATES.join(' o ')}.`,
              );
            }
            // Re-verificación: sigue existiendo y sigue en un estado mutable.
            let fresh: any;
            try {
              fresh = await suppliersService.findOne(supplierId);
            } catch {
              return toolError(
                `El proveedor ${supplierId} ya no existe en esta tienda.`,
              );
            }
            if (fresh.state === state) {
              return toolError(
                `El proveedor ${fresh.name} ya está en «${state}»: nada que cambiar.`,
              );
            }
            const updated = await suppliersService.setState(
              supplierId,
              state as supplier_state_enum,
            );
            return JSON.stringify({
              resumen: `Proveedor ${updated.name} pasó a «${updated.state}»`,
              supplier_id: supplierId,
              state: updated.state,
            });
          }

          if (action === 'delete') {
            let fresh: any;
            try {
              fresh = await suppliersService.findOne(supplierId);
            } catch {
              return toolError(
                `El proveedor ${supplierId} ya no existe en esta tienda.`,
              );
            }
            if (fresh.state === supplier_state_enum.archived) {
              return toolError(
                `El proveedor ${fresh.name} ya está archivado: nada que archivar.`,
              );
            }
            try {
              const archived = await suppliersService.remove(supplierId);
              return JSON.stringify({
                resumen: `Proveedor ${archived.name} archivado (historia contable conservada)`,
                supplier_id: supplierId,
                state: archived.state,
              });
            } catch (error) {
              const info = describeError(error);
              if (info.code === 'SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS') {
                return toolError(
                  `No se puede archivar: aparecieron documentos abiertos después del preview. ${info.message}`,
                  'Cierra las OCs, paga la CxP o cierra las remisiones y reintenta.',
                  info.code,
                );
              }
              throw error;
            }
          }

          if (action === 'update') {
            try {
              await suppliersService.findOne(supplierId);
            } catch {
              return toolError(
                `El proveedor ${supplierId} ya no existe en esta tienda.`,
              );
            }
            const checked = toValidatedDto(
              UpdateSupplierDto,
              pickSupplierScalars(args),
            );
            if (!checked.ok) return toolError(checked.message);
            const updated = await suppliersService.update(
              supplierId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `Proveedor ${updated.name} actualizado`,
              supplier_id: supplierId,
            });
          }

          return toolError(
            `action "${action}" inválida. Usa create, update, set_state o delete.`,
          );
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Lee el proveedor con get_supplier para ver su estado actual.',
            info.code,
          );
        }
      },
    },
  ];
}
