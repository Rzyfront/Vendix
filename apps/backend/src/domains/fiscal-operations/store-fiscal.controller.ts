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
import { FiscalContextResolverService } from './services/fiscal-context-resolver.service';
import { FiscalFlowStateService } from './services/fiscal-flow-state.service';
import { FiscalObligationService } from './services/fiscal-obligation.service';
import { TaxDeclarationDraftService } from './services/tax-declaration-draft.service';
import { FiscalCloseService } from './services/fiscal-close.service';
import { FiscalEvidenceService } from './services/fiscal-evidence.service';
import { FiscalRulesService } from './services/fiscal-rules.service';
import { FiscalAuditService } from './services/fiscal-audit.service';
import { FiscalConfigChecklistService } from './services/fiscal-config-checklist.service';
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
  VoidTaxDeclarationDto,
} from './dto/fiscal-operations.dto';
import {
  FISCAL_RESPONSIBILITIES_CATALOG,
  FISCAL_RESPONSIBILITIES_CATALOG_VERSION,
} from './constants/fiscal-responsibilities.catalog';

@Controller('store/fiscal')
@UseGuards(PermissionsGuard)
export class StoreFiscalController {
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

  @Get('overview')
  @Permissions('store:fiscal:dashboard:read')
  async overview() {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(await this.obligations.getOverview([context]));
  }

  @Get('flow-state')
  @Permissions('store:fiscal:dashboard:read')
  async getFlowState(@Query() query: FiscalFlowStateQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(
      await this.flowState.getFlowState([context], query),
    );
  }

  @Get('history')
  @Permissions('store:fiscal:history:read')
  async listHistory(@Query() query: FiscalHistoryQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    const result = await this.audit.list([context], query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Get('obligations')
  @Permissions('store:fiscal:obligations:read')
  async listObligations(@Query() query: FiscalListQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    const result = await this.obligations.list([context], query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Post('obligations/generate')
  @Permissions('store:fiscal:obligations:write')
  async generateObligations(@Body() dto: GenerateFiscalObligationsDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.created(
      await this.obligations.generateForContext(context, dto),
      'Fiscal obligations generated',
    );
  }

  @Get('obligations/:id')
  @Permissions('store:fiscal:obligations:read')
  async getObligation(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(await this.obligations.findOne([context], id));
  }

  @Patch('obligations/:id/status')
  @Permissions('store:fiscal:obligations:write')
  async updateObligationStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeFiscalObligationStatusDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.obligations.updateStatus([context], id, dto),
      'Fiscal obligation status updated',
    );
  }

  @Post('obligations/:id/evidence')
  @Permissions('store:fiscal:evidence:write')
  async attachObligationEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.created(
      await this.evidence.attachToObligation([context], id, dto),
    );
  }

  @Get('declarations')
  @Permissions('store:fiscal:declarations:read')
  async listDeclarations(@Query() query: FiscalListQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    const result = await this.declarations.list([context], query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Post('declarations/draft')
  @Permissions('store:fiscal:declarations:write')
  async createDraft(@Body() dto: CreateTaxDeclarationDraftDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.created(
      await this.declarations.createDraft(context, dto),
    );
  }

  @Get('declarations/:id')
  @Permissions('store:fiscal:declarations:read')
  async getDeclaration(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(
      await this.declarations.findOne([context], id),
    );
  }

  @Get('declarations/:id/lines')
  @Permissions('store:fiscal:declarations:read')
  async getDeclarationLines(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(
      await this.declarations.getLines([context], id),
    );
  }

  @Patch('declarations/:id/recalculate')
  @Permissions('store:fiscal:declarations:write')
  async recalculateDeclaration(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.declarations.recalculateDraft([context], id),
    );
  }

  @Patch('declarations/:id/approve')
  @Permissions('store:fiscal:declarations:write')
  async approveDeclaration(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.declarations.approveDraft([context], id),
    );
  }

  @Patch('declarations/:id/mark-submitted')
  @Permissions('store:fiscal:declarations:write')
  async markDeclarationSubmitted(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkFiscalSubmittedDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.declarations.markSubmitted([context], id, dto),
    );
  }

