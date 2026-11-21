import { RequestContextService } from '@common/context/request-context.service';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { ALLOWED_MIME_EXTENSIONS } from '../../../domains/store/documents/documents.constants';

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
 * Execution (all inside one transaction, S3 compensated on failure):
 *  1. promote the chat attachment (`ai_attachments`) to the document module
 *     (`stored_files`, a SEPARATE S3 object, so purging the conversation's
 *     objects never touches it);
 *  2. file it in the record's folder (dossier with `subject_type/subject_id`);
 *  3. purchase orders also get a `purchase_order_attachments` row (with its own
 *     S3 copy: removing a PO attachment deletes the object behind `file_url`);
 *  4. stamp the attachment row (`linked_*`, `stored_file_id`) - the criterion
 *     the conversation purge uses to keep it.
 */

export const ATTACHABLE_ENTITY_TYPES = [
  'customer',
  'order',
  'purchase_order',
  'supplier',
  'expense',
  'product',
] as const;
export type AttachableEntityType = (typeof ATTACHABLE_ENTITY_TYPES)[number];

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
const DOSSIER_STAGE = 'records';

/** Minimal shape of the services this family needs; typed loosely like the other families. */
export interface DocumentToolDeps {
  /** StorePrismaService: tenant-scoped reads, `$transaction` and the stamp. */
  prisma: any;
  storedFiles: {
    upload(input: Record<string, any>, tx?: any): Promise<Record<string, any>>;
    discardObject(key: string): Promise<void>;
  };
  dossiers: {
    ensureForSubject(tx: any, input: Record<string, any>): Promise<any>;
    addSubjectFileItem(tx: any, input: Record<string, any>): Promise<any>;
  };
  s3: {
    downloadFile(key: string): Promise<Buffer>;
    uploadFile(buffer: Buffer, key: string, mime: string): Promise<string>;
    deleteFile(key: string): Promise<void>;
  };
  /** S3PathHelper (only `buildPurchaseOrderAttachmentPath` is used). */
  paths: {
    buildPurchaseOrderAttachmentPath(
      org: { id: number; slug: string },
      store: { id: number; slug: string },
      purchaseOrderId: number,
    ): string;
  };
}

interface RecordInfo {
  id: number;
  /** Human label shown next to the id (order number, name...). */
  label: string | null;
}

interface AttachmentRow {
  id: number;
  s3_key: string;
  mime_type: string;
  size_bytes: number;
  original_name: string;
  stored_file_id: number | null;
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
  async function loadAttachment(handle: unknown): Promise<AttachmentRow | null> {
    const id = parseHandle(handle);
    if (!id) return null;
    const row = await deps.prisma.ai_attachments.findFirst({
      where: { id },
      select: {
        id: true,
        s3_key: true,
        mime_type: true,
        size_bytes: true,
        original_name: true,
        stored_file_id: true,
      },
    });
    return (row ?? null) as AttachmentRow | null;
  }

