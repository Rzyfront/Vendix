import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContextService } from '@common/context/request-context.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { ResponseService } from '../../../../common/responses/response.service';
import {
  PlatformGatewayService,
  PlatformProcessor,
} from './platform-gateway.service';
import {
  TestGatewayConnectionDto,
  UpsertGatewayDto,
} from './dto/upsert-gateway.dto';

@ApiTags('Superadmin Subscriptions - Gateway')
@Controller('superadmin/subscriptions/gateway')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class GatewayController {
  constructor(
    private readonly gatewayService: PlatformGatewayService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:gateway:read')
  @Get(':processor')
  @ApiOperation({
    summary:
      'Get platform-level payment gateway configuration (masked) for a given processor',
  })
  async findOne(@Param('processor') processor: string) {
    const view = await this.gatewayService.getMaskedCredentials(
      processor as PlatformProcessor,
    );
    return this.responseService.success(view, 'Gateway configuration retrieved');
  }

  @Permissions('superadmin:subscriptions:gateway:write')
  @Patch(':processor')
  @ApiOperation({
    summary:
      'Upsert platform-level payment gateway credentials for a given processor',
  })
  async upsert(
    @Param('processor') processor: string,
    @Body() dto: UpsertGatewayDto,
  ) {
    const userId = RequestContextService.getContext()?.user_id ?? null;
    const view = await this.gatewayService.upsertCredentials(
      processor as PlatformProcessor,
      dto,
      userId,
    );
    return this.responseService.updated(view, 'Gateway configuration saved');
  }

  @Permissions('superadmin:subscriptions:gateway:test')
  @Post(':processor/test')
  @ApiOperation({
    summary:
      'Test connection to a platform-level payment gateway (uses provided creds or stored ones)',
  })
  async test(
    @Param('processor') processor: string,
    @Body() dto: TestGatewayConnectionDto,
  ) {
    const result = await this.gatewayService.testConnection(
      processor as PlatformProcessor,
      dto,
    );
    return this.responseService.success(
      result,
      result.ok ? 'Test exitoso' : 'Test fallido',
    );
  }
}
