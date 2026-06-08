import { Injectable, Logger } from '@nestjs/common';
import { legal_document_type_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '../../../common/services/s3.service';

/**
 * Public-safe representation of an active system legal document.
 *
 * Only the whitelisted fields below are ever exposed. Internal metadata such as
 * created_by_user_id, organization_id, store_id, is_system, is_active,
 * document_url, and expiry_date are intentionally excluded.
 */
export interface PublicLegalDocumentDto {
  id: number;
  document_type: legal_document_type_enum;
  title: string;
  version: string;
  content: string;
  effective_date: Date;
  description: string | null;
}

/**
 * 📜 PublicLegalService
 *
 * Returns the active system (platform) legal document for a given type so the
 * marketing/landing page can render Terms, Privacy, and Cookies straight from
 * the database. Uses the GLOBAL Prisma source (not scoped) because the public
 * endpoint has no tenant context.
 *
 * The active-document query mirrors the super-admin
 * LegalDocumentsService.getActiveSystemDocument exactly, including the S3
 * content hydration when a document_url is present.
 */
@Injectable()
export class PublicLegalService {
  private readonly logger = new Logger(PublicLegalService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async getActiveSystemDocument(
    documentType: legal_document_type_enum,
  ): Promise<PublicLegalDocumentDto | null> {
    const document = await this.globalPrisma.legal_documents.findFirst({
      where: {
        document_type: documentType,
        is_active: true,
        is_system: true,
        organization_id: null,
        store_id: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
      },
      orderBy: {
        effective_date: 'desc',
      },
    });

    if (!document) {
      return null;
    }

    if (document.document_url) {
      try {
        const buffer = await this.s3Service.downloadImage(
          document.document_url,
        );
        document.content = buffer.toString('utf-8');
      } catch (error) {
        this.logger.error(
          `Error fetching active document from S3: ${(error as Error).message}`,
        );
      }
    }

    // Explicit public-safe whitelist (no created_by_user_id, organization_id,
    // store_id, is_system, is_active, document_url, expiry_date, ...).
    return {
      id: document.id,
      document_type: document.document_type,
      title: document.title,
      version: document.version,
      content: document.content,
      effective_date: document.effective_date,
      description: document.description,
    };
  }
}
