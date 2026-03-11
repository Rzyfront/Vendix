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
export class FiscalPeriodsController {
  constructor(
    private readonly fiscal_periods_service: FiscalPeriodsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  async findAll() {
    const result = await this.fiscal_periods_service.findAll();
    return this.response_service.success(result);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.fiscal_periods_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateFiscalPeriodDto) {
    const result = await this.fiscal_periods_service.create(create_dto);
    return this.response_service.success(result, 'Fiscal period created successfully');
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateFiscalPeriodDto,
  ) {
    const result = await this.fiscal_periods_service.update(+id, update_dto);
    return this.response_service.success(result, 'Fiscal period updated successfully');
  }

  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  async close(@Param('id') id: string) {
    const result = await this.fiscal_periods_service.close(+id);
    return this.response_service.success(result, 'Fiscal period closed successfully');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.fiscal_periods_service.remove(+id);
    return this.response_service.success(null, 'Fiscal period deleted successfully');
  }
}
