import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { S3Service } from '@common/services/s3.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  AgentAttachmentRow,
  VexiAttachmentsService,
} from '../vexi/vexi-attachments.service';
import type { AttachableEntityType } from './documents.constants';
import { DocumentActor, DossiersService } from './dossiers.service';
import { StoredFilesService } from './stored-files.service';


export interface AttachableRecord {
  id: number;
  /** Human label shown next to the id (order number, name...). */
  label: string | null;
}

export interface SaveAttachmentToRecordInput {
  entityType: AttachableEntityType;
  record: AttachableRecord;
  attachment: AgentAttachmentRow;
  /** `field_key` of the dossier item (factura, contrato...). */
  docType: string;
  /** Title of the record's dossier when it has to be created. */
  dossierTitle: string;
  /** Execution context of the tool; the store/organization rows are resolved here. */
  storeId: number | undefined;
  organizationId: number | undefined;
  userId: number | null;
}

export interface SaveAttachmentToRecordResult {
  stored_file_id: number;
  dossier_id: number;
  dossier_item_id: number;
  purchase_order_attachment_id: number | null;
}

const DOSSIER_STAGE = 'records';
const SAVED_BY_NOTE = 'Guardado por Vex';

/**
 * Saves a Vex chat attachment (`ai_attachments`) into a business record's
 * folder (T44, odd/tasks/vex-agente-avanzado.md §3.5). The document tools are a
 * facade over this service: every read and write of the flow lives here, in
 * the tenant-scoped prisma, never in the tool.
 *
 * Execution (one transaction, S3 compensated on failure):
 *  1. promote the attachment to the document module (`stored_files`, a SEPARATE
 *     S3 object, so purging the conversation's objects never touches it), or
 *     reuse the stored file it was promoted to before;
 *  2. file it in the record's folder (dossier with `subject_type/subject_id`);
 *  3. purchase orders also get a `purchase_order_attachments` row with its own
 *     S3 copy (removing a PO attachment deletes the object behind `file_url`);
 *  4. stamp the attachment row (`linked_*`, `stored_file_id`), the criterion the
 *     conversation purge uses to keep it.
 */
@Injectable()
export class RecordAttachmentsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly storedFiles: StoredFilesService,
    private readonly dossiers: DossiersService,
    private readonly attachments: VexiAttachmentsService,
    private readonly s3: S3Service,
    private readonly paths: S3PathHelper,
  ) {}

  /** The record in the CURRENT store with its human label, or null. */
  async findRecordForAgent(
    type: AttachableEntityType,
    id: number,
  ): Promise<AttachableRecord | null> {
    const ctx = RequestContextService.getContext();
    switch (type) {
      case 'customer': {
        const row = await this.prisma.users.findFirst({
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
        const row = await this.prisma.orders.findFirst({
          where: { id },
          select: { id: true, order_number: true },
        });
        return row ? { id: row.id, label: row.order_number ?? null } : null;
      }
      case 'purchase_order': {
        const row = await this.prisma.purchase_orders.findFirst({
          where: { id },
          select: { id: true, order_number: true },
        });
        return row ? { id: row.id, label: row.order_number ?? null } : null;
      }
      case 'supplier': {
        const row = await this.prisma.suppliers.findFirst({
          where: { id, organization_id: ctx?.organization_id },
          select: { id: true, name: true },
        });
        return row ? { id: row.id, label: row.name ?? null } : null;
      }
      case 'expense': {
        const row = await this.prisma.expenses.findFirst({
          where: { id },
          select: { id: true, description: true },
        });
        return row
          ? { id: row.id, label: row.description?.trim().slice(0, 60) || null }
          : null;
      }
      case 'product': {
        const row = await this.prisma.products.findFirst({
          where: { id },
          select: { id: true, name: true },
        });
        return row ? { id: row.id, label: row.name ?? null } : null;
      }
    }
  }

  /**
   * Runs the whole save in one transaction. On failure the S3 objects whose
   * rows did not commit are discarded and the error is rethrown: nothing is
   * left half-saved.
   */
  async saveAttachmentToRecordForAgent(
    input: SaveAttachmentToRecordInput,
  ): Promise<SaveAttachmentToRecordResult> {
    const { entityType: type, record, attachment } = input;
    const actor: DocumentActor = { type: 'ai', id: input.userId };
    let uploadedKey: string | null = null;
    let poCopyKey: string | null = null;
    try {
      // The bytes are needed to promote the object and for the PO copy.
      const buffer = await this.s3.downloadFile(attachment.s3_key);

      return await this.prisma.$transaction(async (tx: any) => {
        // 1. Promote: a separate S3 object, or the stored file it already has.
        let storedFileId: number;
        if (attachment.stored_file_id) {
          storedFileId = attachment.stored_file_id;
        } else {
          const storedFile = await this.storedFiles.upload(
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
          uploadedKey = storedFile.s3_key;
          storedFileId = storedFile.id;
        }

        // 2. The record's folder + the item.
        const dossier = await this.dossiers.ensureForSubject(tx, {
          subject_type: type,
          subject_id: record.id,
          title: input.dossierTitle,
        });
        const item = await this.dossiers.addSubjectFileItem(tx, {
          dossier_id: dossier.id,
          file_id: storedFileId,
          stage_key: DOSSIER_STAGE,
          field_key: input.docType,
          note: SAVED_BY_NOTE,
          actor,
        });

        // 3. Purchase orders: where their attachments are shown today.
        let poAttachmentId: number | null = null;
        if (type === 'purchase_order') {
          if (!input.storeId || !input.organizationId) {
            throw new Error('No se pudo resolver la tienda para guardar el archivo.');
          }
          const [store, organization] = await Promise.all([
            this.prisma.stores.findFirst({
              where: { id: input.storeId, organization_id: input.organizationId },
              select: { id: true, slug: true },
            }),
            this.prisma.organizations.findFirst({
              where: { id: input.organizationId },
              select: { id: true, slug: true },
            }),
          ]);
          if (!store || !organization) {
            throw new Error('No se pudo resolver la tienda para guardar el archivo.');
          }
          poCopyKey = await this.s3.uploadFile(
            buffer,
            `${this.paths.buildPurchaseOrderAttachmentPath(organization, store, record.id)}/${Date.now()}-${attachment.original_name}`,
            attachment.mime_type,
          );
          const poAttachment = await tx.purchase_order_attachments.create({
            data: {
              purchase_order_id: record.id,
              file_url: poCopyKey,
              file_name: attachment.original_name,
              file_type: attachment.mime_type,
              file_size: attachment.size_bytes,
              notes: SAVED_BY_NOTE,
              uploaded_by_user_id: input.userId,
            },
          });
          poAttachmentId = poAttachment.id;
        }

        // 4. Stamp the attachment: the purge keeps rows with these set.
        await this.attachments.markSavedToRecordForAgent(tx, {
          attachmentId: attachment.id,
          entityType: type,
          entityId: record.id,
          storedFileId,
        });

        return {
          stored_file_id: storedFileId,
          dossier_id: dossier.id as number,
          dossier_item_id: item.id as number,
          purchase_order_attachment_id: poAttachmentId,
        };
      });
    } catch (error) {
      // Compensate the objects whose rows did not commit.
      if (uploadedKey) await this.storedFiles.discardObject(uploadedKey);
      if (poCopyKey) await this.storedFiles.discardObject(poCopyKey);
      throw error;
    }
  }
}
