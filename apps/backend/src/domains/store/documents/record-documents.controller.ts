import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import type { AttachableEntityType } from './documents.constants';
import { RecordDocumentsService } from './record-documents.service';
import { FolderFilesQueryDto } from './search/document-search.dto';

/**
 * "Documentos" tab of a record's detail page (B1). Deliberately WITHOUT
 * `IndustryModuleGuard`: the document library is an `administration` module,
 * but a retail, restaurant or gym store also files documents against its
 * orders and customers (Vex, T44) and must be able to open them. Each route
 * asks the record's own read permission (`RECORD_READ_PERMISSION`, the one
 * its `GET :id` asks), so the real `PermissionsGuard` decides.
 */
@Controller('store/record-documents')
@UseGuards(PermissionsGuard)
export class RecordDocumentsController {
  constructor(
    private readonly records: RecordDocumentsService,
    private readonly responseService: ResponseService,
  ) {}

  private async listOf(
    type: AttachableEntityType,
    id: number,
    query: FolderFilesQueryDto,
  ) {
    const r = await this.records.list(type, id, query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  private async downloadOf(
    type: AttachableEntityType,
    id: number,
    fileId: number,
  ) {
    return this.responseService.success(
      await this.records.download(type, id, fileId),
    );
  }

  @Get('order/:id')
  @Permissions('store:orders:read')
  orderFiles(@Param('id', ParseIntPipe) id: number, @Query() q: FolderFilesQueryDto) {
    return this.listOf('order', id, q);
  }

  @Get('order/:id/files/:fileId/download')
  @Permissions('store:orders:read')
  orderDownload(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number) {
    return this.downloadOf('order', id, fileId);
  }

  @Get('customer/:id')
  @Permissions('store:customers:read')
  customerFiles(@Param('id', ParseIntPipe) id: number, @Query() q: FolderFilesQueryDto) {
    return this.listOf('customer', id, q);
  }

  @Get('customer/:id/files/:fileId/download')
  @Permissions('store:customers:read')
  customerDownload(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number) {
    return this.downloadOf('customer', id, fileId);
  }

  @Get('purchase_order/:id')
  @Permissions('store:orders:purchase_orders:read')
  purchaseOrderFiles(@Param('id', ParseIntPipe) id: number, @Query() q: FolderFilesQueryDto) {
    return this.listOf('purchase_order', id, q);
  }

  @Get('purchase_order/:id/files/:fileId/download')
  @Permissions('store:orders:purchase_orders:read')
  purchaseOrderDownload(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number) {
    return this.downloadOf('purchase_order', id, fileId);
  }

  @Get('supplier/:id')
  @Permissions('store:inventory:suppliers:read')
  supplierFiles(@Param('id', ParseIntPipe) id: number, @Query() q: FolderFilesQueryDto) {
    return this.listOf('supplier', id, q);
  }

  @Get('supplier/:id/files/:fileId/download')
  @Permissions('store:inventory:suppliers:read')
  supplierDownload(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number) {
    return this.downloadOf('supplier', id, fileId);
  }

  @Get('expense/:id')
  @Permissions('store:expenses:read')
  expenseFiles(@Param('id', ParseIntPipe) id: number, @Query() q: FolderFilesQueryDto) {
    return this.listOf('expense', id, q);
  }

  @Get('expense/:id/files/:fileId/download')
  @Permissions('store:expenses:read')
  expenseDownload(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number) {
    return this.downloadOf('expense', id, fileId);
  }

  @Get('product/:id')
  @Permissions('store:products:read')
  productFiles(@Param('id', ParseIntPipe) id: number, @Query() q: FolderFilesQueryDto) {
    return this.listOf('product', id, q);
  }

  @Get('product/:id/files/:fileId/download')
  @Permissions('store:products:read')
  productDownload(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number) {
    return this.downloadOf('product', id, fileId);
  }
}
