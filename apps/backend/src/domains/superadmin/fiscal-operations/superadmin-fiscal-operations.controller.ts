import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { PlatformOrgService } from '@common/services/platform-org.service';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalOperationsContext } from '../../fiscal-operations/services/fiscal-context-resolver.service';
import { FiscalFlowStateService } from '../../fiscal-operations/services/fiscal-flow-state.service';
import { FiscalObligationService } from '../../fiscal-operations/services/fiscal-obligation.service';
import { TaxDeclarationDraftService } from '../../fiscal-operations/services/tax-declaration-draft.service';
import { FiscalCloseService } from '../../fiscal-operations/services/fiscal-close.service';
import { FiscalEvidenceService } from '../../fiscal-operations/services/fiscal-evidence.service';
import { FiscalRulesService } from '../../fiscal-operations/services/fiscal-rules.service';
import { FiscalAuditService } from '../../fiscal-operations/services/fiscal-audit.service';
import { FiscalConfigChecklistService } from '../../fiscal-operations/services/fiscal-config-checklist.service';
import {
  AttachFiscalEvidenceDto,
  ChangeFiscalObligationStatusDto,
  CreateFiscalCloseSessionDto,
  CreateTaxDeclarationDraftDto,
  FiscalCloseQueryDto,
  FiscalFlowStateQueryDto,
  FiscalHistoryQueryDto,
  FiscalListQueryDto,
  FiscalRulesQueryDto,
  GenerateFiscalObligationsDto,
  MarkFiscalSubmittedDto,
  OverrideFiscalCloseCheckDto,
  ReopenFiscalCloseDto,
} from '../../fiscal-operations/dto/fiscal-operations.dto';
import {
  CreateFiscalRuleSetDto,
  UpdateFiscalRuleSetDto,
} from '../../fiscal-operations/dto/fiscal-rules.dto';
import {
  FISCAL_RESPONSIBILITIES_CATALOG,
  FISCAL_RESPONSIBILITIES_CATALOG_VERSION,
} from '../../fiscal-operations/constants/fiscal-responsibilities.catalog';
import { UpdateOrgFiscalDataDto } from '../../organization/settings/dto/update-org-fiscal-data.dto';

/**
 * Super-admin mirror of the store-level fiscal operations controller.
 *
 * Same routes, DTOs and permission shape as `StoreFiscalController` (and the
 * organization counterpart) but mounted at `/super-admin/fiscal` and
 * operating on the Vendix platform organization. The platform org is resolved
 * via `PlatformOrgService` and then a forged `RequestContext` is injected
 * via `RequestContextService.run()` so the underlying fiscal-operations
 * services (which read tenant info from `RequestContextService.getContext()`)
 * reuse their existing code paths without modification.
 */
@Controller('super-admin/fiscal')
@UseGuards(PermissionsGuard)
export class SuperadminFiscalOperationsController {
  constructor(
    private readonly platformOrgService: PlatformOrgService,
    private readonly flowState: FiscalFlowStateService,
    private readonly obligations: FiscalObligationService,
    private readonly declarations: TaxDeclarationDraftService,
    private readonly closeService: FiscalCloseService,
    private readonly evidence: FiscalEvidenceService,
    private readonly rules: FiscalRulesService,
    private readonly audit: FiscalAuditService,
    private readonly checklist: FiscalConfigChecklistService,
    private readonly prisma: GlobalPrismaService,
    private readonly response: ResponseService,
  ) {}

