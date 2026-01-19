import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { CreateCurrencyDto, UpdateCurrencyDto, CurrencyQueryDto } from './dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';

@Controller('superadmin/currencies')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Post()
  create(@Body() createCurrencyDto: CreateCurrencyDto) {
    return this.currenciesService.create(createCurrencyDto);
  }

  @Get()
  findAll(@Query() query: CurrencyQueryDto) {
    return this.currenciesService.findAll(query);
  }

  @Get('dashboard')
  getDashboardStats() {
    return this.currenciesService.getDashboardStats();
  }

  @Get(':code')
  findOne(@Param('code') code: string) {
    return this.currenciesService.findOne(code);
  }

  @Patch(':code')
  update(@Param('code') code: string, @Body() updateCurrencyDto: UpdateCurrencyDto) {
    return this.currenciesService.update(code, updateCurrencyDto);
  }

  @Delete(':code')
  remove(@Param('code') code: string) {
    return this.currenciesService.remove(code);
  }

  @Post(':code/activate')
  activate(@Param('code') code: string) {
    return this.currenciesService.activate(code);
  }

  @Post(':code/deactivate')
  deactivate(@Param('code') code: string) {
    return this.currenciesService.deactivate(code);
  }

  @Post(':code/deprecate')
  deprecate(@Param('code') code: string) {
    return this.currenciesService.deprecate(code);
  }
}
