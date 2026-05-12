import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalScopeMigrationService } from '@common/services/fiscal-scope-migration.service';
import { OrganizationFiscalScope } from '@common/services/fiscal-scope.service';
import type { OrganizationOperatingScope } from '@common/services/operating-scope.service';

import { ChangeFiscalScopeDto } from './dto';

@ApiTags('Organization Settings — Fiscal Scope')
@Controller('organization/settings/fiscal-scope')
@UseGuards(PermissionsGuard)
export class FiscalScopeController {
  constructor(
    private readonly migrationService: FiscalScopeMigrationService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  @Get()
  @Permissions('organization:settings:fiscal_scope:read')
  @ApiOperation({
    summary: 'Get current fiscal scope, operating scope, and recent changes.',
  })
  @ApiResponse({ status: 200, description: 'Current fiscal scope state.' })
  async getCurrent() {
    const orgId = this.requireOrgId();

    const baseClient = this.globalPrisma.withoutScope();
    const organization = await baseClient.organizations.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        fiscal_scope: true,
        operating_scope: true,
        account_type: true,
      },
    });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    const current: OrganizationFiscalScope =
      (organization.fiscal_scope as OrganizationFiscalScope) ??
      ((organization.operating_scope as OrganizationFiscalScope | null) ||
        (organization.account_type === 'MULTI_STORE_ORG'
          ? 'ORGANIZATION'
          : 'STORE'));
    const operating_scope: OrganizationOperatingScope =
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
      operating_scope,
      account_type: organization.account_type,
      audit_log_recent,
      editable: true,
      invalid_combination:
        operating_scope === 'STORE' && current === 'ORGANIZATION',
    };
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Permissions('organization:settings:fiscal_scope:write')
  @ApiOperation({
    summary:
      'Validate a proposed fiscal-scope change without applying it. Returns blockers + warnings.',
  })
  async preview(@Body() body: ChangeFiscalScopeDto) {
    const orgId = this.requireOrgId();
    const userId = this.requireUserId();
    return this.migrationService.proposeChange(
      orgId,
      body.target_scope,
      userId,
      body.reason,
    );
  }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @Permissions('organization:settings:fiscal_scope:write')
  @ApiOperation({
    summary:
      'Atomically migrate the organization to the target fiscal_scope. Records audit rows and invalidates cache.',
  })
  async apply(@Body() body: ChangeFiscalScopeDto) {
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
