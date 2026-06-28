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
  Req,
  Res,
  Sse,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { ResponseService } from '../../../common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  CreateMarketingAdCreativeDto,
  CreateManualMarketingAdCreativeDto,
  QueryMarketingAdCreativesDto,
  SuggestMarketingAdPromptDto,
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

  @Get('product-images/:imageId/proxy')
  @Permissions(
    'store:marketing_anuncios:read',
    'store:marketing_anuncios:create',
    'store:marketing_anuncios:generate',
    'store:promotions:read',
    'store:social_sales:read',
  )
  async proxyProductImage(
    @Param('imageId', ParseIntPipe) imageId: number,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adCreativesService.getProductImageAsset(imageId);
    const origin = request.headers.origin;

    if (typeof origin === 'string') {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    return new StreamableFile(result.buffer);
  }

  @Get(':id/image')
  @Permissions(
    'store:marketing_anuncios:read',
    'store:marketing_anuncios:create',
    'store:marketing_anuncios:generate',
    'store:promotions:read',
    'store:social_sales:read',
  )
  async proxyCreativeImage(
    @Param('id', ParseIntPipe) id: number,
    @Query('variant') variant: 'full' | 'thumb' | undefined,
    @Query('disposition') disposition: 'attachment' | 'inline' | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adCreativesService.getCreativeImageAsset(
      id,
      variant ?? 'full',
    );
    const origin = request.headers.origin;

    if (typeof origin === 'string') {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (disposition === 'attachment') {
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.fileName}"`,
      );
    } else {
      response.setHeader(
        'Content-Disposition',
        `inline; filename="${result.fileName}"`,
      );
    }

    return new StreamableFile(result.buffer);
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

  @Post('suggest-prompt')
  @Permissions(
    'store:marketing_anuncios:create',
    'store:marketing_anuncios:generate',
    'store:promotions:create',
    'store:social_sales:manage',
  )
  @HttpCode(HttpStatus.OK)
  async suggestPrompt(@Body() dto: SuggestMarketingAdPromptDto) {
    const result = await this.adCreativesService.suggestPrompt(dto);
    return this.responseService.success(result, 'Sugerencia generada');
  }

  @Sse(':id/generate-stream')
  @Permissions(
    'store:marketing_anuncios:generate',
    'store:promotions:create',
    'store:social_sales:manage',
  )
  generateStream(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    const requestId =
      typeof req.query.request_id === 'string'
        ? req.query.request_id
        : undefined;
    const correction = String(req.query.correction ?? '');
    return this.adCreativesService.streamGenerate(id, requestId, correction);
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
