import { AuditService } from '../../../common/audit/audit.service';
import { CustomersService } from '../../../domains/store/customers/customers.service';
import { CrmTagsService } from '../../../domains/store/customers/crm/tags/crm-tags.service';
import { CustomerCrmService } from '../../../domains/store/customers/crm/profile/customer-crm.service';
import { CrmSegmentMembersService } from '../../../domains/store/customers/crm/segments/crm-segment-members.service';
import {
  CreateCrmTagDto,
  UpdateCrmTagDto,
} from '../../../domains/store/customers/crm/profile/dto/customer-crm.dto';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import {
  auditCrmAgentWrite,
  capPreviewRows,
  cleanString,
  CRM_BULK_CUSTOMER_CAP,
  CRM_PERMISSIONS,
  CRM_TOOL_DOMAIN,
  crmPreviewError,
  crmToolError,
  crmToolFailure,
  crmToolSuccess,
  describeError,
  parseIdList,
  requireStoreId,
  resolveCustomerLabels,
  toPositiveInt,
  toValidatedDto,
} from './crm-tools.shared';

/**
 * CRM tags for Vex and Vexi (QUI-1042 S2, S8): catalog CRUD plus bulk
 * assignment. Everything goes through `CrmTagsService` / `CustomerCrmService`
 * (store scope and seller visibility stay in the services). The services write
 * no `audit_logs` rows, so delete and bulk assignment audit once here.
 */

export interface CrmTagToolDeps {
  crmTagsService: CrmTagsService;
  customerCrmService: CustomerCrmService;
  segmentMembersService: CrmSegmentMembersService;
  customersService: CustomersService;
  auditService: AuditService;
}

/** `SetCustomerTagsDto` allows at most this many tags per customer. */
const MAX_TAGS_PER_CUSTOMER = 50;
/** `membershipsOf` accepts up to this many customers per call. */
const MEMBERSHIPS_CHUNK = 100;

interface TagRow {
  id: number;
  name: string;
  color: string | null;
  customers_count?: number;
}

async function loadCatalog(deps: CrmTagToolDeps): Promise<TagRow[]> {
  const rows = await deps.crmTagsService.list();
  return (rows ?? []) as TagRow[];
}

function tagLabel(names: string[]): string {
  return names.length ? names.join(', ') : 'sin etiquetas';
}

interface TagCustomersPlan {
  customerIds: number[];
  addIds: number[];
  removeIds: number[];
  labels: Map<number, string>;
  rows: Array<{
    id: number;
    name: string;
    before: string[];
    after: string[];
    mergedIds: number[];
    changed: boolean;
  }>;
  added: number;
  removed: number;
  changedCount: number;
  unchangedCount: number;
  addNames: string[];
  removeNames: string[];
}

/** Validates and projects a `tag_customers` call; shared by preview and handler. */
async function planTagCustomers(
  deps: CrmTagToolDeps,
  args: Record<string, any>,
  storeId: number,
): Promise<
  { ok: true; plan: TagCustomersPlan } | { ok: false; message: string }
