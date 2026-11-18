import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '../../../common/responses/response.service';
import {
  PlatformAlertsQueryDto,
  PlatformTestAlertDto,
} from './dto/platform-alerts-query.dto';
import { PlatformAlertsAdminService } from './services/platform-alerts-admin.service';

/** Alertas del bot de monitoreo de la API (QUI-1010, S5). Solo superadmin. */
@ApiTags('Monitoring')
@Controller('superadmin/monitoring/alerts')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformAlertsController {
  constructor(
    private readonly alerts: PlatformAlertsAdminService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List monitoring alerts' })
  async list(@Query() query: PlatformAlertsQueryDto) {
    const { data, total, page, limit } = await this.alerts.list(query);
    return this.responseService.paginated(data, total, page, limit, 'Alerts retrieved');
  }

  @Get('stats')
  @ApiOperation({ summary: 'Monitoring alerts summary' })
  async stats() {
    return this.responseService.success(await this.alerts.stats(), 'Alert stats retrieved');
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a test alert (Telegram; critical also e-mail + ticket)' })
  async sendTest(
    @Body() dto: PlatformTestAlertDto,
    @CurrentUser('id') userId?: number,
  ) {
    return this.responseService.success(
      await this.alerts.sendTest(dto, userId ?? null),
      'Test alert sent',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Monitoring alert detail' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.alerts.findOne(id), 'Alert retrieved');
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a monitoring alert as resolved' })
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId?: number,
  ) {
    return this.responseService.success(
      await this.alerts.resolve(id, userId ?? null),
      'Alert resolved',
    );
  }
}
