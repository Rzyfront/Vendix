import { AuditService } from '../../../common/audit/audit.service';
import { CustomersService } from '../../../domains/store/customers/customers.service';
import { CustomerCrmService } from '../../../domains/store/customers/crm/profile/customer-crm.service';
import { CrmSegmentMembersService } from '../../../domains/store/customers/crm/segments/crm-segment-members.service';
import {
  CreateCrmCustomerNoteDto,
  UpdateCustomerCrmProfileDto,
} from '../../../domains/store/customers/crm/profile/dto/customer-crm.dto';
import { fullName } from '../_adapters/customer.adapter';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import {
  auditCrmAgentWrite,
  capPreviewRows,
  CRM_BULK_CUSTOMER_CAP,
  CRM_PERMISSIONS,
  CRM_TOOL_DOMAIN,
  crmPreviewError,
  crmToolError,
  crmToolFailure,
  crmToolSuccess,
  describeError,
  cleanString,
  parseIdList,
  requireStoreId,
  resolveCustomerLabels,
  toPositiveInt,
  toValidatedDto,
} from './crm-tools.shared';

/**
 * CRM customer tools (QUI-1042 · U-A): full customer card, archive, owner
 * assignment (single or bulk) and notes. Every tool delegates to the service
 * that owns the rule; no Prisma here.
 */
export interface CrmCustomerToolDeps {
  customersService: CustomersService;
  customerCrmService: CustomerCrmService;
  segmentMembersService: CrmSegmentMembersService;
  auditService: AuditService;
}

const ARCHIVED_STATE = 'archived';
const NOTE_EXCERPT_CHARS = 120;
const NOTES_DEFAULT_LIMIT = 20;
const NOTES_MAX_LIMIT = 50;
const NO_OWNER_LABEL = 'Sin responsable';
const NEXT_STEP_FIND_CUSTOMER =
  'Usa find_customer para obtener el customer_id correcto de esta tienda.';

interface OwnerRef {
  id?: number | null;
  first_name?: string | null;
  last_name?: string | null;
}

function ownerLabel(owner: OwnerRef | null | undefined): string {
  if (!owner) return NO_OWNER_LABEL;
  return (
    fullName({
      first_name: owner.first_name ?? undefined,
      last_name: owner.last_name ?? undefined,
    }) || `usuario #${owner.id ?? '?'}`
  );
}

function customerLabel(customer: any, id: number): string {
  const name = fullName({
    first_name: customer?.first_name ?? undefined,
    last_name: customer?.last_name ?? undefined,
  });
  return name || customer?.legal_name || `Cliente #${id}`;
}

function excerpt(text: string): string {
  return text.length > NOTE_EXCERPT_CHARS
    ? `${text.slice(0, NOTE_EXCERPT_CHARS)}…`
    : text;
}

/** Same refusal text for a seller without see-all on the assign path. */
const PROFILE_REFUSAL =
  'Tu rol no permite cambiar el responsable de un cliente (CRM_PROFILE_001): solo el dueño o quien puede asignar conversaciones lo hace.';

