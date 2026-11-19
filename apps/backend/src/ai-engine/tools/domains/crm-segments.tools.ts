import { AuditService } from '../../../common/audit/audit.service';
import { CustomersService } from '../../../domains/store/customers/customers.service';
import { CrmSegmentMembersService } from '../../../domains/store/customers/crm/segments/crm-segment-members.service';
import { CrmSegmentQueryService } from '../../../domains/store/customers/crm/segments/crm-segment-query.service';
import { CrmSegmentsService } from '../../../domains/store/customers/crm/segments/crm-segments.service';
import {
  CreateCrmSegmentDto,
  UpdateCrmSegmentDto,
} from '../../../domains/store/customers/crm/segments/dto/crm-segments.dto';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import {
  CRM_BULK_CUSTOMER_CAP,
  CRM_PERMISSIONS,
  CRM_TOOL_DOMAIN,
  auditCrmAgentWrite,
  capPreviewRows,
  cleanString,
  crmPreviewError,
  crmToolError,
  crmToolFailure,
  crmToolSuccess,
  parseIdList,
  requireStoreId,
  resolveCustomerLabels,
  toPositiveInt,
  toValidatedDto,
} from './crm-tools.shared';

/**
 * CRM segments for Vex and Vexi (QUI-1042, S3 + S8). A CRM segment is a saved
 * customer list: rules (dynamic) and/or customers added by hand. It is NOT the
 * RFM analytics of `get_customer_segments`.
 */
export interface CrmSegmentToolDeps {
  crmSegmentsService: CrmSegmentsService;
  segmentQueryService: CrmSegmentQueryService;
  segmentMembersService: CrmSegmentMembersService;
  customersService: CustomersService;
  auditService: AuditService;
}

const SELECTION_SAMPLE = 10;
const MEMBERSHIP_CHUNK = 100;
const DEFAULT_MEMBERS_LIMIT = 25;
const MAX_MEMBERS_LIMIT = 100;

const FILTER_DESCRIPTION =
  'Filtro de clientes: grupo {"op":"and"|"or","rules":[...]} cuyas reglas son hojas {"field","cmp","value"} o grupos anidados (máx. 20 reglas, 3 niveles). ' +
  'field: orders_count (compras terminadas de toda la vida, entero), total_spent (monto gastado, número), last_order_at y created_at (fechas), tag/stage/owner (ids), source, rfm, consent.whatsapp|sms|email, meta.<clave> (campo personalizado). ' +
  'cmp: eq, neq, in (lista), gte, lte, between ([desde,hasta]), exists (true|false), within_days y older_than_days (días enteros, solo fechas). ' +
  'No existe conteo de compras por mes: para "este mes" usa last_order_at con within_days. ' +
  'Ejemplo "más de 3 compras": {"op":"and","rules":[{"field":"orders_count","cmp":"gte","value":4}]}. ' +
  'Ejemplo "sin comprar hace 60 días": {"op":"and","rules":[{"field":"last_order_at","cmp":"older_than_days","value":60}]}.';

type SegmentFilter = Record<string, unknown>;

interface SegmentRow {
  id: number;
  name: string;
  description: string | null;
  filter: unknown;
  is_dynamic: boolean;
  last_count: number | null;
  last_counted_at: Date | null;
}

