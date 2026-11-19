import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CustomerDataSheetService } from './customer-data-sheet.service';
import {
  SaveCustomerDataSheetValuesDto,
  SetCustomerDataTemplateDto,
} from './dto/customer-data-sheet.dto';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Customer data sheet (QUI-1043 H5/H8), shared by the customer profile and
 * the opportunity detail.
 *
 *   GET  /store/customers/:customerId/crm/data-sheet
 *   PUT  /store/customers/:customerId/crm/data-sheet/template  {template_id|null}
 *   PUT  /store/customers/:customerId/crm/data-sheet/values    {values[]}
 *   POST /store/customers/:customerId/crm/data-sheet/upload    multipart `file`, max 10 MB
 */
@Controller('store/customers/:customerId/crm/data-sheet')
@UseGuards(PermissionsGuard)
export class CustomerDataSheetController {
  constructor(
    private readonly service: CustomerDataSheetService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:customers:read')
  async get(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.response.success(await this.service.get(customerId));
  }

  @Put('template')
  @Permissions('store:customers:update')
  async setTemplate(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: SetCustomerDataTemplateDto,
  ) {
    return this.response.success(
      await this.service.setTemplate(customerId, dto.template_id),
      'Plantilla del cliente actualizada',
    );
  }

  @Put('values')
  @Permissions('store:customers:update')
  async saveValues(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: SaveCustomerDataSheetValuesDto,
  ) {
    return this.response.success(
      await this.service.saveValues(customerId, dto.values),
      'Datos del cliente guardados',
    );
  }

  @Post('upload')
  @Permissions('store:customers:update')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  async upload(
    @Param('customerId', ParseIntPipe) customerId: number,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.response.success(
      await this.service.upload(customerId, file),
      'Archivo subido',
    );
  }
}
