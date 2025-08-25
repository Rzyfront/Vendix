import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { TaxesService } from './taxes.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
  TaxCalculationDto,
} from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('taxes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @Post()
  @Permissions('taxes:create')
  async create(
    @Body() createTaxCategoryDto: CreateTaxCategoryDto,
    @CurrentUser() user: any,
  ) {
    return this.taxesService.create(createTaxCategoryDto, user);
  }

  @Post('calculate')
  @Permissions('taxes:read')
  async calculateTax(@Body() calculationDto: TaxCalculationDto) {
    return this.taxesService.calculateTax(calculationDto);
  }

  @Get()
  @Permissions('taxes:read')
  async findAll(@Query() query: TaxCategoryQueryDto) {
    return this.taxesService.findAll(query);
  }

  @Get('store/:storeId')
  @Permissions('taxes:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: TaxCategoryQueryDto,
  ) {
    return this.taxesService.findByStore(storeId, query);
  }

  @Get(':id')
  @Permissions('taxes:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.taxesService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Patch(':id')
  @Permissions('taxes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTaxCategoryDto: UpdateTaxCategoryDto,
    @CurrentUser() user: any,
  ) {
    return this.taxesService.update(id, updateTaxCategoryDto, user);
  }

  @Patch(':id/activate')
  @Permissions('taxes:update')
  async activate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.taxesService.activate(id, user);
  }

  @Patch(':id/deactivate')
  @Permissions('taxes:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.taxesService.deactivate(id, user);
  }

  @Delete(':id')
  @Permissions('taxes:admin_delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.taxesService.remove(id, user);
  }
}
