import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { AuditService } from '../../../../common/audit/audit.service';
import {
  CreateSystemDocumentDto,
  LegalDocumentTypeEnum,
} from '../dto/create-system-document.dto';
import { UpdateSystemDocumentDto } from '../dto/update-system-document.dto';

interface AcceptanceFilters {
  startDate?: string;
  endDate?: string;
  organizationId?: number;
  userId?: number;
}

@Injectable()
export class LegalDocumentsService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ==========================================
  // SYSTEM DOCUMENTS CRUD
  // ==========================================

  async getSystemDocuments(filters?: {
    document_type?: LegalDocumentTypeEnum;
    is_active?: boolean;
  }) {
    return this.globalPrisma.legal_documents.findMany({
      where: {
        is_system: true,
        organization_id: null,
        store_id: null,
        ...filters,
      },
      orderBy: {
        effective_date: 'desc',
      },
    });
  }

  async getSystemDocument(id: number) {
    if (!id || isNaN(id)) {
      throw new NotFoundException('Invalid document ID');
    }

    const document = await this.globalPrisma.legal_documents.findFirst({
      where: {
        id,
        is_system: true,
      },
      include: {
        document_acceptances: {
          select: {
            id: true,
            user_id: true,
            acceptance_version: true,
            accepted_at: true,
          },
          orderBy: {
            accepted_at: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  async getActiveSystemDocument(documentType: LegalDocumentTypeEnum) {
    const document = await this.globalPrisma.legal_documents.findFirst({
      where: {
        document_type: documentType,
        is_active: true,
        is_system: true,
        organization_id: null,
        store_id: null,
        OR: [
          { expiry_date: null },
          { expiry_date: { gte: new Date() } },
        ],
      },
      orderBy: {
        effective_date: 'desc',
      },
    });

    return document;
  }

  async createSystemDocument(
    userId: number,
    dto: CreateSystemDocumentDto,
  ) {
    // Verificar si ya existe una versión con ese número
    const existing = await this.globalPrisma.legal_documents.findFirst({
      where: { version: dto.version },
    });

    if (existing) {
      throw new BadRequestException(
        `Document version ${dto.version} already exists`,
      );
    }

    // Si se está creando una nueva versión activa, desactivar la anterior
    if (dto.effective_date) {
      const effectiveDate = new Date(dto.effective_date);
      const now = new Date();

      if (effectiveDate <= now) {
        // Desactivar versiones anteriores del mismo tipo
        await this.globalPrisma.legal_documents.updateMany({
          where: {
            document_type: dto.document_type,
            is_active: true,
            is_system: true,
            organization_id: null,
            store_id: null,
          },
          data: {
            is_active: false,
          },
        });
      }
    }

    const document = await this.globalPrisma.legal_documents.create({
      data: {
        ...dto,
        effective_date: new Date(dto.effective_date),
        expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : null,
        is_system: true,
        created_by_user_id: userId,
      },
    });

    // Auditar la creación
    await this.auditService.logCreate(
      userId,
      'legal_documents' as any,
      document.id,
      { document_type: dto.document_type, version: dto.version },
      { action: 'create_system_legal_document' },
    );

    return document;
  }

  async updateSystemDocument(
    id: number,
    userId: number,
    dto: UpdateSystemDocumentDto,
  ) {
    const document = await this.getSystemDocument(id);

    // No permitir cambiar la versión (es inmutable)
    if (dto.version && dto.version !== document.version) {
      throw new BadRequestException(
        'Cannot change document version. Create a new document instead.',
      );
    }

    const updated = await this.globalPrisma.legal_documents.update({
      where: { id },
      data: {
        ...dto,
        effective_date: dto.effective_date
          ? new Date(dto.effective_date)
          : undefined,
        expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : undefined,
      },
    });

    // Auditar la actualización
    await this.auditService.logUpdate(
      userId,
      'legal_documents' as any,
      id,
      { title: document.title },
      { title: dto.title },
      { action: 'update_system_legal_document' },
    );

    return updated;
  }

  async activateDocument(id: number, userId: number) {
    const document = await this.getSystemDocument(id);

    // Desactivar otras versiones activas del mismo tipo
    await this.globalPrisma.legal_documents.updateMany({
      where: {
        document_type: document.document_type,
        is_active: true,
        is_system: true,
        id: { not: id },
        organization_id: null,
        store_id: null,
      },
      data: {
        is_active: false,
      },
    });

    // Activar este documento
    const updated = await this.globalPrisma.legal_documents.update({
      where: { id },
      data: { is_active: true },
    });

    // Auditar
    await this.auditService.logCustom(
      userId,
      'activate_legal_document',
      'legal_documents',
      { document_id: id, version: document.version },
    );

    return updated;
  }

  async deactivateDocument(id: number, userId: number) {
    const document = await this.getSystemDocument(id);

    const updated = await this.globalPrisma.legal_documents.update({
      where: { id },
      data: { is_active: false },
    });

    // Auditar
    await this.auditService.logCustom(
      userId,
      'deactivate_legal_document',
      'legal_documents',
      { document_id: id, version: document.version },
    );

    return updated;
  }

  // ==========================================
  // DOCUMENT HISTORY
  // ==========================================

  async getDocumentHistory(documentType: LegalDocumentTypeEnum) {
    return this.globalPrisma.legal_documents.findMany({
      where: {
        document_type: documentType,
        is_system: true,
        organization_id: null,
        store_id: null,
      },
      orderBy: {
        effective_date: 'desc',
      },
    });
  }

  // ==========================================
  // ACCEPTANCES REPORTING
  // ==========================================

  async getDocumentAcceptances(documentId: number, filters?: AcceptanceFilters) {
    const where: any = { document_id: documentId };

    if (filters?.startDate || filters?.endDate) {
      where.accepted_at = {};
      if (filters.startDate) {
        where.accepted_at.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.accepted_at.lte = new Date(filters.endDate);
      }
    }

    if (filters?.userId) {
      where.user_id = filters.userId;
    }

    const acceptances = await this.globalPrisma.document_acceptances.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            organization_id: true,
          },
        },
        document: {
          select: {
            document_type: true,
            title: true,
            version: true,
          },
        },
      },
      orderBy: {
        accepted_at: 'desc',
      },
    });

    // Filtrar por organización si se proporciona
    if (filters?.organizationId) {
      return acceptances.filter(
        (a) => a.user.organization_id === filters.organizationId,
      );
    }

    return acceptances;
  }

  async getUsersPendingAcceptance(documentType: LegalDocumentTypeEnum) {
    // Obtener el documento activo
    const activeDocument = await this.getActiveSystemDocument(documentType);

    if (!activeDocument) {
      return [];
    }

    // Obtener usuarios que no han aceptado esta versión
    const allUsers = await this.globalPrisma.users.findMany({
      where: {
        state: 'active',
        email_verified: true,
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        organization_id: true,
        document_acceptances: {
          where: {
            document_id: activeDocument.id,
          },
          select: {
            acceptance_version: true,
            accepted_at: true,
          },
        },
      },
    });

    // Filtrar usuarios que no han aceptado la versión actual
    const pendingUsers = allUsers.filter(
      (user) =>
        !user.document_acceptances ||
        user.document_acceptances.length === 0 ||
        user.document_acceptances[0].acceptance_version !==
          activeDocument.version,
    );

    return pendingUsers.map((user) => ({
      ...user,
      required_version: activeDocument.version,
      current_version:
        user.document_acceptances?.[0]?.acceptance_version || null,
      last_accepted: user.document_acceptances?.[0]?.accepted_at || null,
    }));
  }

  async getAcceptanceStats(documentId: number) {
    const totalUsers = await this.globalPrisma.users.count({
      where: {
        state: 'active',
        email_verified: true,
      },
    });

    const acceptances = await this.globalPrisma.document_acceptances.groupBy({
      by: ['acceptance_version'],
      where: {
        document_id: documentId,
      },
      _count: {
        acceptance_version: true,
      },
    });

    const totalAcceptances = acceptances.reduce(
      (sum, a) => sum + a._count.acceptance_version,
      0,
    );

    return {
      total_users: totalUsers,
      total_acceptances: totalAcceptances,
      acceptance_rate: totalUsers > 0 ? totalAcceptances / totalUsers : 0,
      by_version: acceptances,
    };
  }

  // ==========================================
  // PDF UPLOAD
  // ==========================================

  // TODO: Implement S3 upload for PDF documents
  // async uploadDocumentPDF(
  //   file: Buffer,
  //   documentId: number,
  //   filename: string,
  // ): Promise<string> {
  //   const key = `legal-documents/${documentId}/${filename}`;
  //   const url = await this.s3Service.uploadFile(
  //     file,
  //     key,
  //     'application/pdf',
  //   );
  //   await this.globalPrisma.legal_documents.update({
  //     where: { id: documentId },
  //     data: { document_url: url },
  //   });
  //   return url;
  // }
}
