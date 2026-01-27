import { Injectable } from "@nestjs/common";
import { GlobalPrismaService } from "../../../../prisma/services/global-prisma.service";
import {
  AuditService,
  AuditAction,
} from "../../../../common/audit/audit.service";

export interface PendingTermsNotification {
  document_id: number;
  document_type: string;
  title: string;
  current_version: string;
  user_version: string | null;
  effective_date: Date;
  is_system: boolean;
}

export interface RequiredDocument {
  document_id: number;
  document_type: string;
  title: string;
  version: string;
  is_required: boolean;
}

@Injectable()
export class LegalAcceptancesService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly auditService: AuditService,
  ) {}

  async acceptDocument(
    userId: number,
    documentId: number,
    metadata: {
      ip: string;
      userAgent: string;
      context: "onboarding" | "dashboard" | "settings";
    },
  ) {
    const document = await this.globalPrisma.legal_documents.findFirst({ where: { id: documentId } });
    if (!document) throw new Error("Document not found");
    const existing = await this.globalPrisma.document_acceptances.findFirst({ where: { user_id: userId, document_id: documentId, acceptance_version: document.version } });
    if (existing) return existing;
    const acceptance = await this.globalPrisma.document_acceptances.create({ data: { user_id: userId, document_id: documentId, acceptance_version: document.version, accepted_by_user_id: userId, ip_address: metadata.ip, user_agent: metadata.userAgent, metadata: { context: metadata.context } } });
    await this.globalPrisma.users.update({ where: { id: userId }, data: { terms_accepted_version: document.version, terms_accepted_at: new Date(), requires_terms_update: false } });
    await this.auditService.log({ userId, action: AuditAction.CUSTOM, resource: "legal_documents" as any, resourceId: documentId, newValues: { acceptance_version: document.version, context: metadata.context }, metadata: { ip: metadata.ip, userAgent: metadata.userAgent } });
    return acceptance;
  }

  async checkRequiredAcceptances(userId: number): Promise<RequiredDocument[]> {
    const user = await this.globalPrisma.users.findFirst({ where: { id: userId }, include: { organizations: { select: { id: true } } } });
    if (!user) return [];
    const requiredDocuments: RequiredDocument[] = [];
    const systemDocuments = await this.globalPrisma.legal_documents.findMany({ where: { is_system: true, document_type: { in: ["TERMS_OF_SERVICE", "PRIVACY_POLICY"] }, is_active: true, organization_id: null, store_id: null } });
    for (const document of systemDocuments) {
      const acceptance = await this.globalPrisma.document_acceptances.findFirst({ where: { user_id: userId, document_id: document.id, acceptance_version: document.version } });
      if (!acceptance) requiredDocuments.push({ document_id: document.id, document_type: document.document_type, title: document.title, version: document.version, is_required: true });
    }
    return requiredDocuments;
  }

  async getUserAcceptanceHistory(userId: number) {
    return this.globalPrisma.document_acceptances.findMany({ where: { user_id: userId }, include: { document: { select: { document_type: true, title: true, version: true, is_system: true } } }, orderBy: { accepted_at: "desc" } });
  }

  async hasUserAcceptedDocument(userId: number, documentId: number): Promise<boolean> {
    const document = await this.globalPrisma.legal_documents.findFirst({ where: { id: documentId } });
    if (!document) return false;
    const acceptance = await this.globalPrisma.document_acceptances.findFirst({ where: { user_id: userId, document_id: documentId, acceptance_version: document.version } });
    return !!acceptance;
  }

  async getPendingTermsForUser(userId: number): Promise<PendingTermsNotification[]> {
    const user = await this.globalPrisma.users.findFirst({ where: { id: userId }, include: { organizations: { select: { id: true } } } });
    if (!user) return [];
    const pendingDocuments: PendingTermsNotification[] = [];
    const systemDocuments = await this.globalPrisma.legal_documents.findMany({ where: { is_system: true, is_active: true, organization_id: null, store_id: null, OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }] } });
    for (const document of systemDocuments) {
      const acceptance = await this.globalPrisma.document_acceptances.findFirst({ where: { user_id: userId, document_id: document.id }, orderBy: { accepted_at: "desc" } });
      if (!acceptance || acceptance.acceptance_version !== document.version) pendingDocuments.push({ document_id: document.id, document_type: document.document_type, title: document.title, current_version: document.version, user_version: acceptance?.acceptance_version || null, effective_date: document.effective_date, is_system: true });
    }
    if (user.organizations) {
      const orgDocuments = await this.globalPrisma.legal_documents.findMany({ where: { is_system: false, is_active: true, organization_id: user.organizations.id, store_id: null, OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }] } });
      for (const document of orgDocuments) {
        const acceptance = await this.globalPrisma.document_acceptances.findFirst({ where: { user_id: userId, document_id: document.id }, orderBy: { accepted_at: "desc" } });
        if (!acceptance || acceptance.acceptance_version !== document.version) pendingDocuments.push({ document_id: document.id, document_type: document.document_type, title: document.title, current_version: document.version, user_version: acceptance?.acceptance_version || null, effective_date: document.effective_date, is_system: false });
      }
    }
    return pendingDocuments;
  }

  async markUsersForUpdate(documentType: string, newVersion: string): Promise<void> {
    await this.globalPrisma.users.updateMany({ where: { terms_accepted_version: { not: newVersion }, state: "active", email_verified: true }, data: { requires_terms_update: true } });
  }
}
