import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { AuditService } from '../../../../common/audit/audit.service';
import { S3Service } from '../../../../common/services/s3.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
    CreateStoreDocumentDto,
    StoreLegalDocumentTypeEnum,
} from '../dto/create-store-document.dto';
import { UpdateStoreDocumentDto } from '../dto/update-store-document.dto';

@Injectable()
export class StoreLegalDocumentsService {
    constructor(
        private readonly globalPrisma: GlobalPrismaService,
        private readonly auditService: AuditService,
        private readonly s3Service: S3Service,
    ) { }

    async getDocuments(filters?: {
        document_type?: StoreLegalDocumentTypeEnum;
        is_active?: boolean;
        search?: string;
    }) {
        const storeId = RequestContextService.getStoreId();
        if (!storeId) {
            throw new BadRequestException('Store context required');
        }

        const where: any = {
            store_id: storeId,
            is_system: false,
        };

        if (filters?.document_type) {
            where.document_type = filters.document_type;
        }

        if (filters?.is_active !== undefined) {
            where.is_active = filters.is_active;
        }

        if (filters?.search) {
            where.title = {
                contains: filters.search,
                mode: 'insensitive',
            };
        }

        return this.globalPrisma.legal_documents.findMany({
            where,
            orderBy: {
                effective_date: 'desc',
            },
        });
    }

    async getDocument(id: number) {
        const storeId = RequestContextService.getStoreId();
        if (!storeId) {
            throw new BadRequestException('Store context required');
        }

        const document = await this.globalPrisma.legal_documents.findFirst({
            where: {
                id,
                store_id: storeId,
                is_system: false,
            },
        });

        if (!document) {
            throw new NotFoundException('Document not found');
        }

        // Fetch content from S3 if document_url exists
        if (document.document_url) {
            try {
                const buffer = await this.s3Service.downloadImage(document.document_url);
                document.content = buffer.toString('utf-8');
            } catch (error) {
                console.error(`Error fetching document from S3: ${error.message}`);
            }
        }

        return document;
    }

    async createDocument(userId: number, dto: CreateStoreDocumentDto) {
        const storeId = RequestContextService.getStoreId();
        if (!storeId) {
            throw new BadRequestException('Store context required');
        }

        // Verificar si ya existe esa versión para esta tienda
        const existing = await this.globalPrisma.legal_documents.findFirst({
            where: {
                version: dto.version,
                store_id: storeId,
            },
        });

        if (existing) {
            throw new BadRequestException(
                `Document version ${dto.version} already exists for this store`,
            );
        }

        // Upload to S3
        const s3Key = `legal-documents/stores/${storeId}/${dto.document_type.toLowerCase()}/${dto.version}.md`;
        await this.s3Service.uploadFile(
            Buffer.from(dto.content, 'utf-8'),
            s3Key,
            'text/markdown',
        );

        // Si se está creando una nueva versión activa, desactivar las anteriores del mismo tipo en esta tienda
        if (dto.effective_date) {
            const effectiveDate = new Date(dto.effective_date);
            const now = new Date();

            if (effectiveDate <= now) {
                await this.globalPrisma.legal_documents.updateMany({
                    where: {
                        document_type: dto.document_type as any,
                        is_active: true,
                        store_id: storeId,
                    },
                    data: {
                        is_active: false,
                    },
                });
            }
        }

        const document = await this.globalPrisma.legal_documents.create({
            data: {
                document_type: dto.document_type as any,
                title: dto.title,
                version: dto.version,
                content: dto.content,
                description: dto.description,
                effective_date: new Date(dto.effective_date),
                expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : null,
                is_active: true,
                is_system: false,
                document_url: s3Key,
                store_id: storeId,
                organization_id: RequestContextService.getOrganizationId(),
                created_by_user_id: userId,
            },
        });

        // Auditar
        await this.auditService.logCreate(
            userId,
            'legal_documents' as any,
            document.id,
            { document_type: dto.document_type, version: dto.version },
            { action: 'create_store_legal_document' },
        );

        return document;
    }

    async updateDocument(id: number, userId: number, dto: UpdateStoreDocumentDto) {
        const storeId = RequestContextService.getStoreId();
        if (!storeId) {
            throw new BadRequestException('Store context required');
        }

        const document = await this.getDocument(id);

        // Inmutable properties
        if (dto.version && dto.version !== document.version) {
            throw new BadRequestException('Version is immutable');
        }

        const updated = await this.globalPrisma.legal_documents.update({
            where: { id },
            data: {
                title: dto.title,
                description: dto.description,
                effective_date: dto.effective_date ? new Date(dto.effective_date) : undefined,
                expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : undefined,
            },
        });

        // Auditar
        await this.auditService.logUpdate(
            userId,
            'legal_documents' as any,
            id,
            { title: document.title },
            { title: dto.title },
            { action: 'update_store_legal_document' },
        );

        return updated;
    }

    async activateDocument(id: number, userId: number) {
        const storeId = RequestContextService.getStoreId();
        if (!storeId) {
            throw new BadRequestException('Store context required');
        }

        const document = await this.getDocument(id);

        // Desactivar versiones activas del mismo tipo en esta tienda
        await this.globalPrisma.legal_documents.updateMany({
            where: {
                document_type: document.document_type,
                is_active: true,
                store_id: storeId,
                id: { not: id },
            },
            data: {
                is_active: false,
            },
        });

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
        const storeId = RequestContextService.getStoreId();
        const document = await this.getDocument(id);

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

    async deleteDocument(id: number, userId: number) {
        const document = await this.getDocument(id);

        // No permitir eliminar si está activo
        if (document.is_active) {
            throw new BadRequestException('Cannot delete an active document');
        }

        await this.globalPrisma.legal_documents.delete({
            where: { id },
        });

        // Auditar
        await this.auditService.logDelete(
            userId,
            'legal_documents' as any,
            id,
            { title: document.title, version: document.version },
            { action: 'delete_store_legal_document' },
        );

        return { success: true };
    }
}
