import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import {
  DOCUMENT_MAX_FILES,
  StoredDocument,
  checkDocumentFile,
  readStoredDocuments,
  resolveDocumentConfig,
} from './template-json/template-json.contract';
import { sanitizeUploadFileName } from './utils/file-name.util';
import { matchesDeclaredSignature } from './utils/file-signature.util';

export interface SignedDocument extends StoredDocument {
  url: string | null;
}

interface TemplateItemLike {
  metadata_field_id: number;
  metadata_field?: { field_type?: string } | null;
  validation_rules?: unknown;
}

interface SubmissionLike {
  id: number;
  store_id: number;
  template?: {
    tabs?: Array<{ sections?: SectionLike[] }>;
    sections?: SectionLike[];
  } | null;
}

interface SectionLike {
  items?: TemplateItemLike[];
  child_sections?: SectionLike[];
}

/**
 * Attachments of the public data-collection form: validates and stores the
 * uploaded files, checks the stored answers and signs them for reading.
 * Files live under `<store>/data-collection/<submissionId>/`.
 */
@Injectable()
export class SubmissionDocumentsService {
  private readonly logger = new Logger(SubmissionDocumentsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly s3Path: S3PathHelper,
  ) {}

  /** `<org>/<store>/data-collection` — every attachment key of the store starts with it. */
  async storePrefix(storeId: number): Promise<string> {
    const store = await this.prisma.withoutScope().stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        organizations: { select: { id: true, slug: true } },
      },
    });
    if (!store) throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_001);
    return `${this.s3Path.buildStorePath(store.organizations, store)}/data-collection`;
  }

  /** The template item of a field, wherever it sits (tab, section, child section). */
  findItem(submission: SubmissionLike, fieldId: number): TemplateItemLike | null {
    const visit = (sections: SectionLike[] | undefined): TemplateItemLike | null => {
      for (const section of sections ?? []) {
        const hit =
          section.items?.find((i) => i.metadata_field_id === fieldId) ??
          visit(section.child_sections);
        if (hit) return hit;
      }
      return null;
    };
    const template = submission.template;
    return (
      visit(template?.sections) ??
      (template?.tabs ?? []).reduce<TemplateItemLike | null>(
        (found, tab) => found ?? visit(tab.sections),
        null,
      )
    );
  }

  /**
   * Uploads one file of the public form. With `fieldId` the file is checked
   * against the documents config of that template item; without it the legacy
   * behavior applies (no per-field validation).
   */
  async upload(
    submission: SubmissionLike,
    file: Express.Multer.File,
    fieldId?: number,
  ) {
    const prefix = await this.storePrefix(submission.store_id);
    const original = file.originalname || 'archivo';

    if (fieldId === undefined) {
      const fileName = `${Date.now()}-${original.replace(/\s+/g, '_')}`;
      const key = `${prefix}/${submission.id}/${fileName}`;
      const uploadedKey = file.mimetype?.startsWith('image/')
        ? (await this.s3.uploadImage(file.buffer, key)).key
        : await this.s3.uploadFile(file.buffer, key, file.mimetype);
      const url = await this.s3.signUrl(uploadedKey);
      this.logger.log(
        `Public file uploaded for submission ${submission.id}: ${uploadedKey}`,
      );
      return { key: uploadedKey, url, originalName: original };
    }

    const item = this.findItem(submission, fieldId);
    if (!item || item.metadata_field?.field_type !== 'file') {
      throw new VendixHttpException(ErrorCodes.DCOL_UPLOAD_003);
    }
    const config = resolveDocumentConfig(item.validation_rules);
    const mime = (file.mimetype ?? '').toLowerCase();
    const size = file.size ?? file.buffer?.length ?? 0;
    const problem = checkDocumentFile(config, {
      name: original,
      mime_type: mime,
      size,
    });
    if (problem) {
      const tooLarge = size > config.max_size_mb * 1024 * 1024;
      throw new VendixHttpException(
        tooLarge ? ErrorCodes.DCOL_UPLOAD_002 : ErrorCodes.DCOL_UPLOAD_001,
        problem,
      );
    }
    const extension = original.split('.').pop() ?? '';
    if (!file.buffer || !matchesDeclaredSignature(mime, extension, file.buffer)) {
      throw new VendixHttpException(
        ErrorCodes.DCOL_UPLOAD_001,
        'El contenido del archivo no coincide con su tipo.',
      );
    }

    const key = `${prefix}/${submission.id}/${Date.now()}-${sanitizeUploadFileName(original)}`;
    const uploadedKey = await this.s3.uploadFile(file.buffer, key, mime);
    const url = (await this.sign(uploadedKey)) ?? null;
    this.logger.log(
      `Public document uploaded for submission ${submission.id}: ${uploadedKey}`,
    );
    return {
      key: uploadedKey,
      url,
      originalName: original,
      name: original,
      size,
      mime_type: mime,
      uploaded_at: new Date().toISOString(),
    };
  }

  /**
   * Validates the `{ files }` answer of a file field and returns what is
   * stored: `value_json = { files }` and `value_text` = first key (legacy readers).
   */
  async buildStoredValue(
    submission: SubmissionLike,
    fieldId: number,
    valueJson: unknown,
  ): Promise<{ value_json: { files: StoredDocument[] }; value_text: string | null }> {
    const rawFiles =
      valueJson && typeof valueJson === 'object'
        ? (valueJson as { files?: unknown }).files
        : undefined;
    if (!Array.isArray(rawFiles)) {
      throw new VendixHttpException(
        ErrorCodes.DCOL_UPLOAD_004,
        'Los archivos adjuntos no son válidos.',
      );
    }
    const files = readStoredDocuments({ value_json: valueJson });
    if (files.length !== rawFiles.length) {
      throw new VendixHttpException(
        ErrorCodes.DCOL_UPLOAD_004,
        'Los archivos adjuntos no son válidos.',
      );
    }

    const config = resolveDocumentConfig(
      this.findItem(submission, fieldId)?.validation_rules,
    );
    if (files.length > DOCUMENT_MAX_FILES || (!config.multiple && files.length > 1)) {
      throw new VendixHttpException(
        ErrorCodes.DCOL_UPLOAD_004,
        config.multiple
          ? `Máximo ${DOCUMENT_MAX_FILES} archivos por campo.`
          : 'Este campo admite un solo archivo.',
      );
    }

    const prefix = `${await this.storePrefix(submission.store_id)}/`;
    for (const doc of files) {
      if (!doc.key.startsWith(prefix) || doc.key.includes('..')) {
        throw new VendixHttpException(
          ErrorCodes.DCOL_UPLOAD_004,
          'Uno de los archivos no pertenece a esta tienda.',
        );
      }
    }
    return { value_json: { files }, value_text: files[0]?.key ?? null };
  }

  /** Adds a signed URL to each document; a signing failure leaves `url` null. */
  async signFiles(files: StoredDocument[]): Promise<SignedDocument[]> {
    return Promise.all(
      files.map(async (doc) => ({
        key: doc.key,
        name: doc.name,
        size: doc.size,
        mime_type: doc.mime_type,
        ...(doc.uploaded_at ? { uploaded_at: doc.uploaded_at } : {}),
        url: (await this.sign(doc.key)) ?? null,
      })),
    );
  }

  private async sign(key: string): Promise<string | undefined> {
    try {
      return await this.s3.signUrl(key);
    } catch (error) {
      this.logger.warn(`Could not sign ${key}: ${(error as Error).message}`);
      return undefined;
    }
  }
}
