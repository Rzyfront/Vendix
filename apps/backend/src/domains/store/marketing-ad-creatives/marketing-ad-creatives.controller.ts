import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ResponseService } from '../../../common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  CreateMarketingAdCreativeDto,
  CreateManualMarketingAdCreativeDto,
  QueryMarketingAdCreativesDto,
  UpdateMarketingAdCreativeDetailsDto,
} from './dto';
import { MarketingAdCreativesService } from './marketing-ad-creatives.service';

@Controller('store/marketing/ad-creatives')
@UseGuards(PermissionsGuard)
export class MarketingAdCreativesController {
  constructor(
    private readonly adCreativesService: MarketingAdCreativesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('summary')
  @Permissions(
    'store:marketing_anuncios:read',
    'store:promotions:read',
    'store:social_sales:read',
  )
  async getSummary() {
    const result = await this.adCreativesService.getSummary();
    return this.responseService.success(result);
  }

  @Get()
  @Permissions(
    'store:marketing_anuncios:read',
    'store:promotions:read',
    'store:social_sales:read',
  )
  async findAll(@Query() query: QueryMarketingAdCreativesDto) {
    const result = await this.adCreativesService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get('ecommerce-domain')
  @Permissions(
    'store:marketing_anuncios:read',
    'store:promotions:read',
    'store:social_sales:read',
  )
  async getEcommerceDomain() {
    const result = await this.adCreativesService.getEcommerceDomain();
    return this.responseService.success(result);
  }

  @Post()
  @Permissions(
    'store:marketing_anuncios:create',
    'store:promotions:create',
    'store:social_sales:manage',
  )
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateMarketingAdCreativeDto) {
    const result = await this.adCreativesService.create(dto);
    return this.responseService.created(result, 'Anuncio creado');
  }

  @Post('manual')
  @Permissions(
    'store:marketing_anuncios:create',
    'store:promotions:create',
    'store:social_sales:manage',
  )
  @HttpCode(HttpStatus.CREATED)
  async createManual(@Body() dto: CreateManualMarketingAdCreativeDto) {
    const result = await this.adCreativesService.createManual(dto);
    return this.responseService.created(result, 'Anuncio manual creado');
  }

  @Sse(':id/generate-stream')
  @Permissions(
    'store:marketing_anuncios:generate',
    'store:promotions:create',
    'store:social_sales:manage',
  )
  generateStream(
    @Param('id', ParseIntPipe) id: number,
    @Query('request_id') requestId?: string,
  ): Observable<MessageEvent> {
    return this.adCreativesService.streamGenerate(id, requestId);
  }

  @Get(':id')
  @Permissions(
    'store:marketing_anuncios:read',
    'store:promotions:read',
    'store:social_sales:read',
  )
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.adCreativesService.findOne(id);
    return this.responseService.success(result);
  }

  @Patch(':id')
  @Permissions(
    'store:marketing_anuncios:update',
    'store:promotions:update',
    'store:social_sales:manage',
  )
  async updateDetails(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMarketingAdCreativeDetailsDto,
  ) {
    const result = await this.adCreativesService.updateDetails(id, dto);
    return this.responseService.updated(result, 'Anuncio actualizado');
  }

  @Delete(':id')
  @Permissions(
    'store:marketing_anuncios:delete',
    'store:promotions:delete',
    'store:social_sales:manage',
  )
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.adCreativesService.remove(id);
    return this.responseService.deleted('Anuncio eliminado');
  }
}
