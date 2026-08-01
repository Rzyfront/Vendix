import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { AccountMappingsService } from './account-mappings.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { SetMappingOverrideDto } from './dto/set-mapping-override.dto';

@Controller('super-admin/fiscal/accounting/account-mappings')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AccountMappingsController {
  constructor(
    private readonly account_mappings_service: AccountMappingsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:fiscal:accounting:read')
  async getMappings(@Query('prefix') prefix?: string) {
    const result = await this.account_mappings_service.getMappings(prefix);
    return this.response_service.success(result);
  }

  @Patch(':key')
  @Permissions('superadmin:fiscal:accounting:update')
  async setOverride(
    @Param('key') key: string,
    @Body() dto: SetMappingOverrideDto,
  ) {
    const result = await this.account_mappings_service.setOverride(
      key,
      dto.account_id,
    );
    return this.response_service.updated(
      result,
      'Mapping override updated successfully',
    );
  }

  @Post(':key/reset')
  @Permissions('superadmin:fiscal:accounting:update')
  @HttpCode(HttpStatus.OK)
  async resetOverride(@Param('key') key: string) {
    const result = await this.account_mappings_service.resetOverride(key);
    return this.response_service.success(result, 'Mapping reset to default');
  }
}
