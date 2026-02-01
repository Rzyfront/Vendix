import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { EcommercePrismaService } from '../../../../prisma/services/ecommerce-prisma.service';
import {
  AuditService,
  AuditAction,
} from '../../../../common/audit/audit.service';
import { S3Service } from '../../../../common/services/s3.service';

export interface PendingTermsNotification {
  document_id: number;
  document_type: string;
  title: string;
  current_version: string;
  user_version: string | null;
  effective_date: Date;
  is_system: boolean;
  content?: string;
}

export interface RequiredDocument {
  document_id: number;
  document_type: string;
  title: string;
  version: string;
  is_required: boolean;
  content?: string;
}

@Injectable()
export class LegalAcceptancesService {
  private readonly logger = new Logger(LegalAcceptancesService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly ecommercePrisma: EcommercePrismaService,
    private readonly auditService: AuditService,
    private readonly s3Service: S3Service,
  ) { }

  private async fetchContentFromS3(
    url: string | null,
  ): Promise<string | undefined> {
    if (!url) return undefined;
    try {
      const buffer = await this.s3Service.downloadImage(url);
      return buffer.toString('utf-8');
    } catch (error) {
      this.logger.error(
        `Error fetching document from S3 (${url}): ${error.message}`,
      );
      return undefined;
    }
  }

