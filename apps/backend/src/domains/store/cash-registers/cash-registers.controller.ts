import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CashRegistersService } from './cash-registers.service';
import { ResponseService } from '../../../common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CreateCashRegisterDto } from './dto/create-cash-register.dto';
import { UpdateCashRegisterDto } from './dto/update-cash-register.dto';

@Controller('store/cash-registers')
@UseGuards(PermissionsGuard)
export class CashRegistersController {
  constructor(
    private readonly cash_registers_service: CashRegistersService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:cash_registers:read')
  async findAll() {
    const result = await this.cash_registers_service.findAll();
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:cash_registers:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateCashRegisterDto) {
    const result = await this.cash_registers_service.create(dto);
    return this.response_service.success(
      result,
      'Cash register created successfully',
    );
  }

  @Get(':id')
  @Permissions('store:cash_registers:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.cash_registers_service.findOne(id);
    return this.response_service.success(result);
  }

  @Put(':id')
  @Permissions('store:cash_registers:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCashRegisterDto,
  ) {
    const result = await this.cash_registers_service.update(id, dto);
    return this.response_service.success(
      result,
      'Cash register updated successfully',
    );
  }

  @Delete(':id')
  @Permissions('store:cash_registers:delete')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.cash_registers_service.remove(id);
    return this.response_service.success(
      result,
      'Cash register deactivated successfully',
    );
  }
}