  /** The record in the CURRENT store (scoped prisma), or null. */
  async function loadRecord(
    type: AttachableEntityType,
    id: number,
  ): Promise<RecordInfo | null> {
    const db = deps.prisma;
    const ctx = RequestContextService.getContext();
    switch (type) {
      case 'customer': {
        const row = await db.users.findFirst({
          where: {
            id,
            store_users: { some: { store_id: ctx?.store_id } },
            user_roles: { some: { roles: { name: 'customer' } } },
          },
          select: { id: true, first_name: true, last_name: true },
        });
        if (!row) return null;
        const name = [row.first_name, row.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        return { id: row.id, label: name || null };
      }
      case 'order': {
        const row = await db.orders.findFirst({
          where: { id },
          select: { id: true, order_number: true },
        });
        return row ? { id: row.id, label: row.order_number ?? null } : null;
      }
      case 'purchase_order': {
        const row = await db.purchase_orders.findFirst({
          where: { id },
          select: { id: true, order_number: true },
        });
        return row ? { id: row.id, label: row.order_number ?? null } : null;
      }
      case 'supplier': {
        const row = await db.suppliers.findFirst({
          where: { id, organization_id: ctx?.organization_id },
          select: { id: true, name: true },
        });
        return row ? { id: row.id, label: row.name ?? null } : null;
      }
      case 'expense': {
        const row = await db.expenses.findFirst({
          where: { id },
          select: { id: true, description: true },
        });
        return row
          ? { id: row.id, label: row.description?.trim().slice(0, 60) || null }
          : null;
      }
      case 'product': {
        const row = await db.products.findFirst({
          where: { id },
          select: { id: true, name: true },
        });
        return row ? { id: row.id, label: row.name ?? null } : null;
      }
    }
  }

  function previewError(target: string, message: string): ToolPreview {
    return { status: 'error', target, changes: [], message, domain: 'documents' };
  }

  function buildTool(type: AttachableEntityType): RegisteredTool {
    const permission = ATTACH_ENTITY_PERMISSION[type];
    const noun = ENTITY_NOUN[type];

    async function resolve(args: Record<string, any>): Promise<
      | { ok: true; attachment: AttachmentRow; record: RecordInfo; docType: string }
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
      const record = await loadRecord(type, entityId);
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
        let uploadedKey = null as string | null;
        let poCopyKey = null as string | null;
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

          const store_id = context?.store_id ?? RequestContextService.getStoreId();
          const organization_id =
            context?.organization_id ?? RequestContextService.getOrganizationId();
          const user_id = context?.user_id ?? RequestContextService.getUserId() ?? null;
          const actor = { type: 'ai' as const, id: user_id };

          // The bytes are needed to promote the object and for the PO copy.
          const buffer = await deps.s3.downloadFile(attachment.s3_key);

          const outcome = await deps.prisma.$transaction(async (tx: any) => {
            // 1. Promote to the document module: a separate S3 object. When the
            //    attachment was already promoted (saved before in another
            //    record), reuse that stored file instead of uploading again.
            let storedFile: Record<string, any>;
            if (attachment.stored_file_id) {
              storedFile = { id: attachment.stored_file_id, reused: true };
            } else {
              storedFile = await deps.storedFiles.upload(
                {
                  buffer,
                  originalName: attachment.original_name,
                  mimeType: attachment.mime_type,
                  source: 'upload',
                  folder: `records/${type}/${record.id}`,
                  actor,
                },
                tx,
              );
              uploadedKey = storedFile.s3_key as string;
            }

            // 2. The record's folder + the item.
            const title = record.label
              ? `${ENTITY_NAME_ES[type]} #${record.id} · ${record.label}`
              : `${ENTITY_NAME_ES[type]} #${record.id}`;
            const dossier = await deps.dossiers.ensureForSubject(tx, {
              subject_type: type,
              subject_id: record.id,
              title,
            });
            const item = await deps.dossiers.addSubjectFileItem(tx, {
              dossier_id: dossier.id,
              file_id: storedFile.id,
              stage_key: DOSSIER_STAGE,
              field_key: docType,
              note: 'Guardado por Vex',
              actor,
            });

            // 3. Purchase orders: where their attachments are shown today.
            let poAttachmentId: number | null = null;
            if (type === 'purchase_order') {
              const [store, organization] = await Promise.all([
                deps.prisma.stores.findFirst({
                  where: { id: store_id, organization_id },
                  select: { id: true, slug: true },
                }),
                deps.prisma.organizations.findFirst({
                  where: { id: organization_id },
                  select: { id: true, slug: true },
                }),
              ]);
              if (!store || !organization) {
                throw new Error('No se pudo resolver la tienda para guardar el archivo.');
              }
              poCopyKey = await deps.s3.uploadFile(
                buffer,
                `${deps.paths.buildPurchaseOrderAttachmentPath(organization, store, record.id)}/${Date.now()}-${attachment.original_name}`,
                attachment.mime_type,
              );
              const poAttachment = await tx.purchase_order_attachments.create({
                data: {
                  purchase_order_id: record.id,
                  file_url: poCopyKey,
                  file_name: attachment.original_name,
                  file_type: attachment.mime_type,
                  file_size: attachment.size_bytes,
                  notes: 'Guardado por Vex',
                  uploaded_by_user_id: user_id,
                },
              });
              poAttachmentId = poAttachment.id;
            }

            // 4. Stamp the attachment: the purge keeps rows with these set.
            await tx.ai_attachments.updateMany({
              where: { id: attachment.id },
              data: {
                linked_entity_type: type,
                linked_entity_id: record.id,
                linked_at: new Date(),
                stored_file_id: storedFile.id,
              },
            });

            return {
              stored_file_id: storedFile.id as number,
              dossier_id: dossier.id as number,
              dossier_item_id: item.id as number,
              purchase_order_attachment_id: poAttachmentId,
            };
          });

          return JSON.stringify({
            resumen: `${attachment.original_name} guardado en ${noun} #${record.id}.`,
            entity_type: type,
            entity_id: record.id,
            ...outcome,
          });
        } catch (error: any) {
          // Compensate the objects whose rows did not commit.
          if (uploadedKey) await deps.storedFiles.discardObject(uploadedKey);
          if (poCopyKey) await deps.storedFiles.discardObject(poCopyKey);
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
