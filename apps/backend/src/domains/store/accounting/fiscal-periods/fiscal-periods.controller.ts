import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
  SkipModuleFlowGuard,
} from '../../../../common/guards/module-flow.guard';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateFiscalPeriodDto } from './dto/create-fiscal-period.dto';
import { UpdateFiscalPeriodDto } from './dto/update-fiscal-period.dto';

@Controller('store/accounting/fiscal-periods')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class FiscalPeriodsController {
  constructor(
    private readonly fiscal_periods_service: FiscalPeriodsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @SkipModuleFlowGuard() // bootstrap: wizard loadInitial() lists fiscal periods while module still WIP
  @Permissions('store:accounting:fiscal_periods:read')
  async findAll() {
    const result = await this.fiscal_periods_service.findAll();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('store:accounting:fiscal_periods:read')
  async findOne(@Param('id') id: string) {
    const result = await this.fiscal_periods_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @SkipModuleFlowGuard() // bootstrap: wizard creates the initial fiscal period to satisfy ACTIVE requirements
  @Permissions('store:accounting:fiscal_periods:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateFiscalPeriodDto) {
    const result = await this.fiscal_periods_service.create(create_dto);
    return this.response_service.success(
      result,
      'Fiscal period created successfully',
    );
  }

  @Put(':id')
  @Permissions('store:accounting:fiscal_periods:update')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateFiscalPeriodDto,
  ) {
    const result = await this.fiscal_periods_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Fiscal period updated successfully',
    );
  }

  @Patch(':id/close')
  @Permissions('store:accounting:fiscal_periods:update')
  @HttpCode(HttpStatus.OK)
  async close(@Param('id') id: string) {
    const result = await this.fiscal_periods_service.close(+id);
    return this.response_service.success(
      result,
      'Fiscal period closed successfully',
    );
  }

  @Delete(':id')
  @Permissions('store:accounting:fiscal_periods:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.fiscal_periods_service.remove(+id);
    return this.response_service.success(
      null,
      'Fiscal period deleted successfully',
    );
  }
}