> {
  const customers = parseIdList(
    args.customer_ids ?? args.customer_id,
    CRM_BULK_CUSTOMER_CAP,
    'clientes',
  );
  if (!customers.ok) return customers;
  if (!customers.ids.length) {
    return {
      ok: false,
      message:
        'Indica al menos un cliente (customer_ids). Obtén los ids con find_customer o find_customers_by_criteria.',
    };
  }
  const add = parseIdList(args.add_tag_ids, MAX_TAGS_PER_CUSTOMER, 'etiquetas');
  if (!add.ok) return add;
  const remove = parseIdList(
    args.remove_tag_ids,
    MAX_TAGS_PER_CUSTOMER,
    'etiquetas',
  );
  if (!remove.ok) return remove;
  if (!add.ids.length && !remove.ids.length) {
    return {
      ok: false,
      message:
        'Indica qué etiquetas agregar (add_tag_ids) o quitar (remove_tag_ids). Obtén los ids con list_crm_tags.',
    };
  }
  const overlap = add.ids.filter((id) => remove.ids.includes(id));
  if (overlap.length) {
    return {
      ok: false,
      message: `La etiqueta ${overlap.join(', ')} está en add_tag_ids y en remove_tag_ids a la vez. Elige una sola acción por etiqueta.`,
    };
  }

  const catalog = await loadCatalog(deps);
  const tagNames = new Map(catalog.map((tag) => [tag.id, tag.name]));
  const unknownTags = [...add.ids, ...remove.ids].filter(
    (id) => !tagNames.has(id),
  );
  if (unknownTags.length) {
    return {
      ok: false,
      message: `Etiquetas que no existen en esta tienda: ${unknownTags.join(', ')}. Consulta list_crm_tags para ver los ids vigentes.`,
    };
  }

  const { labels, missing } = await resolveCustomerLabels(
    deps.customersService,
    storeId,
    customers.ids,
  );
  if (missing.length) {
    return {
      ok: false,
      message: `Clientes que no existen en esta tienda: ${missing.join(', ')}. No se toca ningún cliente de otra tienda.`,
    };
  }

  const current = new Map<number, number[]>();
  for (let i = 0; i < customers.ids.length; i += MEMBERSHIPS_CHUNK) {
    const chunk = customers.ids.slice(i, i + MEMBERSHIPS_CHUNK);
    const memberships = await deps.segmentMembersService.membershipsOf(chunk);
    for (const entry of memberships ?? []) {
      current.set(
        Number(entry.customer_id),
        (entry.tags ?? []).map((tag) => Number(tag.id)),
      );
    }
  }

  const nameOf = (id: number) => tagNames.get(id) ?? `#${id}`;
  let added = 0;
  let removed = 0;
  let changedCount = 0;
  const overflow: string[] = [];
  const rows: TagCustomersPlan['rows'] = customers.ids.map((id) => {
    const before = current.get(id) ?? [];
    const merged = [
      ...before.filter((tagId) => !remove.ids.includes(tagId)),
      ...add.ids.filter((tagId) => !before.includes(tagId)),
    ];
    const addedHere = merged.filter((tagId) => !before.includes(tagId)).length;
    const removedHere = before.filter(
      (tagId) => !merged.includes(tagId),
    ).length;
    const changed = addedHere > 0 || removedHere > 0;
    if (changed) {
      added += addedHere;
      removed += removedHere;
      changedCount += 1;
    }
    const name = labels.get(id) ?? `Cliente ${id}`;
    if (merged.length > MAX_TAGS_PER_CUSTOMER) overflow.push(name);
    return {
      id,
      name,
      before: before.map(nameOf),
      after: merged.map(nameOf),
      mergedIds: merged,
      changed,
    };
  });
  if (overflow.length) {
    return {
      ok: false,
      message: `Superaría el máximo de ${MAX_TAGS_PER_CUSTOMER} etiquetas por cliente: ${overflow.slice(0, 5).join(', ')}.`,
    };
  }
  if (!changedCount) {
    return {
      ok: false,
      message:
        'No hay nada que cambiar: todos los clientes ya tienen ese estado de etiquetas.',
    };
  }
  return {
    ok: true,
    plan: {
      customerIds: customers.ids,
      addIds: add.ids,
      removeIds: remove.ids,
      labels,
      rows,
      added,
      removed,
      changedCount,
      unchangedCount: rows.length - changedCount,
      addNames: add.ids.map(nameOf),
      removeNames: remove.ids.map(nameOf),
    },
  };
}