/** Key-sorted JSON so jsonb key reordering never looks like a change. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isPlainObject(value: unknown): value is SegmentFilter {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function personName(row: {
  first_name?: string;
  last_name?: string;
  id: number;
}) {
  return (
    `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() ||
    `Cliente ${row.id}`
  );
}

function typeLabel(isDynamic: boolean): string {
  return isDynamic ? 'por reglas' : 'manual';
}

export function createCrmSegmentTools(
  deps: CrmSegmentToolDeps,
): RegisteredTool[] {
  const {
    crmSegmentsService,
    segmentQueryService,
    segmentMembersService,
    customersService,
    auditService,
  } = deps;

  // ── Segment write helpers ────────────────────────────────────────────────

  type SaveResolution =
    | {
        ok: true;
        mode: 'create';
        dto: CreateCrmSegmentDto;
        name: string;
        count: number | null;
      }
    | {
        ok: true;
        mode: 'update';
        id: number;
        dto: UpdateCrmSegmentDto;
        name: string;
        count: number | null;
        changes: ToolPreview['changes'];
        turnsIntoRules: boolean;
      }
    | { ok: false; target: string; message: string };

  async function resolveSave(
    args: Record<string, any>,
  ): Promise<SaveResolution> {
    const segmentId = args.segment_id ? toPositiveInt(args.segment_id) : null;
    if (args.segment_id && !segmentId) {
      return {
        ok: false,
        target: 'Segmento',
        message: 'segment_id inválido. Obtén el id con list_crm_segments.',
      };
    }
    const name = cleanString(args.name);
    const description =
      args.description === undefined
        ? undefined
        : (cleanString(args.description) ?? null);
    const filter =
      args.filter === undefined || args.filter === null
        ? undefined
        : args.filter;
    if (filter !== undefined && !isPlainObject(filter)) {
      return {
        ok: false,
        target: name ?? 'Segmento',
        message: 'filter debe ser un objeto {op, rules}.',
      };
    }

    if (!segmentId) {
      const plain: Record<string, unknown> = { name: name ?? '' };
      if (description !== undefined) plain.description = description;
      if (typeof args.is_dynamic === 'boolean')
        plain.is_dynamic = args.is_dynamic;
      if (filter !== undefined) plain.filter = filter;
      const validated = toValidatedDto(CreateCrmSegmentDto, plain);
      if (!validated.ok) {
        return {
          ok: false,
          target: name ?? 'Segmento nuevo',
          message: validated.message,
        };
      }
      let count: number | null = null;
      if (validated.dto.is_dynamic !== false) {
        try {
          count = (await crmSegmentsService.preview(validated.dto.filter ?? {}))
            .count;
        } catch (error) {
          return {
            ok: false,
            target: validated.dto.name,
            message: `El filtro no es válido: ${errorMessage(error)}`,
          };
        }
      }
      return {
        ok: true,
        mode: 'create',
        dto: validated.dto,
        name: validated.dto.name,
        count,
      };
    }

    const plain: Record<string, unknown> = {};
    if (name !== undefined) plain.name = name;
    if (description !== undefined) plain.description = description;
    if (filter !== undefined) plain.filter = filter;
    const validated = toValidatedDto(UpdateCrmSegmentDto, plain);
    if (!validated.ok) {
      return {
        ok: false,
        target: `Segmento #${segmentId}`,
        message: validated.message,
      };
    }
    let current: SegmentRow;
    try {
      current = (await crmSegmentsService.get(segmentId)) as SegmentRow;
    } catch (error) {
      return {
        ok: false,
        target: `Segmento #${segmentId}`,
        message: `No se encontró el segmento: ${errorMessage(error)}`,
      };
    }
    const changes: ToolPreview['changes'] = [];
    if (
      validated.dto.name !== undefined &&
      validated.dto.name.trim() !== current.name
    ) {
      changes.push({
        field: 'name',
        label: 'Nombre',
        from: current.name,
        to: validated.dto.name.trim(),
      });
    }
    if (validated.dto.description !== undefined) {
      const next = validated.dto.description?.trim() || null;
      if (next !== (current.description ?? null)) {
        changes.push({
          field: 'description',
          label: 'Descripción',
          from: current.description ?? null,
          to: next,
        });
      }
    }
    let count: number | null = null;
    let turnsIntoRules = false;
    if (validated.dto.filter !== undefined) {
      try {
        const resolved = await crmSegmentsService.preview(validated.dto.filter);
        count = resolved.count;
        const changed =
          !current.is_dynamic ||
          stableStringify(resolved.filter) !== stableStringify(current.filter);
        if (changed) {
          turnsIntoRules = !current.is_dynamic;
          changes.push({
            field: 'filter',
            label: 'Reglas',
            from: current.is_dynamic
              ? stableStringify(current.filter)
              : 'sin reglas (manual)',
            to: stableStringify(resolved.filter),
          });
        }
      } catch (error) {
        return {
          ok: false,
          target: current.name,
          message: `El filtro no es válido: ${errorMessage(error)}`,
        };
      }
    }
    if (!changes.length) {
      return {
        ok: false,
        target: current.name,
        message: `El segmento "${current.name}" ya tiene exactamente esos datos: no hay nada que cambiar.`,
      };
    }
    return {
      ok: true,
      mode: 'update',
      id: segmentId,
      dto: validated.dto,
      name: validated.dto.name?.trim() || current.name,
      count,
      changes,
      turnsIntoRules,
    };
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // ── update_segment_members planning (shared by preview and handler) ──────

  interface MemberPlan {
    segment: SegmentRow;
    labels: Map<number, string>;
    toAdd: number[];
    toRemove: number[];
    skipped: Array<{ id: number; reason: string }>;
    rows: ToolPreview['changes'];
  }

  async function planMembers(
    args: Record<string, any>,
    storeId: number,
  ): Promise<{ ok: true; plan: MemberPlan } | { ok: false; message: string }> {
    const segmentId = toPositiveInt(args.segment_id);
    if (!segmentId) {
      return {
        ok: false,
        message: 'segment_id inválido. Obtén el id con list_crm_segments.',
      };
    }
    const add = parseIdList(
      args.add_customer_ids,
      CRM_BULK_CUSTOMER_CAP,
      'clientes a agregar',
    );
    if (!add.ok) return { ok: false, message: add.message };
    const remove = parseIdList(
      args.remove_customer_ids,
      CRM_BULK_CUSTOMER_CAP,
      'clientes a quitar',
    );
    if (!remove.ok) return { ok: false, message: remove.message };
    if (!add.ids.length && !remove.ids.length) {
      return {
        ok: false,
        message:
          'Indica add_customer_ids o remove_customer_ids con al menos un cliente.',
      };
    }
    const both = add.ids.filter((id) => remove.ids.includes(id));
    if (both.length) {
      return {
        ok: false,
        message: `Los clientes ${both.join(', ')} están a la vez en agregar y en quitar.`,
      };
    }
    if (add.ids.length + remove.ids.length > CRM_BULK_CUSTOMER_CAP) {
      return {
        ok: false,
        message: `Son ${add.ids.length + remove.ids.length} clientes y el máximo por operación es ${CRM_BULK_CUSTOMER_CAP}. Divide la acción en tandas.`,
      };
    }

    let segment: SegmentRow;
    try {
      segment = (await crmSegmentsService.get(segmentId)) as SegmentRow;
    } catch (error) {
      return {
        ok: false,
        message: `No se encontró el segmento: ${errorMessage(error)}`,
      };
    }

    const allIds = [...add.ids, ...remove.ids];
    const { labels, missing } = await resolveCustomerLabels(
      customersService,
      storeId,
      allIds,
    );
    if (missing.length) {
      return {
        ok: false,
        message: `Estos ids no son clientes de esta tienda: ${missing.join(', ')}. Resuélvelos con find_customer o find_customers_by_criteria.`,
      };
    }

    // via 'manual' | 'both' means a hand-added member row exists.
    const manual = new Set<number>();
    const byRule = new Set<number>();
    for (let i = 0; i < allIds.length; i += MEMBERSHIP_CHUNK) {
      const memberships = await segmentMembersService.membershipsOf(
        allIds.slice(i, i + MEMBERSHIP_CHUNK),
      );
      for (const row of memberships) {
        const hit = row.segments.find((item) => item.id === segment.id);
        if (!hit) continue;
        if (hit.via === 'manual' || hit.via === 'both')
          manual.add(row.customer_id);
        if (hit.via === 'rule' || hit.via === 'both')
          byRule.add(row.customer_id);
      }
    }

    const toAdd: number[] = [];
    const toRemove: number[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];
    const rows: ToolPreview['changes'] = [];
    const label = (id: number) => labels.get(id) ?? `Cliente ${id}`;
    const stateOf = (id: number) =>
      manual.has(id)
        ? 'dentro'
        : byRule.has(id)
          ? 'dentro (por regla)'
          : 'fuera';
    for (const id of add.ids) {
      if (manual.has(id)) {
        skipped.push({ id, reason: 'ya está agregado a mano' });
        continue;
      }
      toAdd.push(id);
      rows.push({
        field: `cliente_${id}`,
        label: label(id),
        from: stateOf(id),
        to: 'dentro',
      });
    }
    for (const id of remove.ids) {
      if (!manual.has(id)) {
        skipped.push({
          id,
          reason: byRule.has(id)
            ? 'está por regla, no agregado a mano: quitarlo a mano no cambia nada'
            : 'no está en el segmento',
        });
        continue;
      }
      toRemove.push(id);
      rows.push({
        field: `cliente_${id}`,
        label: label(id),
        from: 'dentro',
        to: byRule.has(id) ? 'dentro (por regla)' : 'fuera',
      });
    }
    return {
      ok: true,
      plan: { segment, labels, toAdd, toRemove, skipped, rows },
    };
  }

  return [
    // ─── 1. list_crm_segments ──────────────────────────────────────────────
    {
      name: 'list_crm_segments',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      description:
        'Lista los segmentos CRM de la tienda: listas guardadas de clientes, por reglas (dinámicas) o manuales, con su cantidad de miembros. Úsala cuando pregunten "qué segmentos tengo" o antes de editar, borrar o llenar un segmento (da el segment_id). No confundir con get_customer_segments, que es analítica RFM de clientes y no guarda listas.',
      parameters: { type: 'object', properties: {} },
      requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_READ],
      readOnly: true,
      discovery: {
        synonyms: [
          'segmentos crm',
          'listas de clientes',
          'grupos de clientes',
          'segmentos guardados',
          'audiencias',
        ],
      },
      handler: async (_args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        try {
          const rows = (await crmSegmentsService.list()) as SegmentRow[];
          return crmToolSuccess(`${rows.length} segmento(s) CRM.`, {
            segments: rows.map((row) => ({
              id: row.id,
              name: row.name,
              description: row.description,
              type: typeLabel(row.is_dynamic),
              dynamic: row.is_dynamic,
              members_count: row.last_count ?? 0,
              counted_at: row.last_counted_at,
              ...(row.is_dynamic && { filter: row.filter }),
            })),
          });
        } catch (error) {
          return crmToolFailure('listar los segmentos', error);
        }
      },
    },

    // ─── 2. get_crm_segment_members ────────────────────────────────────────
    {
      name: 'get_crm_segment_members',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      description:
        'Muestra los clientes que hoy pertenecen a un segmento CRM (por reglas más los agregados a mano), paginados. Úsala para "quiénes están en el segmento X". Requiere segment_id: obtenlo primero con list_crm_segments.',
      parameters: {
        type: 'object',
        properties: {
          segment_id: {
            type: 'number',
            description: 'Id del segmento (list_crm_segments).',
          },
          page: { type: 'number', description: 'Página, desde 1.' },
          limit: {
            type: 'number',
            description: `Clientes por página (1 a ${MAX_MEMBERS_LIMIT}, por defecto ${DEFAULT_MEMBERS_LIMIT}).`,
          },
        },
        required: ['segment_id'],
      },
      requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_READ],
      readOnly: true,
      discovery: {
        synonyms: [
          'miembros del segmento',
          'clientes del segmento',
          'quiénes están en el segmento',
          'integrantes',
          'lista del segmento',
        ],
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        const segmentId = toPositiveInt(args.segment_id);
        if (!segmentId) {
          return crmToolError(
            'segment_id inválido.',
            'Obtén el id con list_crm_segments.',
          );
        }
        const page = toPositiveInt(args.page) ?? 1;
        const limit = Math.min(
          toPositiveInt(args.limit) ?? DEFAULT_MEMBERS_LIMIT,
          MAX_MEMBERS_LIMIT,
        );
        try {
          const segment = (await crmSegmentsService.get(
            segmentId,
          )) as SegmentRow;
          const result = await crmSegmentsService.customers(segmentId, {
            page,
            limit,
          });
          return crmToolSuccess(
            `El segmento "${segment.name}" tiene ${result.meta.total} cliente(s).`,
            {
              segment: {
                id: segment.id,
                name: segment.name,
                type: typeLabel(segment.is_dynamic),
              },
              total: result.meta.total,
              page: result.meta.page,
              total_pages: result.meta.totalPages,
              customers: result.data.map((row) => ({
                id: row.id,
                name: personName(row),
                email: row.email,
                phone: row.phone,
                orders_count: row.orders_count,
                total_spent: row.total_spent,
                last_order_at: row.last_order_at,
              })),
            },
          );
        } catch (error) {
          return crmToolFailure('consultar los miembros del segmento', error);
        }
      },
    },

    // ─── 3. find_customers_by_criteria ─────────────────────────────────────
    {
      name: 'find_customers_by_criteria',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      description:
        'Selecciona clientes por criterios (compras, gasto, última compra, etiqueta, etapa, responsable, RFM, consentimiento) sin guardar nada: devuelve cuántos son y sus customer_ids. Es el paso de selección para acciones en lote: sus ids alimentan tag_customers, update_segment_members y assign_customer_owner. orders_count cuenta compras terminadas de toda la vida; NO existe conteo de compras por mes: para "este mes" usa last_order_at con within_days, o díselo al usuario, nunca lo inventes. Si hay más clientes que el tope, truncated es true y conviene afinar el filtro o guardar un segmento.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'object', description: FILTER_DESCRIPTION },
        },
        required: ['filter'],
      },
      requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_READ],
      readOnly: true,
      discovery: {
        synonyms: [
          'clientes por criterio',
          'seleccionar clientes',
          'filtrar clientes',
          'buscar clientes por reglas',
          'selección en lote',
        ],
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        if (!isPlainObject(args.filter)) {
          return crmToolError(
            'Falta filter: un objeto {op, rules} con las reglas.',
            'Arma el filtro con el formato de la descripción del parámetro.',
          );
        }
        try {
          const resolved = await segmentQueryService.resolve(args.filter);
          const [count, ids, sample] = await Promise.all([
            segmentQueryService.count(resolved),
            segmentQueryService.memberIds(resolved),
            segmentQueryService.page(resolved, 1, SELECTION_SAMPLE),
          ]);
          const truncated = count > CRM_BULK_CUSTOMER_CAP;
          return crmToolSuccess(
            `${count} cliente(s) cumplen el criterio${truncated ? ` (se devuelven ${CRM_BULK_CUSTOMER_CAP} ids)` : ''}.`,
            {
              count,
              customer_ids: ids.slice(0, CRM_BULK_CUSTOMER_CAP),
              truncated,
              sample: sample.map((row) => ({
                id: row.id,
                name: personName(row),
                orders_count: row.orders_count,
                total_spent: row.total_spent,
                last_order_at: row.last_order_at,
              })),
            },
            truncated
              ? `Hay más de ${CRM_BULK_CUSTOMER_CAP} clientes y una acción en lote cubre ${CRM_BULK_CUSTOMER_CAP}. Repetir este mismo filtro no trae los siguientes: afínalo (por ejemplo, agrega {"field":"tag","cmp":"neq","value":<id de la etiqueta ya aplicada>} para excluir a los que ya la tienen) y vuelve a consultar.`
              : 'Pasa customer_ids a la acción en lote (tag_customers, update_segment_members, assign_customer_owner).',
          );
        } catch (error) {
          return crmToolFailure(
            'evaluar el criterio de clientes',
            error,
            'Corrige el filtro según el formato del parámetro.',
          );
        }
      },
    },

    // ─── 4. save_crm_segment ───────────────────────────────────────────────
    {
      name: 'save_crm_segment',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      description:
        'Crea o edita un segmento CRM (lista guardada de clientes). Sin segment_id crea: por reglas con filter (is_dynamic true, por defecto) o manual vacío con is_dynamic false, que luego se llena con update_segment_members. Con segment_id (de list_crm_segments) edita name, description o filter; darle filter a un segmento manual lo convierte en segmento por reglas y conserva a los agregados a mano. Para probar un filtro antes de guardar usa find_customers_by_criteria.',
      parameters: {
        type: 'object',
        properties: {
          segment_id: {
            type: 'number',
            description: 'Id del segmento a editar. Omítelo para crear.',
          },
          name: {
            type: 'string',
            description: 'Nombre (máx. 120). Obligatorio al crear.',
          },
          description: {
            type: 'string',
            description: 'Descripción opcional (máx. 1000).',
          },
          is_dynamic: {
            type: 'boolean',
            description:
              'Solo al crear. false = segmento manual sin reglas. Por defecto true.',
          },
          filter: { type: 'object', description: FILTER_DESCRIPTION },
        },
      },
      requiredPermissions: [CRM_PERMISSIONS.SEGMENTS_MANAGE],
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'crear segmento',
          'editar segmento',
          'guardar segmento',
          'lista de clientes',
          'segmento crm',
        ],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const store = requireStoreId(context);
        if (!store.ok) return crmPreviewError('Segmento', store.message);
        const resolved = await resolveSave(args);
        if (!resolved.ok)
          return crmPreviewError(resolved.target, resolved.message);
        if (resolved.mode === 'create') {
          const manual = resolved.dto.is_dynamic === false;
          return {
            status: 'ok',
            target: `Segmento "${resolved.name}"`,
            changes: [
              { field: 'name', label: 'Nombre', from: null, to: resolved.name },
              {
                field: 'type',
                label: 'Tipo',
                from: null,
                to: typeLabel(!manual),
              },
              ...(resolved.count !== null
                ? [
                    {
                      field: 'count',
                      label: 'Hoy cumplen',
                      from: null,
                      to: `${resolved.count} clientes`,
                    },
                  ]
                : []),
            ],
            message: manual
              ? 'Se crea vacío: agrega clientes con update_segment_members.'
              : 'Las reglas se evalúan cada vez que se usa el segmento.',
            domain: CRM_TOOL_DOMAIN,
          };
        }
        return {
          status: 'ok',
          target: `Segmento "${resolved.name}"`,
          changes: [
            ...resolved.changes,
            ...(resolved.count !== null
              ? [
                  {
                    field: 'count',
                    label: 'Hoy cumplen',
                    from: null,
                    to: `${resolved.count} clientes`,
                  },
                ]
              : []),
          ],
          ...(resolved.turnsIntoRules && {
            message:
              'Este segmento era manual: con reglas pasa a ser por reglas y conserva a los clientes agregados a mano.',
          }),
          domain: CRM_TOOL_DOMAIN,
        };
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        try {
          // Re-verify: the filter or name may have become invalid since the preview.
          const resolved = await resolveSave(args);
          if (!resolved.ok) return crmToolError(resolved.message);
          if (resolved.mode === 'create') {
            const created = (await crmSegmentsService.create(
              resolved.dto,
            )) as SegmentRow;
            return crmToolSuccess(`Segmento "${created.name}" creado.`, {
              segment_id: created.id,
              name: created.name,
              type: typeLabel(created.is_dynamic),
              members_count: created.last_count ?? 0,
            });
          }
          const updated = (await crmSegmentsService.update(
            resolved.id,
            resolved.dto,
          )) as SegmentRow;
          return crmToolSuccess(`Segmento "${updated.name}" actualizado.`, {
            segment_id: updated.id,
            name: updated.name,
            type: typeLabel(updated.is_dynamic),
            members_count: updated.last_count ?? 0,
            updated_fields: resolved.changes.map((change) => change.field),
          });
        } catch (error) {
          return crmToolFailure('guardar el segmento', error);
        }
      },
    },

    // ─── 5. delete_crm_segment ─────────────────────────────────────────────
    {
      name: 'delete_crm_segment',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      description:
        'Elimina un segmento CRM (la lista guardada, no a los clientes). Irreversible: pide confirmación. Obtén el segment_id con list_crm_segments. Las campañas que lo usaban conservan su historial pero quedan sin segmento.',
      parameters: {
        type: 'object',
        properties: {
          segment_id: {
            type: 'number',
            description: 'Id del segmento (list_crm_segments).',
          },
        },
        required: ['segment_id'],
      },
      requiredPermissions: [CRM_PERMISSIONS.SEGMENTS_MANAGE],
      requiresConfirmation: true,
      irreversible: true,
      discovery: {
        synonyms: [
          'borrar segmento',
          'eliminar segmento',
          'quitar segmento',
          'borrar lista de clientes',
        ],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const store = requireStoreId(context);
        if (!store.ok) return crmPreviewError('Segmento', store.message);
        const segmentId = toPositiveInt(args.segment_id);
        if (!segmentId) {
          return crmPreviewError(
            'Segmento',
            'segment_id inválido. Obtén el id con list_crm_segments.',
          );
        }
        try {
          const segment = (await crmSegmentsService.get(
            segmentId,
          )) as SegmentRow;
          return {
            status: 'warning',
            target: `Segmento "${segment.name}"`,
            changes: [
              {
                field: 'segment',
                label: 'Segmento',
                from: segment.name,
                to: 'eliminado',
              },
              {
                field: 'members_count',
                label: 'Clientes en el segmento',
                from: `${segment.last_count ?? 0}`,
                to: null,
              },
            ],
            message:
              'Se elimina la lista; los clientes no se tocan. Las campañas que lo usaban conservan su historial y quedan sin segmento.',
            domain: CRM_TOOL_DOMAIN,
          };
        } catch (error) {
          return crmPreviewError(
            `Segmento #${segmentId}`,
            `No se encontró el segmento: ${errorMessage(error)}`,
          );
        }
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        const segmentId = toPositiveInt(args.segment_id);
        if (!segmentId)
          return crmToolError(
            'segment_id inválido.',
            'Obtén el id con list_crm_segments.',
          );
        try {
          // CrmSegmentsService.remove already writes the audit row.
          await crmSegmentsService.remove(segmentId);
          return crmToolSuccess(`Segmento #${segmentId} eliminado.`, {
            segment_id: segmentId,
          });
        } catch (error) {
          return crmToolFailure('eliminar el segmento', error);
        }
      },
    },

    // ─── 6. update_segment_members ─────────────────────────────────────────
    {
      name: 'update_segment_members',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      description: `Agrega o quita a mano clientes de un segmento CRM, en lote (hasta ${CRM_BULK_CUSTOMER_CAP} en total). Los ids salen de find_customer o find_customers_by_criteria y el segment_id de list_crm_segments. En un segmento por reglas, agregar a mano suma al cliente a las reglas; quitar solo borra el agregado a mano, no a quien cumple las reglas. Muestra cada cliente (de → a) antes de aplicar.`,
      parameters: {
        type: 'object',
        properties: {
          segment_id: {
            type: 'number',
            description: 'Id del segmento (list_crm_segments).',
          },
          add_customer_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Ids de clientes a agregar.',
          },
          remove_customer_ids: {
            type: 'array',
            items: { type: 'number' },
            description:
              'Ids de clientes a quitar (solo los agregados a mano).',
          },
        },
        required: ['segment_id'],
      },
      requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_UPDATE],
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'agregar clientes al segmento',
          'quitar clientes del segmento',
          'meter en segmento',
          'sacar del segmento',
          'llenar segmento',
        ],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const store = requireStoreId(context);
        if (!store.ok)
          return crmPreviewError('Miembros del segmento', store.message);
        try {
          const planned = await planMembers(args, store.storeId);
          if (!planned.ok)
            return crmPreviewError('Miembros del segmento', planned.message);
          const { plan } = planned;
          const target = `Miembros de "${plan.segment.name}"`;
          if (!plan.toAdd.length && !plan.toRemove.length) {
            return crmPreviewError(
              target,
              `No hay nada que cambiar: ${plan.skipped.map((item) => `${plan.labels.get(item.id)} (${item.reason})`).join('; ')}.`,
            );
          }
          const summary = {
            field: 'resumen',
            label: 'Resumen',
            from: null,
            to: `${plan.toAdd.length} se agregan, ${plan.toRemove.length} se quitan, ${plan.skipped.length} sin cambio`,
          };
          const { changes, hiddenCount } = capPreviewRows([
            summary,
            ...plan.rows,
          ]);
          const notes = [
            hiddenCount > 0 ? `y ${hiddenCount} más sin mostrar` : null,
            plan.skipped.length
              ? `Sin cambio: ${plan.skipped
                  .slice(0, 5)
                  .map((item) => `${plan.labels.get(item.id)} (${item.reason})`)
                  .join('; ')}`
              : null,
          ].filter(Boolean);
          return {
            status: 'ok',
            target,
            changes,
            ...(notes.length && { message: notes.join('. ') }),
            domain: CRM_TOOL_DOMAIN,
          };
        } catch (error) {
          return crmPreviewError(
            'Miembros del segmento',
            `No se pudo previsualizar: ${errorMessage(error)}`,
          );
        }
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        try {
          // Re-verify: memberships may have moved since the preview.
          const planned = await planMembers(args, store.storeId);
          if (!planned.ok) return crmToolError(planned.message);
          const { plan } = planned;
          if (!plan.toAdd.length && !plan.toRemove.length) {
            return crmToolError(
              'El segmento cambió desde el preview: ya no hay nada que aplicar.',
              'Vuelve a proponer el cambio para previsualizarlo con el estado actual.',
            );
          }
          const added: number[] = [];
          const removed: number[] = [];
          const failed: Array<{
            customer_id: number;
            action: string;
            error: string;
          }> = [];
          for (const id of plan.toAdd) {
            try {
              await segmentMembersService.add(id, plan.segment.id);
              added.push(id);
            } catch (error) {
              failed.push({
                customer_id: id,
                action: 'agregar',
                error: errorMessage(error),
              });
            }
          }
          for (const id of plan.toRemove) {
            try {
              await segmentMembersService.remove(id, plan.segment.id);
              removed.push(id);
            } catch (error) {
              failed.push({
                customer_id: id,
                action: 'quitar',
                error: errorMessage(error),
              });
            }
          }
          if (added.length || removed.length) {
            await auditCrmAgentWrite(
              auditService,
              context as ToolExecutionContext,
              {
                tool: 'update_segment_members',
                action: 'BULK_UPDATE',
                resource: 'crm_segment_members',
                resourceId: plan.segment.id,
                newValues: {
                  segment: plan.segment.name,
                  added,
                  removed,
                  failed: failed.length,
                },
              },
            );
          }
          if (!added.length && !removed.length) {
            return crmToolError(
              `No se pudo cambiar ningún cliente: ${failed.map((item) => `${item.customer_id} (${item.error})`).join('; ')}.`,
            );
          }
          return crmToolSuccess(
            `Segmento "${plan.segment.name}": ${added.length} agregado(s), ${removed.length} quitado(s)${failed.length ? `, ${failed.length} con error` : ''}.`,
            {
              segment_id: plan.segment.id,
              added,
              removed,
              skipped: plan.skipped,
              failed,
            },
          );
        } catch (error) {
          return crmToolFailure('actualizar los miembros del segmento', error);
        }
      },
    },
  ];
}
