import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequestContextService } from '../../../../common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import {
  RetrySubscriptionFiscalDto,
  SubscriptionFiscalQueryDto,
  UpsertSubscriptionFiscalConfigDto,
} from './dto/subscription-fiscal.dto';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

@ApiTags('Superadmin Subscriptions - Fiscal Billing')
@Controller('superadmin/subscriptions/fiscal')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SubscriptionFiscalController {
  constructor(
    private readonly fiscalService: SubscriptionFiscalService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('status')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'Get platform DIAN fiscal billing status' })
  async getStatus(): Promise<any> {
    const status = await this.fiscalService.getStatus();
    return this.responseService.success(status, 'Fiscal billing status retrieved');
  }

  @Patch('config')
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Create or update platform DIAN fiscal billing config' })
  async upsertConfig(
    @Body() dto: UpsertSubscriptionFiscalConfigDto,
  ): Promise<any> {
    const userId = RequestContextService.getUserId() ?? null;
    const status = await this.fiscalService.upsertConfig(dto, userId);
    return this.responseService.updated(status, 'Fiscal billing configuration saved');
  }

  @Post('certificate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('certificate'))
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Upload platform DIAN certificate' })
  async uploadCertificate(
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
  ): Promise<any> {
    const userId = RequestContextService.getUserId() ?? null;
    const result = await this.fiscalService.uploadCertificate({
      file,
      password,
      userId,
    });
    return this.responseService.updated(result, 'Certificate uploaded');
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Test platform DIAN connection' })
  async testConnection(): Promise<any> {
    const userId = RequestContextService.getUserId() ?? null;
    const result = await this.fiscalService.testConnection(userId);
    return this.responseService.success(
      result,
      result.ok ? 'Test exitoso' : 'Test fallido',
    );
  }

  @Get('transmissions')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'List platform SaaS fiscal transmissions' })
  async listTransmissions(
    @Query() query: SubscriptionFiscalQueryDto,
  ): Promise<any> {
    const result = await this.fiscalService.listTransmissions(query);
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Fiscal transmissions retrieved',
    );
  }

  @Post('invoices/:id/issue')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Manually issue a paid SaaS invoice electronically' })
  async issueInvoice(@Param('id', ParseIntPipe) id: number): Promise<any> {
    const result = await this.fiscalService.issueForInvoice(id, {
      manual: true,
      source: 'manual',
    });
    return this.responseService.success(result, 'Fiscal invoice issue requested');
  }

  @Post('transmissions/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Retry a SaaS fiscal transmission' })
  async retryTransmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() _dto: RetrySubscriptionFiscalDto,
  ): Promise<any> {
    const result = await this.fiscalService.retryTransmission(id);
    return this.responseService.success(result, 'Fiscal transmission retry requested');
  }
}
