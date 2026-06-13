import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateFiscalPeriodDto } from './dto/create-fiscal-period.dto';
import { UpdateFiscalPeriodDto } from './dto/update-fiscal-period.dto';

@Controller('super-admin/fiscal/accounting/fiscal-periods')
@UseGuards(PermissionsGuard)
export class FiscalPeriodsController {
  constructor(
    private readonly fiscal_periods_service: FiscalPeriodsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:fiscal:accounting:read')
  async findAll() {
    const result = await this.fiscal_periods_service.findAll();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('superadmin:fiscal:accounting:read')
  async findOne(@Param('id') id: string) {
    const result = await this.fiscal_periods_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('superadmin:fiscal:accounting:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateFiscalPeriodDto) {
    const result = await this.fiscal_periods_service.create(create_dto);
    return this.response_service.created(
      result,
      'Fiscal period created successfully',
    );
  }

  @Put(':id')
  @Permissions('superadmin:fiscal:accounting:update')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateFiscalPeriodDto,
  ) {
    const result = await this.fiscal_periods_service.update(+id, update_dto);
    return this.response_service.updated(
      result,
      'Fiscal period updated successfully',
    );
  }

  @Patch(':id/close')
  @Permissions('superadmin:fiscal:accounting:update')
  @HttpCode(HttpStatus.OK)
  async close(@Param('id') id: string, @Req() req: any) {
    const user_id = (req?.user?.id as number | undefined) ?? null;
    const result = await this.fiscal_periods_service.close(+id, user_id);
    return this.response_service.success(
      result,
      'Fiscal period closed successfully',
    );
  }

  @Patch(':id/reopen')
  @Permissions('superadmin:fiscal:accounting:update')
  @HttpCode(HttpStatus.OK)
  async reopen(@Param('id') id: string) {
    const result = await this.fiscal_periods_service.reopen(+id);
    return this.response_service.success(
      result,
      'Fiscal period reopened successfully',
    );
  }
}
