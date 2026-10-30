import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { ProductOptionsService } from './product-options.service';
import { ProductOptionGroupInputDto } from './dto/product-options.dto';

@Controller('store/product-option-groups')
@UseGuards(PermissionsGuard)
export class ProductOptionsController {
  constructor(
    private readonly productOptions: ProductOptionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:product_options:read')
  async list() {
    return this.responseService.success(await this.productOptions.list(), 'Grupos de adiciones obtenidos');
  }

  /** Grupos aplicables a un producto (POS). Ajuste apagado → []. */
  @Get('for-product/:productId')
  @Permissions('store:product_options:read')
  async forProduct(@Param('productId', ParseIntPipe) productId: number) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const groups = await this.productOptions.applicableForProduct(store_id, productId);
    return this.responseService.success(groups, 'Adiciones del producto obtenidas');
  }

  @Get(':id')
  @Permissions('store:product_options:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.productOptions.findOne(id), 'Grupo de adiciones obtenido');
  }

  @Post()
  @Permissions('store:product_options:manage')
  async create(@Body() dto: ProductOptionGroupInputDto) {
    return this.responseService.success(await this.productOptions.create(dto), 'Grupo de adiciones creado');
  }

  @Put(':id')
  @Permissions('store:product_options:manage')
  async replace(@Param('id', ParseIntPipe) id: number, @Body() dto: ProductOptionGroupInputDto) {
    return this.responseService.success(await this.productOptions.replace(id, dto), 'Grupo de adiciones actualizado');
  }

  @Delete(':id')
  @Permissions('store:product_options:manage')
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.productOptions.deactivate(id), 'Grupo de adiciones desactivado');
  }
}
