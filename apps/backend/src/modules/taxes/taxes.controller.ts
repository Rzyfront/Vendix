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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TaxesService } from './taxes.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
} from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('taxes')
@UseGuards(PermissionsGuard)
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @Post()
  @Permissions('taxes:create')
  create(
    @Body() createTaxCategoryDto: CreateTaxCategoryDto,
    @CurrentUser() user: any,
  ) {
    return this.taxesService.create(createTaxCategoryDto, user);
  }

  @Get()
  @Permissions('taxes:read')
  findAll(@Query() query: TaxCategoryQueryDto) {
    return this.taxesService.findAll(query);
  }

  @Get(':id')
  @Permissions('taxes:read')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.taxesService.findOne(id, user);
  }

  @Patch(':id')
  @Permissions('taxes:update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTaxCategoryDto: UpdateTaxCategoryDto,
    @CurrentUser() user: any,
  ) {
    return this.taxesService.update(id, updateTaxCategoryDto, user);
  }

  @Delete(':id')
  @Permissions('taxes:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.taxesService.remove(id, user);
  }
}