  @Patch('declarations/:id/void')
  @Permissions('store:fiscal:declarations:write')
  async voidDeclaration(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidTaxDeclarationDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.declarations.voidDraft([context], id, dto.reason),
    );
  }

  @Patch('declarations/:id/reject')
  @Permissions('store:fiscal:declarations:write')
  async rejectDeclaration(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidTaxDeclarationDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.declarations.markRejected([context], id, dto.reason),
    );
  }

  @Post('declarations/:id/evidence')
  @Permissions('store:fiscal:evidence:write')
  async attachDeclarationEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.created(
      await this.evidence.attachToDeclaration([context], id, dto),
    );
  }

  @Get('close-sessions')
  @Permissions('store:fiscal:close:read')
  async listCloseSessions(@Query() query: FiscalCloseQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(
      await this.closeService.list([context], query),
    );
  }

  @Post('close-sessions')
  @Permissions('store:fiscal:close:write')
  async createCloseSession(@Body() dto: CreateFiscalCloseSessionDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.created(
      await this.closeService.createCloseSession(context, dto),
    );
  }

  @Get('close-sessions/:id')
  @Permissions('store:fiscal:close:read')
  async getCloseSession(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(
      await this.closeService.findOne([context], id),
    );
  }

  @Patch('close-sessions/:id/run-checks')
  @Permissions('store:fiscal:close:write')
  async runCloseChecks(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.closeService.runChecks([context], id),
    );
  }

  @Patch('close-sessions/:id/approve')
  @Permissions('store:fiscal:close:write')
  async approveClose(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.closeService.approveClose([context], id),
    );
  }

  @Patch('close-sessions/:id/close')
  @Permissions('store:fiscal:close:write')
  async close(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(await this.closeService.close([context], id));
  }

  @Patch('close-sessions/:id/reopen')
  @Permissions('store:fiscal:close:write')
  async reopen(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReopenFiscalCloseDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.closeService.reopen([context], id, dto),
    );
  }

  @Patch('close-sessions/:id/checks/:checkId/override')
  @Permissions('store:fiscal:close:write')
  async overrideCheck(
    @Param('id', ParseIntPipe) id: number,
    @Param('checkId', ParseIntPipe) checkId: number,
    @Body() dto: OverrideFiscalCloseCheckDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.updated(
      await this.closeService.overrideCheck([context], id, checkId, dto),
    );
  }

  @Post('close-sessions/:id/evidence')
  @Permissions('store:fiscal:evidence:write')
  async attachCloseEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachFiscalEvidenceDto,
  ) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.created(
      await this.evidence.attachToCloseSession([context], id, dto),
    );
  }

  @Get('evidence')
  @Permissions('store:fiscal:evidence:read')
  async listEvidence(@Query() query: FiscalListQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(await this.evidence.list([context], query));
  }

  @Post('evidence')
  @Permissions('store:fiscal:evidence:write')
  async attachEvidence(@Body() dto: AttachFiscalEvidenceDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.created(await this.evidence.attach(context, dto));
  }

  @Get('rules')
  @Permissions('store:fiscal:rules:read')
  async listRules(@Query() query: FiscalRulesQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(await this.rules.list([context], query));
  }

  /**
   * Catálogo estático y versionado de responsabilidades DIAN (RUT casilla 53).
   * No depende del contexto fiscal: la UI lo usa para labels/tooltips y para
   * explicar qué obligaciones habilita cada responsabilidad.
   */
  @Get('responsibilities/catalog')
  @Permissions('store:fiscal:dashboard:read')
  getResponsibilitiesCatalog() {
    return this.response.success({
      version: FISCAL_RESPONSIBILITIES_CATALOG_VERSION,
      responsibilities: FISCAL_RESPONSIBILITIES_CATALOG,
    });
  }

  /** Checklist de configuración fiscal (read-only) para la tienda actual. */
  @Get('config-checklist')
  @Permissions('store:fiscal:dashboard:read')
  async getConfigChecklist() {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(await this.checklist.build(context));
  }
}
