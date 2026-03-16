import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmployeesBulkService } from './employees-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { BulkEmployeeUploadDto } from './dto/bulk-employee.dto';

@Controller('store/payroll/employees/bulk')
@UseGuards(PermissionsGuard)
export class EmployeesBulkController {
  private readonly HEADER_TRANSLATIONS: Record<string, string> = {
    nombre: 'first_name',
    apellido: 'last_name',
    'tipo documento': 'document_type',
    'número documento': 'document_number',
    'numero documento': 'document_number',
    'fecha contratación': 'hire_date',
    'fecha contratacion': 'hire_date',
    'tipo contrato': 'contract_type',
    'salario base': 'base_salary',
    cargo: 'position',
    departamento: 'department',
    'frecuencia pago': 'payment_frequency',
    banco: 'bank_name',
    'número cuenta': 'bank_account_number',
    'numero cuenta': 'bank_account_number',
    'tipo cuenta': 'bank_account_type',
    eps: 'health_provider',
    'fondo pensión': 'pension_fund',
    'fondo pension': 'pension_fund',
    'nivel riesgo arl': 'arl_risk_level',
    'fondo cesantías': 'severance_fund',
    'fondo cesantias': 'severance_fund',
    'caja compensación': 'compensation_fund',
    'caja compensacion': 'compensation_fund',
    '¿es usuario?': 'is_user',
    'es usuario': 'is_user',
    email: 'email',
    correo: 'email',
    teléfono: 'phone',
    telefono: 'phone',
  };

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
}
