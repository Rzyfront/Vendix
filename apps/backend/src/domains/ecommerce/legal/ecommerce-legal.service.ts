import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { S3Service } from '../../../common/services/s3.service';

export interface RequiredDocument {
    document_id: number;
    document_type: string;
    title: string;
    version: string;
    is_required: boolean;
    content?: string;
}

@Injectable()
export class EcommerceLegalService {
    private readonly logger = new Logger(EcommerceLegalService.name);

    constructor(
        private readonly ecommercePrisma: EcommercePrismaService,
        private readonly globalPrisma: GlobalPrismaService,
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

    async getPendingTermsForCustomer(
        userId?: number,
    ): Promise<RequiredDocument[]> {
        // 1. Buscar documentos activos de la tienda (Scoped automatically)
        const storeDocuments = await this.ecommercePrisma.legal_documents.findMany({
            where: {
                is_active: true,
                is_system: false,
                OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
            },
        });

        // 2. Buscar documentos del sistema (Fallback - Global)
        const systemDocuments = await this.globalPrisma.legal_documents.findMany({
            where: {
                is_system: true,
                is_active: true,
                organization_id: null,
                store_id: null,
                OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
            },
        });

        // 3. Determinar qué documentos usar (Store OR System, not mixed)
        // Regla: Si la tienda tiene documentos, se ignoran los del sistema.
        // Si la tienda NO tiene documentos, se usan los del sistema.
        const useStoreDocs = storeDocuments.length > 0;
        const sourceDocuments = useStoreDocs ? storeDocuments : systemDocuments;

        const documentsToRequire: RequiredDocument[] = [];
        const documentTypes = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];

        for (const type of documentTypes) {
            const docToUse = sourceDocuments.find((d) => d.document_type === type);

            if (docToUse) {
                let hasAccepted = false;
                if (userId) {
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

    async acceptDocument(
        userId: number,
        documentId: number,
        metadata: {
            ip: string;
            userAgent: string;
            context: 'ecommerce';
        },
    ) {
        // Obtener el documento (Global since we have the ID)
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
            return existing;
        }

        // Crear el registro de aceptación
        return this.globalPrisma.document_acceptances.create({
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
    }
}
