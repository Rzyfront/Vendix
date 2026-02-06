import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CustomersBulkService } from './customers-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { BulkCustomerUploadDto } from './dto/bulk-customer.dto';

@Controller('store/customers/bulk')
@UseGuards(PermissionsGuard)
export class CustomersBulkController {
  constructor(
    private readonly customersBulkService: CustomersBulkService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Descarga la plantilla en formato Excel (.xlsx)
   */
  @Get('template/download')
  @Permissions('store:customers:create')
  async downloadTemplate(@Res() res: Response) {
    try {
      const buffer = await this.customersBulkService.generateExcelTemplate();

      const filename = `plantilla_clientes_${new Date().toISOString().split('T')[0]}.xlsx`;

      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length,
      });

      res.end(buffer);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { message: error.message },
      });
    }
  }

  /**
   * Carga masiva desde JSON directo
   */
  @Post('upload')
  @Permissions('store:customers:create')
  async uploadCustomers(@Body() bulkUploadDto: BulkCustomerUploadDto) {
    try {
      const result =
        await this.customersBulkService.uploadCustomers(bulkUploadDto);

      if (result.failed > 0) {
        return this.responseService.created(
          result,
          'Carga masiva completada con algunos errores',
        );
      }

      return this.responseService.created(
        result,
        'Carga masiva completada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message,
        error.message,
        error.status || 400,
      );
    }
  }
}
