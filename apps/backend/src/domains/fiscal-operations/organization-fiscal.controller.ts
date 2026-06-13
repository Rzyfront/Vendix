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
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import {
  FiscalOperationsContext,
  FiscalContextResolverService,
} from './services/fiscal-context-resolver.service';
import { FiscalFlowStateService } from './services/fiscal-flow-state.service';
import { FiscalObligationService } from './services/fiscal-obligation.service';
import { TaxDeclarationDraftService } from './services/tax-declaration-draft.service';
import { FiscalCloseService } from './services/fiscal-close.service';
import { FiscalEvidenceService } from './services/fiscal-evidence.service';
import { FiscalRulesService } from './services/fiscal-rules.service';
import { FiscalAuditService } from './services/fiscal-audit.service';
import { FiscalConfigChecklistService } from './services/fiscal-config-checklist.service';
import {
  CreateFiscalRuleSetDto,
  FiscalConfigChecklistQueryDto,
  UpdateFiscalRuleSetDto,
} from './dto/fiscal-rules.dto';
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
} from './dto/fiscal-operations.dto';
import {
  FISCAL_RESPONSIBILITIES_CATALOG,
  FISCAL_RESPONSIBILITIES_CATALOG_VERSION,
} from './constants/fiscal-responsibilities.catalog';

@Controller('organization/fiscal')
@UseGuards(PermissionsGuard)
export class OrganizationFiscalController {
  constructor(
    private readonly contextResolver: FiscalContextResolverService,
    private readonly flowState: FiscalFlowStateService,
    private readonly obligations: FiscalObligationService,
    private readonly declarations: TaxDeclarationDraftService,
    private readonly closeService: FiscalCloseService,
    private readonly evidence: FiscalEvidenceService,
    private readonly rules: FiscalRulesService,
    private readonly audit: FiscalAuditService,
    private readonly checklist: FiscalConfigChecklistService,
    private readonly response: ResponseService,
  ) {}

  private async readContexts(query?: {
    store_id?: number;
  }): Promise<FiscalOperationsContext[]> {
    if (query?.store_id) {
      return [
        await this.contextResolver.resolveForOrganization({
          store_id: query.store_id,
          require_single_entity: true,
        }),
      ];
    }

    return this.contextResolver.resolveManyForOrganization();
  }

  private async mutationContext(dto?: {
    store_id?: number;
  }): Promise<FiscalOperationsContext> {
    return this.contextResolver.resolveForOrganization({
      store_id: dto?.store_id,
      require_single_entity: true,
    });
  }

  @Get('overview')
  @Permissions('organization:fiscal:dashboard:read')
  async overview(@Query() query: FiscalListQueryDto) {
    const contexts = await this.readContexts(query);
    return this.response.success(await this.obligations.getOverview(contexts));
  }

  @Get('flow-state')
  @Permissions('organization:fiscal:dashboard:read')
  async getFlowState(@Query() query: FiscalFlowStateQueryDto) {
    const contexts = await this.readContexts(query);
    return this.response.success(
      await this.flowState.getFlowState(contexts, query),
    );
  }

  @Get('history')
  @Permissions('organization:fiscal:history:read')
  async listHistory(@Query() query: FiscalHistoryQueryDto) {
    const contexts = await this.readContexts(query);
    const result = await this.audit.list(contexts, query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Get('obligations')
  @Permissions('organization:fiscal:obligations:read')
  async listObligations(@Query() query: FiscalListQueryDto) {
    const contexts = await this.readContexts(query);
    const result = await this.obligations.list(contexts, query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Post('obligations/generate')
  @Permissions('organization:fiscal:obligations:write')
  async generateObligations(@Body() dto: GenerateFiscalObligationsDto) {
    const context = await this.mutationContext(dto);
    return this.response.created(
      await this.obligations.generateForContext(context, dto),
      'Fiscal obligations generated',
    );
  }

  @Get('obligations/:id')
  @Permissions('organization:fiscal:obligations:read')
  async getObligation(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.success(await this.obligations.findOne(contexts, id));
  }

  @Patch('obligations/:id/status')
  @Permissions('organization:fiscal:obligations:write')
  async updateObligationStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeFiscalObligationStatusDto,
  ) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.obligations.updateStatus(contexts, id, dto),
      'Fiscal obligation status updated',
    );
  }

  @Post('obligations/:id/evidence')
  @Permissions('organization:fiscal:evidence:write')
  async attachObligationEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    const contexts = await this.readContexts(dto);
    return this.response.created(
      await this.evidence.attachToObligation(contexts, id, dto),
    );
  }