export function createCrmCustomerTools(
  deps: CrmCustomerToolDeps,
): RegisteredTool[] {
  const {
    customersService,
    customerCrmService,
    segmentMembersService,
    auditService,
  } = deps;

  /** Customer of THIS store or null (the service throws when it is not). */
  async function readCustomer(
    storeId: number,
    id: number,
  ): Promise<any | null> {
    try {
      return await customersService.findOne(storeId, id);
    } catch {
      return null;
    }
  }

  /**
   * Current owner per customer plus whether the user may assign, in one
   * store-scoped read (`CustomerCrmService.ownersOf`). Ids without a store
   * membership come back in `missing`.
   */
  async function readOwners(ids: number[]): Promise<{
    canAssign: boolean;
    owners: Map<number, OwnerRef | null>;
    missing: number[];
  }> {
    const { can_assign, owners } = await customerCrmService.ownersOf(ids);
    return {
      canAssign: can_assign,
      owners: owners as Map<number, OwnerRef | null>,
      missing: ids.filter((id) => !owners.has(id)),
    };
  }

  /** `owner_user_id` arg: positive int, explicit null (unassign) or invalid. */
  function parseOwner(
    args: Record<string, any>,
  ): { ok: true; ownerId: number | null } | { ok: false; message: string } {
    if (args.owner_user_id === null) return { ok: true, ownerId: null };
    const ownerId = toPositiveInt(args.owner_user_id);
    if (!ownerId) {
      return {
        ok: false,
        message:
          'Falta owner_user_id: indica el id del vendedor, o null para quitar el responsable.',
      };
    }
    return { ok: true, ownerId };
  }

  const getProfileTool: RegisteredTool = {
    name: 'get_customer_crm_profile',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Ficha completa de UN cliente: datos (nombre, documento, teléfono, correo, estado, pedidos y gasto total) más su CRM (responsable, etapa, origen, consentimientos, etiquetas, tareas abiertas y vencidas, oportunidades abiertas, RFM y segmentos). Úsala cuando pidan "la ficha", "el perfil CRM" o "qué sabemos" de un cliente. Obtén antes el customer_id con find_customer. Para sus compras detalladas usa get_customer_history; para métricas agregadas usa get_customer_stats.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: {
          type: 'number',
          description: 'Id del cliente. Resuélvelo con find_customer.',
        },
      },
      required: ['customer_id'],
    },
    discovery: {
      synonyms: [
        'ficha del cliente',
        'perfil CRM',
        'hoja de vida del cliente',
        'datos del cliente',
        'responsable del cliente',
      ],
    },
    requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_READ],
    readOnly: true,
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const customerId = toPositiveInt(args.customer_id);
      if (!customerId) {
        return crmToolError('customer_id inválido.', NEXT_STEP_FIND_CUSTOMER);
      }
      try {
        const customer: any = await customersService.findOne(
          store.storeId,
          customerId,
        );
        const [profile, memberships]: any[] = await Promise.all([
          customerCrmService.getProfile(customerId),
          segmentMembersService.ofCustomer(customerId),
        ]);
        return JSON.stringify({
          customer: {
            id: customerId,
            name: customerLabel(customer, customerId),
            document_type: customer.document_type ?? null,
            document_number: customer.document_number ?? null,
            phone: customer.phone ?? null,
            email: customer.email ?? null,
            state: customer.state ?? null,
            total_orders: customer.total_orders ?? 0,
            total_spend: customer.total_spend ?? 0,
            last_order_date: customer.last_order_date ?? null,
          },
          crm: {
            owner: profile.owner
              ? { id: profile.owner.id, name: ownerLabel(profile.owner) }
              : null,
            stage: profile.stage ?? null,
            source: profile.source ?? null,
            last_contact_at: profile.last_contact_at ?? null,
            consents: profile.consents ?? null,
            tags: profile.tags ?? [],
            open_tasks: profile.open_tasks ?? 0,
            overdue_tasks: profile.overdue_tasks ?? 0,
            open_opportunities: profile.open_opportunities ?? null,
            rfm: profile.rfm ?? null,
          },
          segments: memberships?.segments ?? [],
        });
      } catch (error) {
        return crmToolFailure(
          'leer la ficha del cliente',
          error,
          NEXT_STEP_FIND_CUSTOMER,
        );
      }
    },
  };

  const archiveTool: RegisteredTool = {
    name: 'archive_customer',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Archiva (da de baja) a UN cliente de la tienda. Úsala cuando el dueño pida eliminar, borrar o archivar un cliente. El cliente deja de aparecer en las listas pero su historial de pedidos y contabilidad se conserva; NO hay forma de restaurarlo desde Vex ni desde la pantalla de edición. Obtén antes el customer_id con find_customer. Siempre pide confirmación.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: {
          type: 'number',
          description: 'Id del cliente. Resuélvelo con find_customer.',
        },
        reason: {
          type: 'string',
          description: 'Motivo del archivo. Opcional; queda en la auditoría.',
        },
      },
      required: ['customer_id'],
    },
    discovery: {
      synonyms: [
        'archivar cliente',
        'eliminar cliente',
        'borrar cliente',
        'dar de baja cliente',
        'quitar cliente',
      ],
    },
    requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_DELETE],
    requiresConfirmation: true,
    irreversible: true,
    preview: async (args, context): Promise<ToolPreview> => {
      const target = 'Archivar cliente';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const customerId = toPositiveInt(args.customer_id);
      if (!customerId) {
        return crmPreviewError(
          target,
          `customer_id inválido. ${NEXT_STEP_FIND_CUSTOMER}`,
        );
      }
      const customer = await readCustomer(store.storeId, customerId);
      if (!customer) {
        return crmPreviewError(
          target,
          `El cliente #${customerId} no existe en esta tienda. ${NEXT_STEP_FIND_CUSTOMER}`,
        );
      }
      const label = customerLabel(customer, customerId);
      if (customer.state === ARCHIVED_STATE) {
        return crmPreviewError(label, `${label} ya está archivado.`);
      }
      return {
        status: 'warning',
        target: label,
        changes: [
          {
            field: 'state',
            label: 'Estado',
            from: customer.state ?? null,
            to: ARCHIVED_STATE,
          },
          ...(cleanString(args.reason)
            ? [
                {
                  field: 'reason',
                  label: 'Motivo',
                  from: null,
                  to: cleanString(args.reason),
                },
              ]
            : []),
        ],
        message:
          'El cliente dejará de aparecer en las listas de Clientes, POS y búsquedas. Su historial de pedidos y contabilidad se conserva. No existe una opción para restaurarlo desde la aplicación: la acción es irreversible.',
        domain: CRM_TOOL_DOMAIN,
      };
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const customerId = toPositiveInt(args.customer_id);
      if (!customerId) {
        return crmToolError('customer_id inválido.', NEXT_STEP_FIND_CUSTOMER);
      }
      try {
        // Re-verify: the preview is a projection, the world may have moved.
        const customer = await readCustomer(store.storeId, customerId);
        if (!customer) {
          return crmToolError(
            `El cliente #${customerId} no existe en esta tienda.`,
            NEXT_STEP_FIND_CUSTOMER,
          );
        }
        const label = customerLabel(customer, customerId);
        if (customer.state === ARCHIVED_STATE) {
          return crmToolError(`${label} ya estaba archivado.`);
        }
        await customersService.remove(store.storeId, customerId);
        const reason = cleanString(args.reason);
        // `remove` writes no audit row, so the agent records the archive.
        await auditCrmAgentWrite(auditService, context, {
          tool: 'archive_customer',
          action: 'DELETE',
          resource: 'customers',
          resourceId: customerId,
          oldValues: { state: customer.state ?? null },
          newValues: { state: ARCHIVED_STATE },
          metadata: { reason: reason ?? null },
        });
        return crmToolSuccess(`Cliente ${label} archivado.`, {
          customer_id: customerId,
          name: label,
          state: ARCHIVED_STATE,
        });
      } catch (error) {
        return crmToolFailure(
          'archivar al cliente',
          error,
          NEXT_STEP_FIND_CUSTOMER,
        );
      }
    },
  };

  const assignOwnerTool: RegisteredTool = {
    name: 'assign_customer_owner',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description: `Asigna o reasigna el responsable (vendedor) de uno o varios clientes (hasta ${CRM_BULK_CUSTOMER_CAP} por vez), o lo quita con owner_user_id null. Úsala para "pásale estos clientes a Laura" o "quítale el responsable". Obtén antes los customer_ids con find_customer o find_customers_by_criteria y el id del vendedor con list_store_users (el responsable debe ser personal activo de la tienda). Solo quien puede asignar (dueño/admin) la ejecuta; la vista previa lista cada cliente (responsable actual → nuevo).`,
    parameters: {
      type: 'object',
      properties: {
        customer_ids: {
          type: 'array',
          minItems: 1,
          maxItems: CRM_BULK_CUSTOMER_CAP,
          items: { type: 'number' },
          description: `Ids de los clientes (máximo ${CRM_BULK_CUSTOMER_CAP}).`,
        },
        owner_user_id: {
          type: ['number', 'null'],
          description:
            'Id del usuario vendedor (de list_store_users) o null para dejar al cliente sin responsable. Siempre explícito: sin este campo no se cambia nada.',
        },
      },
      // `owner_user_id` is not listed: the registry validator reads null on a
      // required field as missing, and null is how the owner is removed.
      // `parseOwner` still refuses the call when the field is absent.
      required: ['customer_ids'],
    },
    discovery: {
      synonyms: [
        'asignar vendedor',
        'reasignar cliente',
        'cambiar responsable',
        'responsable del cliente',
        'asignar en lote',
      ],
    },
    requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_UPDATE],
    requiresConfirmation: true,
    preview: async (args, context): Promise<ToolPreview> => {
      const target = 'Asignar responsable de clientes';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const parsedIds = parseIdList(args.customer_ids, CRM_BULK_CUSTOMER_CAP);
      if (!parsedIds.ok) return crmPreviewError(target, parsedIds.message);
      if (!parsedIds.ids.length) {
        return crmPreviewError(
          target,
          `Indica al menos un cliente en customer_ids. ${NEXT_STEP_FIND_CUSTOMER}`,
        );
      }
      const owner = parseOwner(args);
      if (!owner.ok) return crmPreviewError(target, owner.message);
      const ids = parsedIds.ids;
      try {
        const { labels, missing } = await resolveCustomerLabels(
          customersService,
          store.storeId,
          ids,
        );
        if (missing.length) {
          return crmPreviewError(
            target,
            `Estos ids no son clientes de esta tienda: ${missing.join(', ')}. ${NEXT_STEP_FIND_CUSTOMER}`,
          );
        }
        const {
          canAssign,
          owners,
          missing: unreadable,
        } = await readOwners(ids);
        if (!canAssign) return crmPreviewError(target, PROFILE_REFUSAL);
        if (unreadable.length) {
          return crmPreviewError(
            target,
            `No se pudo leer el CRM de los clientes: ${unreadable.join(', ')}. ${NEXT_STEP_FIND_CUSTOMER}`,
          );
        }
        const newOwner =
          owner.ownerId === null ? NO_OWNER_LABEL : `usuario #${owner.ownerId}`;
        const toChange = ids.filter(
          (id) => (owners.get(id)?.id ?? null) !== owner.ownerId,
        );
        const unchanged = ids.length - toChange.length;
        const subject =
          ids.length === 1
            ? (labels.get(ids[0]) ?? `Cliente #${ids[0]}`)
            : `${ids.length} clientes`;
        if (!toChange.length) {
          return crmPreviewError(
            subject,
            ids.length === 1
              ? `${subject} ya tiene a ${newOwner} como responsable: no hay nada que cambiar.`
              : `Los ${ids.length} clientes ya tienen a ${newOwner} como responsable: no hay nada que cambiar.`,
          );
        }
        const rows: ToolPreview['changes'] = toChange.map((id) => ({
          field: `cliente_${id}`,
          label: labels.get(id) ?? `Cliente #${id}`,
          from: ownerLabel(owners.get(id)),
          to: newOwner,
        }));
        const { changes: shown, hiddenCount } = capPreviewRows(rows);
        const notes = [
          unchanged > 0
            ? `${unchanged} ya tienen ese responsable y no cambian`
            : null,
          hiddenCount > 0
            ? `se muestran ${shown.length} de ${rows.length} clientes`
            : null,
          owner.ownerId !== null
            ? 'El responsable debe ser personal activo de la tienda; si no, el cambio se rechaza por cliente.'
            : null,
        ].filter(Boolean);
        return {
          status: unchanged > 0 || hiddenCount > 0 ? 'warning' : 'ok',
          target: subject,
          changes: [
            {
              field: 'resumen',
              label: 'Responsable',
              from: null,
              to: `${toChange.length} cliente(s) pasan a ${newOwner}${unchanged > 0 ? `, ${unchanged} sin cambio` : ''}`,
            },
            ...shown,
          ],
          ...(notes.length ? { message: notes.join('. ') } : {}),
          domain: CRM_TOOL_DOMAIN,
        };
      } catch (error) {
        const { code, message } = describeError(error);
        return crmPreviewError(
          target,
          `No se pudo preparar la asignación${code ? ` (${code})` : ''}: ${message}`,
        );
      }
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const parsedIds = parseIdList(args.customer_ids, CRM_BULK_CUSTOMER_CAP);
      if (!parsedIds.ok) return crmToolError(parsedIds.message);
      if (!parsedIds.ids.length) {
        return crmToolError(
          'Indica al menos un cliente en customer_ids.',
          NEXT_STEP_FIND_CUSTOMER,
        );
      }
      const owner = parseOwner(args);
      if (!owner.ok) return crmToolError(owner.message);
      const dto = toValidatedDto(UpdateCustomerCrmProfileDto, {
        owner_user_id: owner.ownerId,
      });
      if (!dto.ok) return crmToolError(dto.message);
      const ids = parsedIds.ids;
      try {
        // Re-validate: never touch ids that are not customers of this store.
        const { labels, missing } = await resolveCustomerLabels(
          customersService,
          store.storeId,
          ids,
        );
        if (missing.length) {
          return crmToolError(
            `Estos ids no son clientes de esta tienda: ${missing.join(', ')}.`,
            NEXT_STEP_FIND_CUSTOMER,
          );
        }
        const { canAssign, owners } = await readOwners(ids);
        if (!canAssign) {
          return crmToolError(
            PROFILE_REFUSAL,
            'Pide al dueño o a un administrador que haga la asignación.',
          );
        }
        const applied: Array<{ customer_id: number; name: string }> = [];
        const unchanged: number[] = [];
        const failed: Array<{
          customer_id: number;
          name: string;
          reason: string;
        }> = [];
        for (const id of ids) {
          const name = labels.get(id) ?? `Cliente #${id}`;
          if (
            owners.has(id) &&
            (owners.get(id)?.id ?? null) === owner.ownerId
          ) {
            unchanged.push(id);
            continue;
          }
          try {
            await customerCrmService.updateProfile(id, dto.dto);
            applied.push({ customer_id: id, name });
          } catch (error) {
            const { code, message } = describeError(error);
            failed.push({ customer_id: id, name, reason: code ?? message });
          }
        }
        if (!applied.length && failed.length) {
          const refused = failed.every((f) => f.reason === 'CRM_PROFILE_001');
          return crmToolError(
            refused
              ? PROFILE_REFUSAL
              : `No se pudo asignar el responsable a ningún cliente: ${failed
                  .slice(0, 5)
                  .map((f) => `${f.name} (${f.reason})`)
                  .join('; ')}.`,
            refused
              ? 'Pide al dueño o a un administrador que haga la asignación.'
              : 'Verifica con list_store_users que el vendedor sea personal activo de la tienda.',
          );
        }
        // Each updateProfile audits its customer; one summary row for bulks.
        if (ids.length > 1 && applied.length) {
          await auditCrmAgentWrite(auditService, context, {
            tool: 'assign_customer_owner',
            action: 'BULK_UPDATE',
            resource: 'customer_crm_owner',
            newValues: {
              owner_user_id: owner.ownerId,
              customer_ids: applied.map((a) => a.customer_id),
            },
            metadata: {
              requested: ids.length,
              applied: applied.length,
              unchanged: unchanged.length,
              failed: failed.length,
            },
          });
        }
        const target =
          owner.ownerId === null
            ? NO_OWNER_LABEL
            : `el usuario #${owner.ownerId}`;
        return crmToolSuccess(
          `Responsable ${owner.ownerId === null ? 'quitado' : `asignado a ${target}`} en ${applied.length} de ${ids.length} cliente(s).`,
          {
            owner_user_id: owner.ownerId,
            applied,
            unchanged,
            failed,
          },
          failed.length
            ? 'Informa cuáles fallaron y por qué; el resto quedó aplicado.'
            : undefined,
        );
      } catch (error) {
        return crmToolFailure(
          'asignar el responsable',
          error,
          NEXT_STEP_FIND_CUSTOMER,
        );
      }
    },
  };

  const listNotesTool: RegisteredTool = {
    name: 'list_customer_notes',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Lista las notas internas de UN cliente (fijadas primero, luego las más recientes), con autor y fecha. Úsala cuando pregunten qué se anotó o habló de un cliente. Obtén antes el customer_id con find_customer.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: {
          type: 'number',
          description: 'Id del cliente. Resuélvelo con find_customer.',
        },
        page: { type: 'number', description: 'Página (desde 1).' },
        limit: {
          type: 'number',
          description: `Notas por página (1-${NOTES_MAX_LIMIT}, por defecto ${NOTES_DEFAULT_LIMIT}).`,
        },
      },
      required: ['customer_id'],
    },
    discovery: {
      synonyms: [
        'notas del cliente',
        'observaciones del cliente',
        'comentarios del cliente',
        'anotaciones',
      ],
    },
    requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_READ],
    readOnly: true,
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const customerId = toPositiveInt(args.customer_id);
      if (!customerId) {
        return crmToolError('customer_id inválido.', NEXT_STEP_FIND_CUSTOMER);
      }
      const page = toPositiveInt(args.page) ?? 1;
      const limit = Math.min(
        toPositiveInt(args.limit) ?? NOTES_DEFAULT_LIMIT,
        NOTES_MAX_LIMIT,
      );
      try {
        const result: any = await customerCrmService.listNotes(customerId, {
          page,
          limit,
        });
        return JSON.stringify({
          total: result.total ?? 0,
          page: result.page ?? page,
          limit: result.limit ?? limit,
          notes: (result.data ?? []).map((note: any) => ({
            id: note.id,
            body: note.body,
            is_pinned: !!note.is_pinned,
            author: note.created_by ? ownerLabel(note.created_by) : null,
            created_at: note.created_at ?? null,
          })),
        });
      } catch (error) {
        return crmToolFailure(
          'listar las notas del cliente',
          error,
          NEXT_STEP_FIND_CUSTOMER,
        );
      }
    },
  };

  const addNoteTool: RegisteredTool = {
    name: 'add_customer_note',
    version: '1',
    domain: CRM_TOOL_DOMAIN,
    description:
      'Agrega una nota interna a la ficha de UN cliente (máximo 5000 caracteres), opcionalmente fijada. Úsala cuando pidan anotar, apuntar o dejar un comentario sobre un cliente. Obtén antes el customer_id con find_customer.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: {
          type: 'number',
          description: 'Id del cliente. Resuélvelo con find_customer.',
        },
        body: {
          type: 'string',
          maxLength: 5000,
          description: 'Texto de la nota.',
        },
        is_pinned: {
          type: 'boolean',
          description: 'Fijar la nota arriba en la ficha. Por defecto no.',
        },
      },
      required: ['customer_id', 'body'],
    },
    discovery: {
      synonyms: [
        'agregar nota',
        'anotar al cliente',
        'comentario del cliente',
        'apuntar observación',
        'fijar nota',
      ],
    },
    requiredPermissions: [CRM_PERMISSIONS.CUSTOMERS_UPDATE],
    requiresConfirmation: true,
    preview: async (args, context): Promise<ToolPreview> => {
      const target = 'Nota de cliente';
      const store = requireStoreId(context);
      if (!store.ok) return crmPreviewError(target, store.message);
      const customerId = toPositiveInt(args.customer_id);
      if (!customerId) {
        return crmPreviewError(
          target,
          `customer_id inválido. ${NEXT_STEP_FIND_CUSTOMER}`,
        );
      }
      const body = cleanString(args.body);
      if (!body)
        return crmPreviewError(target, 'La nota no puede estar vacía.');
      if (body.length > 5000) {
        return crmPreviewError(
          target,
          `La nota tiene ${body.length} caracteres y el máximo es 5000.`,
        );
      }
      const customer = await readCustomer(store.storeId, customerId);
      if (!customer) {
        return crmPreviewError(
          target,
          `El cliente #${customerId} no existe en esta tienda. ${NEXT_STEP_FIND_CUSTOMER}`,
        );
      }
      const pinned = args.is_pinned === true;
      return {
        status: 'ok',
        target: customerLabel(customer, customerId),
        changes: [
          { field: 'nota', label: 'Nota', from: null, to: excerpt(body) },
          ...(pinned
            ? [{ field: 'is_pinned', label: 'Fijada', from: false, to: true }]
            : []),
        ],
        domain: CRM_TOOL_DOMAIN,
      };
    },
    handler: async (args, context) => {
      const store = requireStoreId(context);
      if (!store.ok) return crmToolError(store.message);
      const customerId = toPositiveInt(args.customer_id);
      if (!customerId) {
        return crmToolError('customer_id inválido.', NEXT_STEP_FIND_CUSTOMER);
      }
      const validated = toValidatedDto(CreateCrmCustomerNoteDto, {
        body: cleanString(args.body) ?? '',
        ...(typeof args.is_pinned === 'boolean'
          ? { is_pinned: args.is_pinned }
          : {}),
      });
      if (!validated.ok) {
        return crmToolError(
          validated.message,
          'Corrige el texto de la nota (1 a 5000 caracteres).',
        );
      }
      try {
        const customer = await readCustomer(store.storeId, customerId);
        if (!customer) {
          return crmToolError(
            `El cliente #${customerId} no existe en esta tienda.`,
            NEXT_STEP_FIND_CUSTOMER,
          );
        }
        const note: any = await customerCrmService.createNote(
          customerId,
          validated.dto,
        );
        return crmToolSuccess(
          `Nota agregada a ${customerLabel(customer, customerId)}.`,
          {
            note_id: note?.id ?? null,
            customer_id: customerId,
            is_pinned: !!note?.is_pinned,
          },
        );
      } catch (error) {
        return crmToolFailure(
          'guardar la nota',
          error,
          NEXT_STEP_FIND_CUSTOMER,
        );
      }
    },
  };

  return [
    getProfileTool,
    archiveTool,
    assignOwnerTool,
    listNotesTool,
    addNoteTool,
  ];
}
