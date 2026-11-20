import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ServiceIndustryGuard } from '../../../common/guards/service-industry.guard';
import { TemplatesService } from './templates.service';
import { TemplateImportService } from './template-import.service';
import {
  TEMPLATE_DRAFT_MAX_BYTES,
  TemplateAiDraftService,
} from './ai-draft/template-ai-draft.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SetProductTemplateDto } from './dto/set-product-template.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/data-collection/templates')
@UseGuards(PermissionsGuard)
export class TemplatesController {
  constructor(
    private readonly service: TemplatesService,
    private readonly importService: TemplateImportService,
    private readonly aiDraftService: TemplateAiDraftService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:settings:read')
  async findAll(@Query('status') status?: string) {
    const result = await this.service.findAll(status);
    return this.responseService.success(result);
  }

  @Get('product/:productId')
  @UseGuards(ServiceIndustryGuard)
  @Permissions('store:products:read')
  async getProductTemplate(
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const result = await this.service.getProductTemplateLink(productId);
    return this.responseService.success(result);
  }

  @Put('product/:productId')
  @UseGuards(ServiceIndustryGuard)
  @Permissions('store:products:update')
  async setProductTemplate(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: SetProductTemplateDto,
  ) {
    const result = await this.service.setProductTemplateLink(
      productId,
      dto.template_id ?? null,
    );
    return this.responseService.success(
      result,
      'Plantilla del servicio actualizada correctamente',
    );
  }

  @Get(':id')
  @Permissions('store:settings:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.findOne(id);
    return this.responseService.success(result);
  }

  @Post()
  @Permissions('store:settings:write')
  async create(@Body() dto: CreateTemplateDto) {
    const result = await this.service.createTemplate(dto);
    return this.responseService.success(
      result,
      'Plantilla creada correctamente',
    );
  }

  /**
   * Imports a template from the portable JSON contract. The body is raw JSON
   * (`@Body() body: unknown` reflects as Object, so the global whitelist
   * ValidationPipe leaves it intact; the contract validates it).
   */
  @Post('import')
  @Permissions('store:settings:write')
  async importTemplate(
    @Body() body: unknown,
    @Query('dry_run') dryRun?: string,
  ) {
    const isDryRun = dryRun === 'true' || dryRun === '1';
    const result = await this.importService.import(body, isDryRun);
    return this.responseService.success(
      result,
      isDryRun
        ? 'La plantilla JSON es válida'
        : 'Plantilla importada como borrador',
    );
  }

  /**
   * «Crear con IA (PDF/foto)»: enqueues a draft on the `ai-scan` queue
   * (202 + job_id). The AI only produces a draft; the user reviews it in the
   * JSON modal and imports it through `POST import`.
   */
  @Post('ai-draft')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('store:settings:write')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: TEMPLATE_DRAFT_MAX_BYTES, files: 1 },
    }),
  )
  async startAiDraft(@UploadedFile() file?: Express.Multer.File) {
    const result = await this.aiDraftService.enqueue(file);
    return this.responseService.success(result, 'Leyendo el formulario con IA');
  }

  /** Draft status: pending | done ({ json, errors }) | failed. Owner-checked. */
  @Get('ai-draft/:jobId')
  @Permissions('store:settings:write')
  async getAiDraft(@Param('jobId') jobId: string) {
    const result = await this.aiDraftService.getStatus(jobId);
    return this.responseService.success(result);
  }

  @Patch(':id')
  @Permissions('store:settings:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTemplateDto,
  ) {
    const result = await this.service.updateTemplate(id, dto);
    return this.responseService.success(
      result,
      'Plantilla actualizada correctamente',
    );
  }

  @Post(':id/duplicate')
  @Permissions('store:settings:write')
  async duplicate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.duplicateTemplate(id);
    return this.responseService.success(
      result,
      'Plantilla duplicada correctamente',
    );
  }

  @Delete(':id')
  @Permissions('store:settings:write')
  async delete(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.deleteTemplate(id);
    return this.responseService.success(
      result,
      'Plantilla eliminada correctamente',
    );
  }

  @Post(':id/products')
  @Permissions('store:settings:write')
  async assignProducts(
    @Param('id', ParseIntPipe) id: number,
    @Body('product_ids') productIds: number[],
  ) {
    const result = await this.service.assignProducts(id, productIds);
    return this.responseService.success(
      result,
      'Productos asignados correctamente',
    );
  }
}
