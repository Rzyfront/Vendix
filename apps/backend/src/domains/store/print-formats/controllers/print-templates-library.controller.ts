import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { print_format_type_enum } from '@prisma/client';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PrintFormatsService } from '../services/print-formats.service';
import {
  CreatePrintTemplateDto,
  UpdateTemplateShareDto,
} from '../dto/print-template.dto';

@ApiTags('Store Print Templates Library')
@Controller('store/print-formats/library')
@UseGuards(PermissionsGuard)
export class PrintTemplatesLibraryController {
  constructor(
    private readonly printFormatsService: PrintFormatsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:settings:read', 'store:settings:read', 'invoicing:read')
  // `invoicing:read` se suma el 2026-08-24: el selector de formato de la
  // factura (E.1) lista esta biblioteca, y quien factura no siempre tiene
  // permisos de ajustes de tienda u organización.
  @ApiOperation({ summary: 'List shared print templates available for organization' })
  async listTemplates(@Query('formatType') formatType?: print_format_type_enum) {
    const context = RequestContextService.getContext();
    const orgId = context?.organization_id;

    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }

    const templates = await this.printFormatsService.listLibraryTemplates(orgId, formatType);
    return this.responseService.success(templates);
  }

  @Post()
  @Permissions('organization:settings:update', 'store:settings:update')
  @ApiOperation({ summary: 'Create new organization print template' })
  async createTemplate(@Body() dto: CreatePrintTemplateDto) {
    const context = RequestContextService.getContext();
    const orgId = context?.organization_id;
    const userId = context?.user_id;

    if (!orgId || !userId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }

    const template = await this.printFormatsService.createLibraryTemplate(
      orgId,
      userId,
      dto,
    );
    return this.responseService.success(template, 'Plantilla creada exitosamente en la biblioteca.');
  }

  @Post(':id/clone')
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Clone a library template to current store configuration' })
  async cloneTemplate(@Param('id', ParseIntPipe) templateId: number) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const orgId = context?.organization_id;

    if (!storeId || !orgId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const cloned = await this.printFormatsService.cloneTemplateToStore(
      storeId,
      orgId,
      templateId,
    );
    return this.responseService.success(cloned, 'Plantilla clonada y aplicada a la tienda.');
  }

  @Put(':id/share')
  @Permissions('organization:settings:update', 'store:settings:update')
  @ApiOperation({ summary: 'Update template sharing status across organization stores' })
  async updateShare(
    @Param('id', ParseIntPipe) templateId: number,
    @Body() dto: UpdateTemplateShareDto,
  ) {
    const context = RequestContextService.getContext();
    const orgId = context?.organization_id;

    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }

    const updated = await this.printFormatsService.updateTemplateShareState(
      orgId,
      templateId,
      dto.is_shared,
    );
    return this.responseService.success(updated, 'Estado de visibilidad de plantilla actualizado.');
  }
}