  async acceptDocument(
    userId: number,
    documentId: number,
    metadata: {
      ip: string;
      userAgent: string;
      context: 'onboarding' | 'dashboard' | 'settings';
    },
  ) {
    // Obtener el documento
    const document = await this.globalPrisma.legal_documents.findFirst({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // Verificar si el usuario ya aceptó esta versión
    const existing = await this.globalPrisma.document_acceptances.findFirst({
      where: {
        user_id: userId,
        document_id: documentId,
        acceptance_version: document.version,
      },
    });

    if (existing) {
      // Ya aceptó esta versión, retornar sin error
      return existing;
    }

    // Crear el registro de aceptación
    const acceptance = await this.globalPrisma.document_acceptances.create({
      data: {
        user_id: userId,
        document_id: documentId,
        acceptance_version: document.version,
        accepted_by_user_id: userId,
        ip_address: metadata.ip,
        user_agent: metadata.userAgent,
        metadata: {
          context: metadata.context,
        },
      },
    });

    // Actualizar el usuario con la versión aceptada
    await this.globalPrisma.users.update({
      where: { id: userId },
      data: {
        terms_accepted_version: document.version,
        terms_accepted_at: new Date(),
        requires_terms_update: false,
      },
    });

    // Auditar la aceptación
    await this.auditService.log({
      userId,
      action: AuditAction.CUSTOM,
      resource: 'legal_documents' as any,
      resourceId: documentId,
      newValues: {
        acceptance_version: document.version,
        context: metadata.context,
      },
      metadata: {
        ip: metadata.ip,
        userAgent: metadata.userAgent,
      },
    });

    return acceptance;
  }

  async checkRequiredAcceptances(userId: number): Promise<RequiredDocument[]> {
    // Obtener el usuario con su organización
    const user = await this.globalPrisma.users.findFirst({
      where: { id: userId },
      include: {
        organizations: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!user) {
      return [];
    }

    const requiredDocuments: RequiredDocument[] = [];

    // Verificar documentos obligatorios del sistema
    const systemDocuments = await this.globalPrisma.legal_documents.findMany({
      where: {
        is_system: true,
        document_type: {
          in: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'],
        },
        is_active: true,
        organization_id: null,
        store_id: null,
      },
    });

    for (const document of systemDocuments) {
      // Verificar si el usuario ha aceptado este documento
      const acceptance = await this.globalPrisma.document_acceptances.findFirst(
        {
          where: {
            user_id: userId,
            document_id: document.id,
            acceptance_version: document.version,
          },
        },
      );

      if (!acceptance) {
        requiredDocuments.push({
          document_id: document.id,
          document_type: document.document_type,
          title: document.title,
          version: document.version,
          is_required: true,
          content: await this.fetchContentFromS3(document.document_url),
        });
      }
    }

    return requiredDocuments;
  }

  async getUserAcceptanceHistory(userId: number) {
    return this.globalPrisma.document_acceptances.findMany({
      where: {
        user_id: userId,
      },
      include: {
        document: {
          select: {
            document_type: true,
            title: true,
            version: true,
            is_system: true,
          },
        },
      },
      orderBy: {
        accepted_at: 'desc',
      },
    });
  }

  async hasUserAcceptedDocument(
    userId: number,
    documentId: number,
  ): Promise<boolean> {
    const document = await this.globalPrisma.legal_documents.findFirst({
      where: { id: documentId },
    });

    if (!document) {
      return false;
    }

    const acceptance = await this.globalPrisma.document_acceptances.findFirst({
      where: {
        user_id: userId,
        document_id: documentId,
        acceptance_version: document.version,
      },
    });

    return !!acceptance;
  }

  async getPendingTermsForUser(
    userId: number,
  ): Promise<PendingTermsNotification[]> {
    // Obtener el usuario con su organización y tienda principal
    const user = await this.globalPrisma.users.findFirst({
      where: { id: userId },
      include: {
        organizations: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!user) {
      return [];
    }

    const pendingDocuments: PendingTermsNotification[] = [];

    // Obtener documentos activos del sistema
    const systemDocuments = await this.globalPrisma.legal_documents.findMany({
      where: {
        is_system: true,
        is_active: true,
        organization_id: null,
        store_id: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
      },
    });

    for (const document of systemDocuments) {
      // Verificar si el usuario ha aceptado la versión actual
      const acceptance = await this.globalPrisma.document_acceptances.findFirst(
        {
          where: {
            user_id: userId,
            document_id: document.id,
          },
          orderBy: {
            accepted_at: 'desc',
          },
        },
      );

      const hasAcceptedCurrentVersion =
        acceptance && acceptance.acceptance_version === document.version;

      if (!hasAcceptedCurrentVersion) {
        pendingDocuments.push({
          document_id: document.id,
          document_type: document.document_type,
          title: document.title,
          current_version: document.version,
          user_version: acceptance?.acceptance_version || null,
          effective_date: document.effective_date,
          is_system: true,
          content: await this.fetchContentFromS3(document.document_url),
        });
      }
    }

    // Obtener documentos activos de la organización del usuario
    if (user.organizations) {
      const orgDocuments = await this.globalPrisma.legal_documents.findMany({
        where: {
          is_system: false,
          is_active: true,
          organization_id: user.organizations.id,
          store_id: null,
          OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
        },
      });

      for (const document of orgDocuments) {
        const acceptance =
          await this.globalPrisma.document_acceptances.findFirst({
            where: {
              user_id: userId,
              document_id: document.id,
            },
            orderBy: {
              accepted_at: 'desc',
            },
          });

        const hasAcceptedCurrentVersion =
          acceptance && acceptance.acceptance_version === document.version;

        if (!hasAcceptedCurrentVersion) {
          pendingDocuments.push({
            document_id: document.id,
            document_type: document.document_type,
            title: document.title,
            current_version: document.version,
            user_version: acceptance?.acceptance_version || null,
            effective_date: document.effective_date,
            is_system: false,
            content: await this.fetchContentFromS3(document.document_url),
          });
        }
      }
    }

    return pendingDocuments;
  }

  async markUsersForUpdate(
    documentType: string,
    newVersion: string,
  ): Promise<void> {
    // Marcar usuarios que tienen la versión anterior como que requieren actualización
    await this.globalPrisma.users.updateMany({
      where: {
        terms_accepted_version: {
          not: newVersion,
        },
        state: 'active',
        email_verified: true,
      },
      data: {
        requires_terms_update: true,
      },
    });
  }

  async getPendingTermsForCustomer(
    storeId?: number,
    userId?: number,
  ): Promise<RequiredDocument[]> {
    // 1. Buscar documentos activos de la tienda usando el servicio de ecommerce (scoped)
    // Nota: El store_id se aplica automáticamente por EcommercePrismaService desde el contexto
    const storeDocuments = await this.ecommercePrisma.legal_documents.findMany({
      where: {
        is_active: true,
        is_system: false,
        OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
      },
    });

    // 2. Buscar documentos del sistema (para fallback)
    const systemDocuments = await this.globalPrisma.legal_documents.findMany({
      where: {
        is_system: true,
        is_active: true,
        organization_id: null,
        store_id: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
      },
    });

    // 3. Mapear tipos de documento a usar
    const documentsToRequire: RequiredDocument[] = [];
    const documentTypes = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];

    for (const type of documentTypes) {
      // Prioridad: store document over system document
      const storeDoc = storeDocuments.find((d) => d.document_type === type);
      const systemDoc = systemDocuments.find((d) => d.document_type === type);
      const docToUse = storeDoc || systemDoc;

      if (docToUse) {
        let hasAccepted = false;
        if (userId) {
          // Verificar si ya aceptó
          const accepted = await this.globalPrisma.document_acceptances.findFirst({
            where: {
              user_id: userId,
              document_id: docToUse.id,
              acceptance_version: docToUse.version,
            },
          });
          hasAccepted = !!accepted;
        }

        if (!hasAccepted) {
          documentsToRequire.push({
            document_id: docToUse.id,
            document_type: docToUse.document_type,
            title: docToUse.title,
            version: docToUse.version,
            is_required: true,
            content: await this.fetchContentFromS3(docToUse.document_url),
          });
        }
      }
    }

    return documentsToRequire;
  }
}
