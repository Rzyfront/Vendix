import { RequestContextService } from '@common/context/request-context.service';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import {
  ALLOWED_MIME_EXTENSIONS,
  ATTACHABLE_ENTITY_TYPES,
  type AttachableEntityType,
} from '../../../domains/store/documents/documents.constants';
import type {
  AttachableRecord,
  RecordAttachmentsService,
} from '../../../domains/store/documents/record-attachments.service';
import type {
  AgentAttachmentRow,
  VexiAttachmentsService,
} from '../../../domains/store/vexi/vexi-attachments.service';

/**
 * Document family of Vex (T44, odd/tasks/vex-agente-avanzado.md §3.5):
 * "guarda esta factura en la orden de compra #123".
 *
 * One WRITE tool per target entity, built from one factory:
 * `attach_document_to_customer | order | purchase_order | supplier | expense |
 * product`, each `(attachment_id, entity_id, doc_type?)`.
 *
 * Why one tool per entity instead of `attach_document_to_record(entity_type)`:
 * the registry grants a tool with an EVERY-of `requiredPermissions` list
 * (`AIToolRegistry.isPermitted`, `executeTool`, proposal and token redemption),
 * there is no any-of. A single tool would either need the intersection of six
 * permissions (nobody would see it) or a generic one (a role could attach to an
 * entity it cannot edit). One tool per entity gives the exact per-target
 * permission in every gate (listing, propose, execute, redeem) with no registry
 * change. The handler ALSO re-checks the entity's permission, so it stays safe
 * if the tools are ever merged behind an any-of registry.
 *
 * Circuit: propose (preview) -> confirm -> execute, the same as every other
 * write tool (`requiresConfirmation` + `preview`).
 *
 * The tool is a facade: it checks the permission and the file type, and turns
 * the outcome into text for Vex. Reading the attachment and the record, and the
 * whole save (one transaction, S3 compensated on failure), live in the owner
 * services: `VexiAttachmentsService` and `RecordAttachmentsService`.
 */

export { ATTACHABLE_ENTITY_TYPES };
export type { AttachableEntityType };

/**
 * Write permission each entity's own controller asks to edit/attach on it.
 * Evidence (path:line of the `@Permissions`):
 *  - customer       customers.controller.ts:207-208 (PATCH :id)
 *  - order          orders.controller.ts:410-411 (PATCH :id)
 *  - purchase_order purchase-orders.controller.ts:675-676 (POST :id/attachments)
 *  - supplier       suppliers.controller.ts:203-204 (PATCH :id)
 *  - expense        expenses.controller.ts:240-241 (PUT :id)
 *  - product        products.controller.ts:398-399 (PATCH :id)
 */
export const ATTACH_ENTITY_PERMISSION: Readonly<
  Record<AttachableEntityType, string>
> = {
  customer: 'store:customers:update',
  order: 'store:orders:update',
  purchase_order: 'store:orders:purchase_orders:attach',
  supplier: 'store:inventory:suppliers:update',
  expense: 'store:expenses:update',
  product: 'store:products:update',
};

const ENTITY_NOUN: Readonly<Record<AttachableEntityType, string>> = {
  customer: 'el cliente',
  order: 'la orden',
  purchase_order: 'la orden de compra',
  supplier: 'el proveedor',
  expense: 'el gasto',
  product: 'el producto',
};

const ENTITY_NAME_ES: Readonly<Record<AttachableEntityType, string>> = {
  customer: 'Cliente',
  order: 'Orden',
  purchase_order: 'Orden de compra',
  supplier: 'Proveedor',
  expense: 'Gasto',
  product: 'Producto',
};

const DEFAULT_DOC_TYPE = 'vex_attachment';

/** Owner services of every read and write this family needs (no direct database access here). */
export interface DocumentToolDeps {
  attachments: Pick<VexiAttachmentsService, 'findAttachmentForAgent'>;
  recordAttachments: Pick<
    RecordAttachmentsService,
    'findRecordForAgent' | 'saveAttachmentToRecordForAgent'
  >;
}