  @Get('declarations')
  @Permissions('organization:fiscal:declarations:read')
  async listDeclarations(@Query() query: FiscalListQueryDto) {
    const contexts = await this.readContexts(query);
    const result = await this.declarations.list(contexts, query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Post('declarations/draft')
  @Permissions('organization:fiscal:declarations:write')
  async createDraft(@Body() dto: CreateTaxDeclarationDraftDto) {
    const context = await this.mutationContext(dto);
    return this.response.created(
      await this.declarations.createDraft(context, dto),
    );
  }

  @Get('declarations/:id')
  @Permissions('organization:fiscal:declarations:read')
  async getDeclaration(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.success(await this.declarations.findOne(contexts, id));
  }

  @Get('declarations/:id/lines')
  @Permissions('organization:fiscal:declarations:read')
  async getDeclarationLines(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.success(
      await this.declarations.getLines(contexts, id),
    );
  }

  @Patch('declarations/:id/recalculate')
  @Permissions('organization:fiscal:declarations:write')
  async recalculateDeclaration(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.declarations.recalculateDraft(contexts, id),
    );
  }

  @Patch('declarations/:id/approve')
  @Permissions('organization:fiscal:declarations:write')
  async approveDeclaration(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.declarations.approveDraft(contexts, id),
    );
  }