  /**
   * Resolve the platform org + forge a `RequestContext` for the duration of
   * the wrapped service call. The inner `fiscalContext` is derived from the
   * same platform data and is what the fiscal-operations services consume.
   *
   * Throws `SYS_NOT_FOUND_001` when the platform org is not bootstrapped.
   */
  private async runAsPlatform<T>(
    permissions: string[],
    fn: (ctx: FiscalOperationsContext) => Promise<T>,
  ): Promise<T> {
    const platform = await this.platformOrgService.getPlatformContext();
    if (!platform) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Platform org not bootstrapped',
      );
    }

    const fiscalContext: FiscalOperationsContext = {
      organization_id: platform.organization_id,
      store_id: null,
      fiscal_scope: platform.fiscal_scope,
      operating_scope: platform.operating_scope,
      accounting_entity_id: platform.accounting_entity_id,
      accounting_entity: { id: platform.accounting_entity_id },
    };

    return RequestContextService.run(
      {
        user_id: undefined,
        organization_id: platform.organization_id,
        store_id: undefined,
        app_type: 'VENDIX_ADMIN',
        roles: ['super_admin'],
        permissions,
        is_super_admin: true,
        is_owner: false,
      },
      () => fn(fiscalContext),
    );
  }

  // ----------------------------------------------------------------------
  // Overview / dashboard
  // ----------------------------------------------------------------------

  @Get('overview')
  @Permissions('superadmin:fiscal:dashboard:read')
  async overview() {
    return this.response.success(
      await this.runAsPlatform(['superadmin:fiscal:dashboard:read'], (ctx) =>
        this.obligations.getOverview([ctx]),
      ),
    );
  }

  @Get('flow-state')
  @Permissions('superadmin:fiscal:dashboard:read')
  async getFlowState(@Query() query: FiscalFlowStateQueryDto) {
    return this.response.success(
      await this.runAsPlatform(['superadmin:fiscal:dashboard:read'], (ctx) =>
        this.flowState.getFlowState([ctx], query),
      ),
    );
  }

  // ----------------------------------------------------------------------
  // History / audit
  // ----------------------------------------------------------------------

  @Get('history')
  @Permissions('superadmin:fiscal:history:read')
  async listHistory(@Query() query: FiscalHistoryQueryDto) {
    const result = await this.runAsPlatform(
      ['superadmin:fiscal:history:read'],
      (ctx) => this.audit.list([ctx], query),
    );
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  // ----------------------------------------------------------------------
  // Obligations
  // ----------------------------------------------------------------------

  @Get('obligations')
  @Permissions('superadmin:fiscal:obligations:read')
  async listObligations(@Query() query: FiscalListQueryDto) {
    const result = await this.runAsPlatform(
      ['superadmin:fiscal:obligations:read'],
      (ctx) => this.obligations.list([ctx], query),
    );
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Post('obligations/generate')
  @Permissions('superadmin:fiscal:obligations:write')
  async generateObligations(@Body() dto: GenerateFiscalObligationsDto) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:obligations:write'],
        (ctx) => this.obligations.generateForContext(ctx, dto),
      ),
      'Fiscal obligations generated',
    );
  }

  @Get('obligations/:id')
  @Permissions('superadmin:fiscal:obligations:read')
  async getObligation(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.runAsPlatform(
        ['superadmin:fiscal:obligations:read'],
        (ctx) => this.obligations.findOne([ctx], id),
      ),
    );
  }

  @Patch('obligations/:id/status')
  @Permissions('superadmin:fiscal:obligations:write')
  async updateObligationStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeFiscalObligationStatusDto,
  ) {
    return this.response.updated(
      await this.runAsPlatform(
        ['superadmin:fiscal:obligations:write'],
        (ctx) => this.obligations.updateStatus([ctx], id, dto),
      ),
      'Fiscal obligation status updated',
    );
  }

  @Post('obligations/:id/evidence')
  @Permissions('superadmin:fiscal:evidence:write')
  async attachObligationEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:evidence:write'],
        (ctx) => this.evidence.attachToObligation([ctx], id, dto),
      ),
    );
  }

  // ----------------------------------------------------------------------
  // Declarations
  // ----------------------------------------------------------------------

  @Get('declarations')
  @Permissions('superadmin:fiscal:declarations:read')
  async listDeclarations(@Query() query: FiscalListQueryDto) {
    const result = await this.runAsPlatform(
      ['superadmin:fiscal:declarations:read'],
      (ctx) => this.declarations.list([ctx], query),
    );
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Post('declarations/draft')
  @Permissions('superadmin:fiscal:declarations:write')
  async createDraft(@Body() dto: CreateTaxDeclarationDraftDto) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:declarations:write'],
        (ctx) => this.declarations.createDraft(ctx, dto),
      ),
    );
  }

  @Get('declarations/:id')
  @Permissions('superadmin:fiscal:declarations:read')
  async getDeclaration(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.runAsPlatform(
        ['superadmin:fiscal:declarations:read'],
        (ctx) => this.declarations.findOne([ctx], id),
      ),
    );
  }

  @Get('declarations/:id/lines')
  @Permissions('superadmin:fiscal:declarations:read')
  async getDeclarationLines(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.runAsPlatform(
        ['superadmin:fiscal:declarations:read'],
        (ctx) => this.declarations.getLines([ctx], id),
      ),
    );
  }

  @Patch('declarations/:id/recalculate')
  @Permissions('superadmin:fiscal:declarations:write')
  async recalculateDeclaration(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.runAsPlatform(
        ['superadmin:fiscal:declarations:write'],
        (ctx) => this.declarations.recalculateDraft([ctx], id),
      ),
    );
  }

  @Patch('declarations/:id/approve')
  @Permissions('superadmin:fiscal:declarations:write')
  async approveDeclaration(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.runAsPlatform(
        ['superadmin:fiscal:declarations:write'],
        (ctx) => this.declarations.approveDraft([ctx], id),
      ),
    );
  }

  @Patch('declarations/:id/mark-submitted')
  @Permissions('superadmin:fiscal:declarations:write')
  async markDeclarationSubmitted(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkFiscalSubmittedDto,
  ) {
    return this.response.updated(
      await this.runAsPlatform(
        ['superadmin:fiscal:declarations:write'],
        (ctx) => this.declarations.markSubmitted([ctx], id, dto),
      ),
    );
  }

  @Post('declarations/:id/evidence')
  @Permissions('superadmin:fiscal:evidence:write')
  async attachDeclarationEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:evidence:write'],
        (ctx) => this.evidence.attachToDeclaration([ctx], id, dto),
      ),
    );
  }

  // ----------------------------------------------------------------------
  // Close sessions
  // ----------------------------------------------------------------------

  @Get('close-sessions')
  @Permissions('superadmin:fiscal:close:read')
  async listCloseSessions(@Query() query: FiscalCloseQueryDto) {
    return this.response.success(
      await this.runAsPlatform(['superadmin:fiscal:close:read'], (ctx) =>
        this.closeService.list([ctx], query),
      ),
    );
  }

  @Post('close-sessions')
  @Permissions('superadmin:fiscal:close:write')
  async createCloseSession(@Body() dto: CreateFiscalCloseSessionDto) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:close:write'],
        (ctx) => this.closeService.createCloseSession(ctx, dto),
      ),
    );
  }

  @Get('close-sessions/:id')
  @Permissions('superadmin:fiscal:close:read')
  async getCloseSession(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.runAsPlatform(['superadmin:fiscal:close:read'], (ctx) =>
        this.closeService.findOne([ctx], id),
      ),
    );
  }

  @Patch('close-sessions/:id/run-checks')
  @Permissions('superadmin:fiscal:close:write')
  async runCloseChecks(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.runAsPlatform(['superadmin:fiscal:close:write'], (ctx) =>
        this.closeService.runChecks([ctx], id),
      ),
    );
  }

  @Patch('close-sessions/:id/approve')
  @Permissions('superadmin:fiscal:close:write')
  async approveClose(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.runAsPlatform(['superadmin:fiscal:close:write'], (ctx) =>
        this.closeService.approveClose([ctx], id),
      ),
    );
  }

  @Patch('close-sessions/:id/close')
  @Permissions('superadmin:fiscal:close:write')
  async close(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.runAsPlatform(['superadmin:fiscal:close:write'], (ctx) =>
        this.closeService.close([ctx], id),
      ),
    );
  }

  @Patch('close-sessions/:id/reopen')
  @Permissions('superadmin:fiscal:close:write')
  async reopen(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReopenFiscalCloseDto,
  ) {
    return this.response.updated(
      await this.runAsPlatform(['superadmin:fiscal:close:write'], (ctx) =>
        this.closeService.reopen([ctx], id, dto),
      ),
    );
  }

  @Patch('close-sessions/:id/checks/:checkId/override')
  @Permissions('superadmin:fiscal:close:write')
  async overrideCheck(
    @Param('id', ParseIntPipe) id: number,
    @Param('checkId', ParseIntPipe) checkId: number,
    @Body() dto: OverrideFiscalCloseCheckDto,
  ) {
    return this.response.updated(
      await this.runAsPlatform(['superadmin:fiscal:close:write'], (ctx) =>
        this.closeService.overrideCheck([ctx], id, checkId, dto),
      ),
    );
  }

  @Post('close-sessions/:id/evidence')
  @Permissions('superadmin:fiscal:evidence:write')
  async attachCloseEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:evidence:write'],
        (ctx) => this.evidence.attachToCloseSession([ctx], id, dto),
      ),
    );
  }

  // ----------------------------------------------------------------------
  // Evidence
  // ----------------------------------------------------------------------

  @Get('evidence')
  @Permissions('superadmin:fiscal:evidence:read')
  async listEvidence(@Query() query: FiscalListQueryDto) {
    return this.response.success(
      await this.runAsPlatform(['superadmin:fiscal:evidence:read'], (ctx) =>
        this.evidence.list([ctx], query),
      ),
    );
  }

  @Post('evidence')
  @Permissions('superadmin:fiscal:evidence:write')
  async attachEvidence(@Body() dto: AttachFiscalEvidenceDto) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:evidence:write'],
        (ctx) => this.evidence.attach(ctx, dto),
      ),
    );
  }

  // ----------------------------------------------------------------------
  // Rules
  // ----------------------------------------------------------------------

  @Get('rules')
  @Permissions('superadmin:fiscal:rules:read')
  async listRules(@Query() query: FiscalRulesQueryDto) {
    return this.response.success(
      await this.runAsPlatform(['superadmin:fiscal:rules:read'], (ctx) =>
        this.rules.list([ctx], query),
      ),
    );
  }

  @Post('rules')
  @Permissions('superadmin:fiscal:rules:manage:create')
  async createRule(@Body() dto: CreateFiscalRuleSetDto) {
    return this.response.created(
      await this.runAsPlatform(
        ['superadmin:fiscal:rules:manage:create'],
        (ctx) => this.rules.createRuleSet(dto),
      ),
      'Fiscal rule set created',
    );
  }

  @Patch('rules/:id')
  @Permissions('superadmin:fiscal:rules:manage:update')
  async updateRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFiscalRuleSetDto,
  ) {
    return this.response.updated(
      await this.runAsPlatform(
        ['superadmin:fiscal:rules:manage:update'],
        (ctx) => this.rules.updateRuleSet(id, dto),
      ),
      'Fiscal rule set updated',
    );
  }

  @Post('rules/:id/activate')
  @Permissions('superadmin:fiscal:rules:manage:create')
  async activateRule(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.runAsPlatform(
        ['superadmin:fiscal:rules:manage:create'],
        (ctx) => this.rules.activateRuleSet(id),
      ),
      'Fiscal rule set activated',
    );
  }

  @Post('rules/:id/archive')
  @Permissions('superadmin:fiscal:rules:manage:create')
  async archiveRule(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.runAsPlatform(
        ['superadmin:fiscal:rules:manage:create'],
        (ctx) => this.rules.archiveRuleSet(id),
      ),
      'Fiscal rule set archived',
    );
  }

  // ----------------------------------------------------------------------
  // Identity (legal/tax identity for the platform org)
  //
  // Mirror of the tenant's `settings.fiscal_data` editor (legal entity,
  // tax responsibilities, vat periodicity). Reads/writes the platform
  // org's `organization_settings.settings.fiscal_data` JSON section via
  // a deep-merge, never overwriting other sections (branding, fonts,
  // inventory, panel_ui, fiscal_status).
  // ----------------------------------------------------------------------

  @Get('identity/fiscal-data')
  @Permissions('superadmin:fiscal:identity:read')
  async getFiscalData() {
    return this.response.success(
      await this.runAsPlatform(
        ['superadmin:fiscal:identity:read'],
        async (ctx) => {
          if (!ctx.organization_id) {
            throw new VendixHttpException(
              ErrorCodes.SYS_NOT_FOUND_001,
              'Platform org has no organization_id',
            );
          }
          const row = await this.prisma.organization_settings.findFirst({
            where: { organization_id: ctx.organization_id },
            select: { settings: true },
          });
          const fiscalData =
            ((row?.settings as Record<string, unknown> | null)?.fiscal_data ??
              {}) as Record<string, unknown>;
          return { fiscal_data: fiscalData };
        },
      ),
    );
  }

  @Patch('identity/fiscal-data')
  @Permissions('superadmin:fiscal:identity:write')
  async updateFiscalData(@Body() dto: UpdateOrgFiscalDataDto) {
    return this.response.success(
      await this.runAsPlatform(
        ['superadmin:fiscal:identity:write'],
        async (ctx) => {
          if (!ctx.organization_id) {
            throw new VendixHttpException(
              ErrorCodes.SYS_NOT_FOUND_001,
              'Platform org has no organization_id',
            );
          }
          const existing =
            await this.prisma.organization_settings.findFirst({
              where: { organization_id: ctx.organization_id },
              select: { id: true, settings: true },
            });
          const currentSettings =
            (existing?.settings as Record<string, unknown> | null) ?? {};
          const previousFiscalData =
            (currentSettings.fiscal_data as Record<string, unknown> | null) ??
            {};
          const nextFiscalData = { ...previousFiscalData, ...dto };
          const nextSettings = { ...currentSettings, fiscal_data: nextFiscalData };

          if (existing) {
            await this.prisma.organization_settings.update({
              where: { id: existing.id },
              data: {
                settings: nextSettings as Prisma.InputJsonValue,
                updated_at: new Date(),
              },
            });
          } else {
            await this.prisma.organization_settings.create({
              data: {
                settings: nextSettings as Prisma.InputJsonValue,
                organization_id: ctx.organization_id,
              },
            });
          }
          return { fiscal_data: nextFiscalData };
        },
      ),
    );
  }

  // ----------------------------------------------------------------------
  // Static catalogs
  // ----------------------------------------------------------------------

  /**
   * Catálogo estático y versionado de responsabilidades DIAN (RUT casilla 53).
   * No depende del contexto fiscal: la UI lo usa para labels/tooltips y para
   * explicar qué obligaciones habilita cada responsabilidad.
   */
  @Get('responsibilities/catalog')
  @Permissions('superadmin:fiscal:dashboard:read')
  getResponsibilitiesCatalog() {
    return this.response.success({
      version: FISCAL_RESPONSIBILITIES_CATALOG_VERSION,
      responsibilities: FISCAL_RESPONSIBILITIES_CATALOG,
    });
  }

  // ----------------------------------------------------------------------
  // Onboarding readiness checklist
  // ----------------------------------------------------------------------

  @Get('config-checklist')
  @Permissions('superadmin:fiscal:dashboard:read')
  async getConfigChecklist() {
    return this.response.success(
      await this.runAsPlatform(['superadmin:fiscal:dashboard:read'], (ctx) =>
        this.checklist.build(ctx),
      ),
    );
  }
}
