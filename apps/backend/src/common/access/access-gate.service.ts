import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AccessAuditLogger } from './access-audit.logger';
import { AccessGateModeService } from './access-gate-mode.service';
import { AccessAuditBatchDto } from './dto/access-audit-events.dto';
import { AccessGateMode } from './access-audit.types';
import { normalizeModuleIndustries } from './module-industries';
import { resolveOrganizationIndustries } from './organization-industries';

/** Subset of the JWT-derived `req.user` the gate reads. */
export interface AccessGateIdentity {
  id?: number | null;
  store_id?: number | null;
  organization_id?: number | null;
  roles?: string[] | null;
}

export interface AccessGateState {
  mode: AccessGateMode;
  industries: string[];
}

/**
 * apps-f4 S8 — read side (`GET .../access-gate`) and frontend audit ingestion.
 * Identity always comes from the authenticated request, never from the body.
 */
@Injectable()
export class AccessGateService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly modeService: AccessGateModeService,
    private readonly auditLogger: AccessAuditLogger,
  ) {}

  async storeIndustries(storeId: number | null | undefined) {
    if (!storeId) return normalizeModuleIndustries([]);
    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });
    return normalizeModuleIndustries(store?.industries);
  }

  async getStoreState(user: AccessGateIdentity): Promise<AccessGateState> {
    const industries = await this.storeIndustries(user.store_id);
    const mode = user.store_id
      ? await this.modeService.modeForStore(user.store_id)
      : 'audit';
    return { mode, industries };
  }

  async getOrganizationState(
    user: AccessGateIdentity,
  ): Promise<AccessGateState & { org_panel_ui: Record<string, boolean> | null }> {
    const orgId = user.organization_id ?? null;
    const industries = orgId
      ? await resolveOrganizationIndustries(this.globalPrisma, orgId)
      : normalizeModuleIndustries([]);
    const mode = await this.modeService.modeForOrganization();
    return { mode, industries, org_panel_ui: await this.orgPanelUi(orgId) };
  }

  async recordStoreEvents(
    user: AccessGateIdentity,
    body: AccessAuditBatchDto,
  ): Promise<{ recorded: number }> {
    const industries = await this.storeIndustries(user.store_id);
    const mode = user.store_id
      ? await this.modeService.modeForStore(user.store_id)
      : 'audit';
    return this.write(user, body, industries, mode, user.store_id ?? null);
  }

  async recordOrganizationEvents(
    user: AccessGateIdentity,
    body: AccessAuditBatchDto,
  ): Promise<{ recorded: number }> {
    const orgId = user.organization_id ?? null;
    const industries = orgId
      ? await resolveOrganizationIndustries(this.globalPrisma, orgId)
      : normalizeModuleIndustries([]);
    const mode = await this.modeService.modeForOrganization();
    return this.write(user, body, industries, mode, null);
  }

  private write(
    user: AccessGateIdentity,
    body: AccessAuditBatchDto,
    industries: string[],
    mode: AccessGateMode,
    storeId: number | null,
  ): { recorded: number } {
    for (const event of body.events) {
      this.auditLogger.record({
        source: 'frontend',
        surface: event.surface,
        store_id: storeId,
        organization_id: user.organization_id ?? null,
        user_id: user.id ?? null,
        role: Array.isArray(user.roles) ? (user.roles[0] ?? null) : null,
        key: event.key,
        industry: industries,
        decision: event.decision,
        layer: event.layer,
        route: event.route ?? null,
        mode,
      });
    }
    return { recorded: body.events.length };
  }

  private async orgPanelUi(
    organizationId: number | null,
  ): Promise<Record<string, boolean> | null> {
    if (!organizationId) return null;
    const row = await this.globalPrisma.organization_settings.findUnique({
      where: { organization_id: organizationId },
      select: { settings: true },
    });
    const panelUi = (row?.settings as any)?.panel_ui?.ORG_ADMIN;
    return panelUi && typeof panelUi === 'object' ? panelUi : null;
  }
}