export function createCrmTagTools(deps: CrmTagToolDeps): RegisteredTool[] {
  return [
    // ─── list_crm_tags (READ) ────────────────────────────────────
    {
      name: 'list_crm_tags',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      readOnly: true,
      description:
        'Lista las etiquetas del CRM de la tienda con su color y cuántos clientes la tienen. Úsala para "qué etiquetas hay" y SIEMPRE antes de save_crm_tag, delete_crm_tag o tag_customers para obtener los ids de etiqueta. Para los ids de cliente usa find_customer o find_customers_by_criteria.',
      parameters: { type: 'object', properties: {} },
      requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_READ],
      discovery: {
        synonyms: [
          'etiquetas',
          'tags de clientes',
          'etiquetas del CRM',
          'categorías de cliente',
        ],
      },
      handler: async (_args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        try {
          const tags = (await loadCatalog(deps)).map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color ?? null,
            customers_count: tag.customers_count ?? 0,
          }));
          return crmToolSuccess(`${tags.length} etiquetas en la tienda.`, {
            tags,
            total: tags.length,
          });
        } catch (error) {
          return crmToolFailure('listar las etiquetas', error);
        }
      },
    },

    // ─── save_crm_tag (WRITE) ────────────────────────────────────
    {
      name: 'save_crm_tag',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      requiresConfirmation: true,
      description:
        'Crea una etiqueta del CRM (sin tag_id) o edita el nombre/color de una existente (con tag_id, obtenido con list_crm_tags). El nombre no puede repetirse en la tienda. Solo define la etiqueta: para ponerla a clientes usa tag_customers (ids de cliente con find_customer o find_customers_by_criteria).',
      parameters: {
        type: 'object',
        properties: {
          tag_id: {
            type: 'number',
            description:
              'ID de la etiqueta a editar, de list_crm_tags. Omítelo para crear una nueva.',
          },
          name: {
            type: 'string',
            description:
              'Nombre de la etiqueta (máx 60). Obligatorio al crear.',
          },
          color: {
            type: 'string',
            description: 'Color de la etiqueta, p. ej. "#16a34a" (máx 20).',
          },
        },
      },
      requiredPermissions: [CRM_PERMISSIONS.SEGMENTS_MANAGE],
      discovery: {
        synonyms: [
          'crear etiqueta',
          'editar etiqueta',
          'renombrar etiqueta',
          'nueva etiqueta',
          'cambiar color de etiqueta',
        ],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const store = requireStoreId(context);
        if (!store.ok) return crmPreviewError('Etiqueta', store.message);
        const name = cleanString(args.name);
        const color =
          args.color === null ? null : (cleanString(args.color) ?? undefined);
        const hasTagId = args.tag_id !== undefined && args.tag_id !== null;
        const tagId = toPositiveInt(args.tag_id);
        if (hasTagId && !tagId) {
          return crmPreviewError(
            'Etiqueta',
            `"${String(args.tag_id)}" no es un id válido de etiqueta.`,
          );
        }
        try {
          const catalog = await loadCatalog(deps);
          if (!tagId) {
            const validated = toValidatedDto(CreateCrmTagDto, {
              ...(name !== undefined && { name }),
              ...(color !== undefined && { color }),
            });
            if (!validated.ok) {
              return crmPreviewError('Etiqueta nueva', validated.message);
            }
            const clean = validated.dto.name.trim();
            if (catalog.some((tag) => tag.name === clean)) {
              return crmPreviewError(
                clean,
                `Ya existe una etiqueta con ese nombre (CRM_TAG_002). Elige otro nombre o edítala con su tag_id.`,
              );
            }
            return {
              status: 'ok',
              target: `Etiqueta nueva "${clean}"`,
              changes: [
                { field: 'name', label: 'Nombre', from: null, to: clean },
                ...(color !== undefined
                  ? [{ field: 'color', label: 'Color', from: null, to: color }]
                  : []),
              ],
              domain: CRM_TOOL_DOMAIN,
            };
          }
          const existing = catalog.find((tag) => tag.id === tagId);
          if (!existing) {
            return crmPreviewError(
              `Etiqueta ${tagId}`,
              'La etiqueta no existe en esta tienda (CRM_TAG_001). Consulta list_crm_tags.',
            );
          }
          const validated = toValidatedDto(UpdateCrmTagDto, {
            ...(name !== undefined && { name }),
            ...(color !== undefined && { color }),
          });
          if (!validated.ok) {
            return crmPreviewError(existing.name, validated.message);
          }
          const changes: ToolPreview['changes'] = [];
          const nextName = validated.dto.name?.trim();
          if (nextName !== undefined && nextName !== existing.name) {
            if (
              catalog.some((tag) => tag.id !== tagId && tag.name === nextName)
            ) {
              return crmPreviewError(
                existing.name,
                'Ya existe otra etiqueta con ese nombre (CRM_TAG_002).',
              );
            }
            changes.push({
              field: 'name',
              label: 'Nombre',
              from: existing.name,
              to: nextName,
            });
          }
          if (color !== undefined && color !== (existing.color ?? null)) {
            changes.push({
              field: 'color',
              label: 'Color',
              from: existing.color ?? null,
              to: color,
            });
          }
          if (!changes.length) {
            return crmPreviewError(
              existing.name,
              'No hay cambios: la etiqueta ya tiene esos valores.',
            );
          }
          return {
            status: 'ok',
            target: `Etiqueta "${existing.name}"`,
            changes,
            domain: CRM_TOOL_DOMAIN,
          };
        } catch (error) {
          const { message } = describeError(error);
          return crmPreviewError('Etiqueta', message);
        }
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        const name = cleanString(args.name);
        const color =
          args.color === null ? null : (cleanString(args.color) ?? undefined);
        const tagId = toPositiveInt(args.tag_id);
        try {
          if (!tagId) {
            const validated = toValidatedDto(CreateCrmTagDto, {
              ...(name !== undefined && { name }),
              ...(color !== undefined && { color }),
            });
            if (!validated.ok) {
              return crmToolError(
                validated.message,
                'Corrige los datos y vuelve a proponer.',
              );
            }
            const created: any = await deps.crmTagsService.create(
              validated.dto,
            );
            return crmToolSuccess(
              `Etiqueta "${created.name}" creada.`,
              {
                tag: {
                  id: created.id,
                  name: created.name,
                  color: created.color ?? null,
                },
              },
              'Para ponerla a clientes usa tag_customers.',
            );
          }
          const catalog = await loadCatalog(deps);
          if (!catalog.some((tag) => tag.id === tagId)) {
            return crmToolError(
              'La etiqueta ya no existe en esta tienda (CRM_TAG_001).',
              'Consulta list_crm_tags y vuelve a proponer.',
            );
          }
          const validated = toValidatedDto(UpdateCrmTagDto, {
            ...(name !== undefined && { name }),
            ...(color !== undefined && { color }),
          });
          if (!validated.ok) {
            return crmToolError(
              validated.message,
              'Corrige los datos y vuelve a proponer.',
            );
          }
          const updated: any = await deps.crmTagsService.update(
            tagId,
            validated.dto,
          );
          return crmToolSuccess(`Etiqueta "${updated.name}" actualizada.`, {
            tag: {
              id: updated.id,
              name: updated.name,
              color: updated.color ?? null,
            },
          });
        } catch (error) {
          return crmToolFailure('guardar la etiqueta', error);
        }
      },
    },

    // ─── delete_crm_tag (WRITE, irreversible) ────────────────────
    {
      name: 'delete_crm_tag',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      requiresConfirmation: true,
      irreversible: true,
      description:
        'Elimina una etiqueta del CRM y la quita de todos los clientes que la tienen (los clientes no se borran). No se puede deshacer. Obtén tag_id con list_crm_tags. Para quitarla solo a algunos clientes usa tag_customers con remove_tag_ids.',
      parameters: {
        type: 'object',
        properties: {
          tag_id: {
            type: 'number',
            description: 'ID de la etiqueta a eliminar, de list_crm_tags.',
          },
        },
        required: ['tag_id'],
      },
      requiredPermissions: [CRM_PERMISSIONS.SEGMENTS_MANAGE],
      discovery: {
        synonyms: [
          'borrar etiqueta',
          'eliminar etiqueta',
          'quitar etiqueta del catálogo',
        ],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const store = requireStoreId(context);
        if (!store.ok) return crmPreviewError('Etiqueta', store.message);
        const tagId = toPositiveInt(args.tag_id);
        if (!tagId) {
          return crmPreviewError(
            'Etiqueta',
            'Falta un tag_id válido. Consulta list_crm_tags.',
          );
        }
        try {
          const tag = (await loadCatalog(deps)).find((row) => row.id === tagId);
          if (!tag) {
            return crmPreviewError(
              `Etiqueta ${tagId}`,
              'La etiqueta no existe en esta tienda (CRM_TAG_001).',
            );
          }
          const count = tag.customers_count ?? 0;
          return {
            status: 'warning',
            target: `Etiqueta "${tag.name}"`,
            changes: [
              {
                field: 'etiqueta',
                label: 'Etiqueta',
                from: tag.name,
                to: '(se elimina)',
              },
              {
                field: 'clientes',
                label: 'Clientes con la etiqueta',
                from: count,
                to: 0,
              },
            ],
            message: `Se elimina y se quita de ${count} clientes. No se puede deshacer.`,
            domain: CRM_TOOL_DOMAIN,
          };
        } catch (error) {
          return crmPreviewError('Etiqueta', describeError(error).message);
        }
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        const tagId = toPositiveInt(args.tag_id);
        if (!tagId) {
          return crmToolError(
            'Falta un tag_id válido.',
            'Consulta list_crm_tags.',
          );
        }
        try {
          const tag = (await loadCatalog(deps)).find((row) => row.id === tagId);
          if (!tag) {
            return crmToolError(
              'La etiqueta ya no existe en esta tienda (CRM_TAG_001).',
              'Consulta list_crm_tags.',
            );
          }
          await deps.crmTagsService.remove(tagId);
          await auditCrmAgentWrite(deps.auditService, context, {
            tool: 'delete_crm_tag',
            action: 'DELETE',
            resource: 'crm_tags',
            resourceId: tagId,
            oldValues: { name: tag.name, color: tag.color ?? null },
            metadata: { customers_count: tag.customers_count ?? 0 },
          });
          return crmToolSuccess(`Etiqueta "${tag.name}" eliminada.`, {
            tag_id: tagId,
            name: tag.name,
            customers_affected: tag.customers_count ?? 0,
          });
        } catch (error) {
          return crmToolFailure('eliminar la etiqueta', error);
        }
      },
    },

    // ─── tag_customers (WRITE, bulk) ─────────────────────────────
    {
      name: 'tag_customers',
      version: '1',
      domain: CRM_TOOL_DOMAIN,
      requiresConfirmation: true,
      description: `Agrega y/o quita etiquetas del CRM a uno o varios clientes (hasta ${CRM_BULK_CUSTOMER_CAP} por vez), conservando las demás etiquetas de cada uno. Ids de cliente: find_customer o find_customers_by_criteria (para "los que compraron más de 3 veces"). Ids de etiqueta: list_crm_tags (si no existe, créala antes con save_crm_tag). Muestra cada cliente con sus etiquetas antes y después para que el usuario confirme.`,
      parameters: {
        type: 'object',
        properties: {
          customer_ids: {
            type: 'array',
            items: { type: 'number' },
            description: `IDs de los clientes (1 a ${CRM_BULK_CUSTOMER_CAP}); también se acepta un solo número.`,
          },
          add_tag_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'IDs de etiquetas a agregar, de list_crm_tags.',
          },
          remove_tag_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'IDs de etiquetas a quitar, de list_crm_tags.',
          },
        },
        required: ['customer_ids'],
      },
      requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_UPDATE],
      discovery: {
        synonyms: [
          'etiquetar clientes',
          'ponerle etiqueta al cliente',
          'quitar etiqueta al cliente',
          'etiquetado en lote',
          'marcar clientes como VIP',
        ],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const store = requireStoreId(context);
        if (!store.ok)
          return crmPreviewError('Etiquetas de clientes', store.message);
        try {
          const result = await planTagCustomers(deps, args, store.storeId);
          if (!result.ok) {
            return crmPreviewError('Etiquetas de clientes', result.message);
          }
          const { plan } = result;
          const summary: ToolPreview['changes'][number] = {
            field: 'resumen',
            label: 'Resumen',
            from: `${plan.rows.length} clientes seleccionados`,
            to: `Se agregan ${tagLabel(plan.addNames)} / se quitan ${tagLabel(plan.removeNames)} en ${plan.changedCount} clientes; ${plan.unchangedCount} ya estaban así`,
          };
          const detail = plan.rows
            .filter((row) => row.changed)
            .map((row) => ({
              field: `cliente_${row.id}`,
              label: row.name,
              from: tagLabel(row.before),
              to: tagLabel(row.after),
            }));
          const { changes, hiddenCount } = capPreviewRows(detail);
          const single = plan.rows.length === 1 ? plan.rows[0].name : null;
          return {
            status: 'ok',
            target: single
              ? `Etiquetas de ${single}`
              : `Etiquetas de ${plan.rows.length} clientes`,
            changes: [summary, ...changes],
            ...(hiddenCount > 0 && {
              message: `se muestran ${changes.length} de ${detail.length} clientes que cambian (y ${hiddenCount} más)`,
            }),
            domain: CRM_TOOL_DOMAIN,
          };
        } catch (error) {
          return crmPreviewError(
            'Etiquetas de clientes',
            describeError(error).message,
          );
        }
      },
      handler: async (args, context) => {
        const store = requireStoreId(context);
        if (!store.ok) return crmToolError(store.message);
        try {
          // Re-verification: tags and customers may have moved since the preview.
          const result = await planTagCustomers(deps, args, store.storeId);
          if (!result.ok) {
            return crmToolError(
              result.message,
              'Vuelve a proponer el lote para previsualizarlo con el estado actual.',
            );
          }
          const { plan } = result;
          const applied: Array<{ customer_id: number; name: string }> = [];
          const failed: Array<{
            customer_id: number;
            name: string;
            reason: string;
          }> = [];
          for (const row of plan.rows) {
            if (!row.changed) continue;
            try {
              await deps.customerCrmService.setTags(row.id, row.mergedIds);
              applied.push({ customer_id: row.id, name: row.name });
            } catch (error) {
              failed.push({
                customer_id: row.id,
                name: row.name,
                reason: describeError(error).message,
              });
            }
          }
          if (!applied.length) {
            return crmToolError(
              `No se pudo etiquetar a ningún cliente: ${failed
                .slice(0, 5)
                .map((f) => `${f.name} (${f.reason})`)
                .join('; ')}.`,
              'Revisa los motivos y vuelve a proponer.',
            );
          }
          await auditCrmAgentWrite(deps.auditService, context, {
            tool: 'tag_customers',
            action: 'BULK_UPDATE',
            resource: 'crm_customer_tags',
            newValues: {
              customer_ids: plan.customerIds,
              add_tag_ids: plan.addIds,
              remove_tag_ids: plan.removeIds,
            },
            metadata: { applied: applied.length, failed: failed.length },
          });
          return crmToolSuccess(
            `Etiquetas actualizadas en ${applied.length} clientes${failed.length ? `; fallaron ${failed.length}` : ''}.`,
            {
              applied,
              failed,
              unchanged: plan.unchangedCount,
            },
          );
        } catch (error) {
          return crmToolFailure('etiquetar a los clientes', error);
        }
      },
    },
  ];
}