  @Patch('declarations/:id/mark-submitted')
  @Permissions('organization:fiscal:declarations:write')
  async markDeclarationSubmitted(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkFiscalSubmittedDto,
  ) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.declarations.markSubmitted(contexts, id, dto),
    );
  }

  @Post('declarations/:id/evidence')
  @Permissions('organization:fiscal:evidence:write')
  async attachDeclarationEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    const contexts = await this.readContexts(dto);
    return this.response.created(
      await this.evidence.attachToDeclaration(contexts, id, dto),
    );
  }

  @Get('close-sessions')
  @Permissions('organization:fiscal:close:read')
  async listCloseSessions(@Query() query: FiscalCloseQueryDto) {
    const contexts = await this.readContexts(query);
    return this.response.success(await this.closeService.list(contexts, query));
  }

  @Post('close-sessions')
  @Permissions('organization:fiscal:close:write')
  async createCloseSession(@Body() dto: CreateFiscalCloseSessionDto) {
    const context = await this.mutationContext(dto);
    return this.response.created(
      await this.closeService.createCloseSession(context, dto),
    );
  }

  @Get('close-sessions/:id')
  @Permissions('organization:fiscal:close:read')
  async getCloseSession(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.success(await this.closeService.findOne(contexts, id));
  }

  @Patch('close-sessions/:id/run-checks')
  @Permissions('organization:fiscal:close:write')
  async runCloseChecks(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.closeService.runChecks(contexts, id),
    );
  }

  @Patch('close-sessions/:id/approve')
  @Permissions('organization:fiscal:close:write')
  async approveClose(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.closeService.approveClose(contexts, id),
    );
  }

  @Patch('close-sessions/:id/close')
  @Permissions('organization:fiscal:close:write')
  async close(@Param('id', ParseIntPipe) id: number) {
    const contexts = await this.readContexts();
    return this.response.updated(await this.closeService.close(contexts, id));
  }

  @Patch('close-sessions/:id/reopen')
  @Permissions('organization:fiscal:close:write')
  async reopen(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReopenFiscalCloseDto,
  ) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.closeService.reopen(contexts, id, dto),
    );
  }

  @Patch('close-sessions/:id/checks/:checkId/override')
  @Permissions('organization:fiscal:close:write')
  async overrideCheck(
    @Param('id', ParseIntPipe) id: number,
    @Param('checkId', ParseIntPipe) checkId: number,
    @Body() dto: OverrideFiscalCloseCheckDto,
  ) {
    const contexts = await this.readContexts();
    return this.response.updated(
      await this.closeService.overrideCheck(contexts, id, checkId, dto),
    );
  }

  @Post('close-sessions/:id/evidence')
  @Permissions('organization:fiscal:evidence:write')
  async attachCloseEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    const contexts = await this.readContexts(dto);
    return this.response.created(
      await this.evidence.attachToCloseSession(contexts, id, dto),
    );
  }

  @Get('evidence')
  @Permissions('organization:fiscal:evidence:read')
  async listEvidence(@Query() query: FiscalListQueryDto) {
    const contexts = await this.readContexts(query);
    return this.response.success(await this.evidence.list(contexts, query));
  }

  @Post('evidence')
  @Permissions('organization:fiscal:evidence:write')
  async attachEvidence(@Body() dto: AttachFiscalEvidenceDto) {
    const context = await this.mutationContext(dto);
    return this.response.created(await this.evidence.attach(context, dto));
  }

  @Get('rules')
  @Permissions('organization:fiscal:rules:read')
  async listRules(@Query() query: FiscalRulesQueryDto) {
    const contexts = await this.readContexts(query);
    return this.response.success(await this.rules.list(contexts, query));
  }

  /**
   * Catálogo estático y versionado de responsabilidades DIAN (RUT casilla 53).
   * No depende del contexto fiscal: la UI lo usa para labels/tooltips y para
   * explicar qué obligaciones habilita cada responsabilidad.
   */
  @Get('responsibilities/catalog')
  @Permissions('organization:fiscal:dashboard:read')
  getResponsibilitiesCatalog() {
    return this.response.success({
      version: FISCAL_RESPONSIBILITIES_CATALOG_VERSION,
      responsibilities: FISCAL_RESPONSIBILITIES_CATALOG,
    });
  }

  /**
   * Checklist de configuración fiscal (read-only). Para organizaciones con
   * fiscal_scope STORE se requiere `store_id` (misma regla de entidad única
   * que las mutaciones fiscales).
   */
  @Get('config-checklist')
  @Permissions('organization:fiscal:dashboard:read')
  async getConfigChecklist(@Query() query: FiscalConfigChecklistQueryDto) {
    const context = await this.contextResolver.resolveForOrganization({
      store_id: query.store_id,
      require_single_entity: true,
    });
    return this.response.success(await this.checklist.build(context));
  }

  @Post('rules')
  @Permissions('organization:fiscal:rules:manage')
  async createRule(@Body() dto: CreateFiscalRuleSetDto) {
    return this.response.created(
      await this.rules.createRuleSet(dto),
      'Fiscal rule set created',
    );
  }

  @Patch('rules/:id')
  @Permissions('organization:fiscal:rules:manage')
  async updateRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFiscalRuleSetDto,
  ) {
    return this.response.updated(
      await this.rules.updateRuleSet(id, dto),
      'Fiscal rule set updated',
    );
  }

  @Post('rules/:id/activate')
  @Permissions('organization:fiscal:rules:manage')
  async activateRule(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.rules.activateRuleSet(id),
      'Fiscal rule set activated',
    );
  }

  @Post('rules/:id/archive')
  @Permissions('organization:fiscal:rules:manage')
  async archiveRule(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(
      await this.rules.archiveRuleSet(id),
      'Fiscal rule set archived',
    );
  }
}
