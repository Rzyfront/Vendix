import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { OperatingScopeMigrationService } from '@common/services/operating-scope-migration.service';
import {
  OperatingScopeService,
  OrganizationOperatingScope,
} from '@common/services/operating-scope.service';

import { ChangeOperatingScopeDto } from './dto';

/**
 * `/api/organization/settings/operating-scope` — Phase 4 wizard endpoints.
 *
 *  - GET    /            → current scope, partner flag, recent audit history.
 *  - POST   /preview     → dry-run validation (blockers + warnings).
 *  - POST   /apply       → atomic migration with audit log + cache bust.
 *
 * Permissions required: `organization:settings:operating_scope:read` (GET) and
 * `organization:settings:operating_scope:write` (POST endpoints). The
 * permissions are seeded by `permissions-roles.seed.ts`.
 *
 * The DomainScopeGuard pinned to `/organization/*` ensures only ORG_ADMIN
 * tokens (or super-admin bypass) can hit this controller.
 */
@ApiTags('Organization Settings — Operating Scope')
@Controller('organization/settings/operating-scope')
@UseGuards(PermissionsGuard)
export class OperatingScopeController {
  private readonly logger = new Logger(OperatingScopeController.name);

  constructor(
    private readonly migrationService: OperatingScopeMigrationService,
    private readonly operatingScope: OperatingScopeService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET — current state
  // ---------------------------------------------------------------------------

  @Get()
  @Permissions('organization:settings:operating_scope:read')
  @ApiOperation({
    summary: 'Get current operating scope, partner status, and recent changes.',
  })
  @ApiResponse({ status: 200, description: 'Current operating scope state.' })
  async getCurrent() {
    const orgId = this.requireOrgId();

    const baseClient = this.globalPrisma.withoutScope();
    const organization = await baseClient.organizations.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        operating_scope: true,
        is_partner: true,
        account_type: true,
      },
    });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    const current: OrganizationOperatingScope =
      (organization.operating_scope as OrganizationOperatingScope) ??
      (organization.account_type === 'MULTI_STORE_ORG'
        ? 'ORGANIZATION'
        : 'STORE');

    const audit_log_recent = await this.migrationService.getRecentAuditLog(
      orgId,
      10,
    );

    return {
      current,
      is_partner: organization.is_partner === true,
      account_type: organization.account_type,
      audit_log_recent,
      // Editable from settings UI when not a partner. Frontend should also
      // render the toggle disabled when this flag is false.
      editable: organization.is_partner !== true,
    };
  }

  // ---------------------------------------------------------------------------
  // POST /preview — dry-run validation
  // ---------------------------------------------------------------------------

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Permissions('organization:settings:operating_scope:write')
  @ApiOperation({
    summary:
      'Validate a proposed operating-scope change without applying it. Returns blockers + warnings.',
  })
  @ApiResponse({
    status: 200,
    description: 'Preview returned (may include blockers/warnings).',
  })
  async preview(@Body() body: ChangeOperatingScopeDto) {
    const orgId = this.requireOrgId();
    const userId = this.requireUserId();
    return this.migrationService.proposeChange(
      orgId,
      body.target_scope,
      userId,
      body.reason,
    );
  }

  // ---------------------------------------------------------------------------
  // POST /apply — atomic migration
  // ---------------------------------------------------------------------------

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @Permissions('organization:settings:operating_scope:write')
  @ApiOperation({
    summary:
      'Atomically migrate the organization to the target operating_scope. ' +
      'Records audit-log rows and invalidates the scope cache. Pass `force=true` ' +
      'with a `reason` (≥10 chars) to bypass downgrade blockers (Plan P4.5).',
  })
  @ApiResponse({ status: 200, description: 'Migration applied.' })
  @ApiResponse({ status: 403, description: 'Partners are locked to STORE.' })
  @ApiResponse({
    status: 409,
    description:
      'Migration blocked by pre-conditions (open POs to central, ' +
      'cross-store transfers, stock at central, active reservations at central). ' +
      'Pass force=true with a reason to override.',
  })
  async apply(@Body() body: ChangeOperatingScopeDto) {
    const orgId = this.requireOrgId();
    const userId = this.requireUserId();
    return this.migrationService.applyChange(
      orgId,
      body.target_scope,
      userId,
      body.reason,
      body.force === true,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  private requireUserId(): number {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new ForbiddenException('Authenticated user context required');
    }
    return userId;
  }
}
