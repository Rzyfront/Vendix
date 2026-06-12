import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendorSupportDocumentsService } from './vendor-support-documents.service';
import { VendorSupportFiscalService } from './vendor-support-fiscal.service';
import { CreateVendorSupportDocumentDto } from './dto/create-vendor-support-document.dto';
import { UpdateVendorSupportDocumentDto } from './dto/update-vendor-support-document.dto';
import { QueryVendorSupportDocumentDto } from './dto/query-vendor-support-document.dto';
import {
  PatchVendorSupportFiscalConfigDto,
  RetryVendorSupportFiscalDto,
  VendorSupportFiscalQueryDto,
} from './dto/vendor-support-fiscal.dto';
import { RequestContextService } from '../../../../common/context/request-context.service';

@Controller('super-admin/fiscal/invoicing/inbound')
@UseGuards(PermissionsGuard)
export class VendorSupportDocumentsController {
  constructor(
    private readonly service: VendorSupportDocumentsService,
    private readonly fiscalService: VendorSupportFiscalService,
    private readonly response: ResponseService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // Fiscal config + transmissions (must be declared BEFORE
  // dynamic ':id' routes so Express does not capture
  // 'fiscal' / 'transmissions' as an id).
  // ─────────────────────────────────────────────────────────

  @Get('fiscal/config')
  @Permissions('superadmin:fiscal:invoicing')
  async getFiscalConfig() {
    return this.response.success(await this.fiscalService.getConfig());
  }

  @Patch('fiscal/config')
  @Permissions('superadmin:fiscal:invoicing')
  async patchFiscalConfig(
    @Body() dto: PatchVendorSupportFiscalConfigDto,
  ) {
    const userId = RequestContextService.getUserId() ?? null;
    return this.response.updated(
      await this.fiscalService.patchConfig(dto, userId),
      'Vendor support fiscal configuration saved',
    );
  }

  @Get('transmissions')
  @Permissions('superadmin:fiscal:invoicing')
  async listTransmissions(
    @Query() query: VendorSupportFiscalQueryDto,
  ) {
    const result = await this.fiscalService.listTransmissions(query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Vendor support fiscal transmissions retrieved',
    );
  }

  @Post('transmissions/:id/retry')
  @Permissions('superadmin:fiscal:invoicing')
  @HttpCode(HttpStatus.OK)
  async retryTransmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() _dto: RetryVendorSupportFiscalDto,
  ) {
    return this.response.success(
      await this.fiscalService.retryTransmission(id),
      'Vendor support fiscal transmission retry requested',
    );
  }

  @Get()
  @Permissions('superadmin:fiscal:invoicing')
  async findAll(@Query() query: QueryVendorSupportDocumentDto) {
    const result = await this.service.findAll(query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Get(':id')
  @Permissions('superadmin:fiscal:invoicing')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.findOne(id));
  }

  @Post()
  @Permissions('superadmin:fiscal:invoicing')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateVendorSupportDocumentDto,
    @Req() req: any,
  ) {
    const userId = (req?.user?.id as number | undefined) ?? null;
    return this.response.created(
      await this.service.create(dto, userId),
      'Vendor support document created',
    );
  }

  @Patch(':id')
  @Permissions('superadmin:fiscal:invoicing')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVendorSupportDocumentDto,
    @Req() req: any,
  ) {
    const userId = (req?.user?.id as number | undefined) ?? null;
    return this.response.updated(
      await this.service.update(id, dto, userId),
      'Vendor support document updated',
    );
  }

  @Post(':id/approve')
  @Permissions('superadmin:fiscal:invoicing')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const userId = (req?.user?.id as number | undefined) ?? null;
    return this.response.updated(
      await this.service.approve(id, userId),
      'Vendor support document approved',
    );
  }

  @Post(':id/mark-paid')
  @Permissions('superadmin:fiscal:invoicing')
  @HttpCode(HttpStatus.OK)
  async markPaid(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const userId = (req?.user?.id as number | undefined) ?? null;
    return this.response.updated(
      await this.service.markPaid(id, userId),
      'Vendor support document marked as paid',
    );
  }

  @Post(':id/void')
  @Permissions('superadmin:fiscal:invoicing')
  @HttpCode(HttpStatus.OK)
  async voidDoc(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const userId = (req?.user?.id as number | undefined) ?? null;
    return this.response.updated(
      await this.service.void(id, userId),
      'Vendor support document voided',
    );
  }

  @Post(':id/transmit')
  @Permissions('superadmin:fiscal:invoicing')
  @HttpCode(HttpStatus.OK)
  async transmit(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.fiscalService.transmit(id, {
        manual: true,
        source: 'manual',
      }),
      'Vendor support fiscal transmission requested',
    );
  }

  @Post(':id/upload-pdf')
  @Permissions('superadmin:fiscal:invoicing')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async uploadPdf(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.response.updated(
      await this.service.uploadPdf(id, file),
      'PDF uploaded for vendor support document',
    );
  }

  @Delete(':id')
  @Permissions('superadmin:fiscal:invoicing')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    const userId = (req?.user?.id as number | undefined) ?? null;
    await this.service.remove(id, userId);
    return this.response.deleted('Vendor support document deleted');
  }
}