function describeError(error: any): string {
  const detail = error?.response?.message ?? error?.message ?? String(error);
  return Array.isArray(detail) ? detail.join('; ') : String(detail);
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseHandle(value: unknown): number | null {
  const match = /^att_(\d+)$/.exec(String(value ?? '').trim());
  return match ? toPositiveInt(match[1]) : null;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Same permission source as `AIToolRegistry.executeTool` (`callerHolds` in ai-toolbox). */
function callerHolds(permission: string): boolean {
  const context = RequestContextService.getContext();
  const granted = context?.permissions?.length
    ? context.permissions
    : (context?.roles ?? []);
  return granted.includes(permission);
}

function normalizeDocType(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return DEFAULT_DOC_TYPE;
  return text.slice(0, 80);
}

/**
 * Why the document module would refuse this file, or null when it accepts it.
 * Mirrors `StoredFilesService.validate` (MIME allow-list + extension); nothing is
 * converted silently.
 */
export function unsupportedDocumentReason(
  mime: string,
  fileName: string,
): string | null {
  const normalized = (mime ?? '').split(';')[0].trim().toLowerCase();
  const extensions = ALLOWED_MIME_EXTENSIONS[normalized];
  if (!extensions) {
    return `No se puede guardar: el módulo de documentos no acepta archivos "${normalized || 'desconocido'}" (solo PDF, JPG, PNG, WEBP, DOCX, XLSX y TXT). El adjunto sigue disponible en la conversación; conviértelo y vuelve a adjuntarlo.`;
  }
  if (!extensions.includes(extensionOf(fileName))) {
    return `No se puede guardar: la extensión de "${fileName}" no corresponde al tipo "${normalized}".`;
  }
  return null;
}

export function createDocumentTools(deps: DocumentToolDeps): RegisteredTool[] {
  async function loadAttachment(
    handle: unknown,
  ): Promise<AgentAttachmentRow | null> {
    const id = parseHandle(handle);
    if (!id) return null;
    return deps.attachments.findAttachmentForAgent(id);
  }

  function recordTitle(type: AttachableEntityType, record: AttachableRecord): string {
    return record.label
      ? `${ENTITY_NAME_ES[type]} #${record.id} · ${record.label}`
      : `${ENTITY_NAME_ES[type]} #${record.id}`;
  }

  function previewError(target: string, message: string): ToolPreview {
    return { status: 'error', target, changes: [], message, domain: 'documents' };
  }

  function buildTool(type: AttachableEntityType): RegisteredTool {
    const permission = ATTACH_ENTITY_PERMISSION[type];
    const noun = ENTITY_NOUN[type];

    async function resolve(args: Record<string, any>): Promise<
      | {
          ok: true;
          attachment: AgentAttachmentRow;
          record: AttachableRecord;
          docType: string;
        }
      | { ok: false; error: string; next_step: string }
    > {
      const entityId = toPositiveInt(args?.entity_id);
      if (entityId === null) {
        return {
          ok: false,
          error: `entity_id inválido: ${String(args?.entity_id)}.`,
          next_step: `Pasa el ID numérico de ${noun}.`,
        };
      }
      if (parseHandle(args?.attachment_id) === null) {
        return {
          ok: false,
          error: `"${String(args?.attachment_id)}" no es un adjunto válido.`,
          next_step:
            'Usa el identificador del adjunto (att_N) o consúltalo con list_attachments.',
        };
      }
      const attachment = await loadAttachment(args.attachment_id);
      if (!attachment) {
        return {
          ok: false,
          error:
            'Ese adjunto ya no está disponible en esta tienda. Pídele a la persona que lo vuelva a adjuntar.',
          next_step: 'Consulta los adjuntos con list_attachments.',
        };
      }
      const record = await deps.recordAttachments.findRecordForAgent(
        type,
        entityId,
      );
      if (!record) {
        return {
          ok: false,
          error: `${ENTITY_NAME_ES[type]} #${entityId} no existe o no es visible en esta tienda.`,
          next_step: `Confirma el ID de ${noun} con su lectura correspondiente.`,
        };
      }
      return {
        ok: true,
        attachment,
        record,
        docType: normalizeDocType(args?.doc_type),
      };
    }

    return {
      name: `attach_document_to_${type}`,
      version: '1',
      domain: 'documents',
      description: `Guarda un archivo adjunto de la conversación (att_N) en la ficha de ${noun}: queda en su carpeta de documentos y sigue ahí aunque se borre la conversación. Solo PDF, JPG, PNG, WEBP, DOCX, XLSX y TXT. Úsala cuando la persona pida "guarda esta factura en ${noun} #N".`,
      parameters: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'string',
            description:
              'Identificador del adjunto en la conversación, como "att_41".',
          },
          entity_id: {
            type: 'number',
            description: `ID de ${noun}.`,
          },
          doc_type: {
            type: 'string',
            description:
              'Tipo de documento en texto corto (factura, contrato, comprobante). Opcional.',
          },
        },
        required: ['attachment_id', 'entity_id'],
      },
      discovery: {
        synonyms: ['guardar documento', 'asociar archivo', 'adjuntar factura'],
        dependencies: ['list_attachments'],
      },
      requiredPermissions: [permission],
      requiresConfirmation: true,
      preview: async (args): Promise<ToolPreview> => {
        const found = await resolve(args ?? {});
        if (!found.ok) {
          return previewError(`Guardar documento en ${noun}`, found.error);
        }
        const { attachment, record, docType } = found;
        const name = attachment.original_name;
        const target = `Guardar ${name} en ${noun} #${record.id}`;
        const refusal = unsupportedDocumentReason(
          attachment.mime_type,
          name,
        );
        if (refusal) return previewError(target, refusal);
        const changes: ToolPreview['changes'] = [
          { field: 'file', label: 'Archivo', from: null, to: name },
          {
            field: 'record',
            label: ENTITY_NAME_ES[type],
            from: null,
            to: record.label ? `#${record.id} · ${record.label}` : `#${record.id}`,
          },
          {
            field: 'doc_type',
            label: 'Tipo de documento',
            from: null,
            to: docType === DEFAULT_DOC_TYPE ? 'Adjunto de Vex' : docType,
          },
        ];
        return {
          status: 'ok',
          target,
          changes,
          message:
            type === 'purchase_order'
              ? 'El archivo quedará en la orden de compra y en su carpeta de documentos.'
              : 'El archivo quedará en la carpeta de documentos del registro.',
          domain: 'documents',
        };
      },
      handler: async (
        args: Record<string, any>,
        context: ToolExecutionContext,
      ): Promise<string> => {
        const fail = (error: string, next_step: string) =>
          JSON.stringify({ error, next_step });
        if (!callerHolds(permission)) {
          return fail(
            `Tu rol no permite guardar documentos en ${noun}: falta el permiso ${permission}.`,
            'Pídele a un administrador con ese permiso que lo guarde.',
          );
        }
        try {
          const found = await resolve(args ?? {});
          if (!found.ok) return fail(found.error, found.next_step);
          const { attachment, record, docType } = found;
          const refusal = unsupportedDocumentReason(
            attachment.mime_type,
            attachment.original_name,
          );
          if (refusal) {
            return fail(
              refusal,
              'Dile a la persona que ese formato no se puede guardar en el registro.',
            );
          }

          const outcome =
            await deps.recordAttachments.saveAttachmentToRecordForAgent({
              entityType: type,
              record,
              attachment,
              docType,
              dossierTitle: recordTitle(type, record),
              storeId: context?.store_id ?? RequestContextService.getStoreId(),
              organizationId:
                context?.organization_id ??
                RequestContextService.getOrganizationId(),
              userId:
                context?.user_id ?? RequestContextService.getUserId() ?? null,
            });

          return JSON.stringify({
            resumen: `${attachment.original_name} guardado en ${noun} #${record.id}.`,
            entity_type: type,
            entity_id: record.id,
            ...outcome,
          });
        } catch (error: any) {
          // The service already discarded the S3 objects whose rows did not commit.
          return JSON.stringify({
            error: describeError(error),
            next_step: 'No se guardó nada. Vuelve a intentarlo o avisa a soporte.',
          });
        }
      },
    };
  }

  return ATTACHABLE_ENTITY_TYPES.map(buildTool);
}
