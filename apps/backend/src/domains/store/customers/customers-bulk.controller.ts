import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Res,
  Req,
  HttpCode,
  Optional,
} from '@nestjs/common';
import { Response } from 'express';
import { CustomersBulkService } from './customers-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { BulkCustomerUploadDto } from './dto/bulk-customer.dto';
import { BulkUploadJobsService } from '../bulk-uploads/bulk-upload-jobs.service';
import { snapshotBulkJobUser } from '../bulk-uploads/bulk-upload-job.util';
import { sha256Hex } from '../bulk-uploads/bulk-file-fingerprint.util';
import { CustomersBulkJobHandler } from './customers-bulk-job.handler';
import { BulkCustomersJobDto } from './dto/bulk-customers-job.dto';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';

@Controller('store/customers/bulk')
@UseGuards(PermissionsGuard)
export class CustomersBulkController {
  constructor(
    private readonly customersBulkService: CustomersBulkService,
    private readonly responseService: ResponseService,
    @Optional() private readonly bulkJobs?: BulkUploadJobsService,
    @Optional() private readonly jobHandler?: CustomersBulkJobHandler,
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
   * Carga masiva desde JSON directo.
   *
   * La validación DTO corre a través del `ValidationPipe` global de
   * `main.ts`, cuyo `exceptionFactory` detecta el patrón
   * `customers.<rowIndex>.<field>` y aplana los errores al shape canónico
   * `BulkRowError` (`row`, `column`, `field`, `value`, `message`, `code`,
   * `suggestion`). Esos errores llegan al cliente en
   * `response.error.details.validationErrors` para que el modal de carga
   * masiva los pinte por fila.
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

  /**
   * QUI-1009 — guarda las filas en S3 y encola la carga como trabajo durable
   * (202). Si encolar falla, el archivo temporal se descarta.
   */
  @Post('jobs')
  @HttpCode(202)
  @Permissions('store:customers:create')
  async enqueueUploadJob(
    @Body() body: BulkCustomersJobDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const s3Key = await this.jobHandler!.stageRows(body.customers);
    try {
      const view = await this.bulkJobs!.enqueue({
        upload_type: 'customers',
        file_name: body.file_name,
        // Sin huella del navegador, la de las filas: el historial la exige.
        file_hash: body.file_hash ?? sha256Hex(JSON.stringify(body.customers)),
        params: { s3_key: s3Key },
        total_rows: body.customers.length,
        user: snapshotBulkJobUser(req.user),
      });
      return this.responseService.success(view, 'Carga encolada');
    } catch (error) {
      await this.jobHandler!.discardStaged(s3Key);
      throw error;
    }
  }
}
