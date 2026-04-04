import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmployeesBulkService } from './employees-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { RequestContextService } from '@common/context/request-context.service';
import { BulkEmployeeUploadDto } from './dto/bulk-employee.dto';

@Controller('store/payroll/employees/bulk')
@UseGuards(PermissionsGuard)
export class EmployeesBulkController {
  constructor(
    private readonly employeesBulkService: EmployeesBulkService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('upload')
  @Permissions('store:payroll:employees:bulk:upload')
  async uploadEmployees(
    @Body() bulkUploadDto: BulkEmployeeUploadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.employeesBulkService.uploadEmployees(
        bulkUploadDto,
        req.user,
      );

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
      throw error;
    }
  }

  @Get('template/download')
  @Permissions('store:payroll:employees:bulk:template')
  async downloadTemplate(@Res() res: Response) {
    try {
      const buffer = this.employeesBulkService.generateExcelTemplate();

      const filename = `plantilla_empleados_${new Date().toISOString().split('T')[0]}.xlsx`;

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

  @Post('upload/file')
  @Permissions('store:payroll:employees:bulk:upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadEmployeesFromFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
        ],
      }),
    )
    file: any,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const employees = this.employeesBulkService.parseFile(file.buffer);

      const validationResult =
        this.employeesBulkService.validateBulkEmployees(employees);

      if (!validationResult.isValid) {
        return this.responseService.success(
          validationResult,
          'Se encontraron errores en el archivo',
        );
      }

      const uploadResult = await this.employeesBulkService.uploadEmployees(
        { employees: validationResult.validEmployees },
        req.user,
      );

      if (uploadResult.failed > 0) {
        return this.responseService.created(
          uploadResult,
          'Archivo procesado con algunos errores',
        );
      }

      return this.responseService.created(
        uploadResult,
        'Archivo procesado exitosamente',
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Analiza archivo Excel/CSV sin procesar (dry-run)
   */
  @Post('analyze')
  @Permissions('store:payroll:employees:bulk:upload')
  @UseInterceptors(FileInterceptor('file'))
  async analyzeEmployees(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
        ],
      }),
    )
    file: any,
  ) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const organizationId = context?.organization_id;
    if (!storeId || !organizationId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    const result = await this.employeesBulkService.analyzeEmployees(
      file.buffer,
      storeId,
      organizationId,
    );

    return this.responseService.success(result, 'Analisis completado');
  }

  /**
   * Procesa carga masiva desde sesion de analisis
   */
  @Post('upload-session')
  @Permissions('store:payroll:employees:bulk:upload')
  async uploadFromSession(
    @Body() body: { session_id: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }
    if (!body.session_id) {
      throw new BadRequestException('session_id es requerido');
    }

    const result = await this.employeesBulkService.uploadFromSession(
      body.session_id,
      storeId,
      req.user,
    );

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
  }

  /**
   * Cancela sesion de analisis
   */
  @Delete('session/:id')
  @Permissions('store:payroll:employees:bulk:upload')
  async cancelSession(@Param('id') sessionId: string) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    await this.employeesBulkService.cancelSession(sessionId, storeId);

    return this.responseService.success(null, 'Sesion cancelada');
  }
}
