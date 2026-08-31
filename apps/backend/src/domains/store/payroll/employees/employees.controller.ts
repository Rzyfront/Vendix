import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeeFiscalProfileService } from './employee-fiscal-profile.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import {
  EmployeeFiscalProfileDto,
  CalculateSemesterRateDto,
} from './dto/employee-fiscal-profile.dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';

/**
 * QUI-730 — `JwtAuthGuard` global deja pasar a cualquier usuario del tenant,
 * pero `PermissionsGuard` no es global. Antes de este parche, un `mesero`
 * podía leer la nómina completa y mutar empleados / perfiles fiscales: 6
 * GETs + 1 POST + 2 PATCH + 1 PUT con el mismo peso que un owner.
 *
 * Estrategia (recomendada por el ticket para este archivo):
 *  - `@UseGuards(PermissionsGuard)` a nivel clase: cubre los 10 handlers
 *    con un solo decorator (estilo distinto al por-método de `store-roles`).
 *  - `@Permissions(...)` por método: el más específico para cada operación.
 *    Sin esto, todos los métodos exigirían solo `:read` y un cashier con
 *    `store:payroll:employees:read` podría POSTear empleados.
 *
 * Permisos ya sembrados (verificados en DB): `store:payroll:employees:read`,
 * `:create`, `:update` portados por admin, manager, owner, Preventista,
 * super_admin. Cashier/mesero NO los portan — quedan fuera automáticamente.
 */
@Controller('store/payroll/employees')
@UseGuards(PermissionsGuard)
export class EmployeesController {
  constructor(
    private readonly employees_service: EmployeesService,
    private readonly fiscal_profile_service: EmployeeFiscalProfileService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:payroll:employees:read')
  async findAll(@Query() query_dto: QueryEmployeeDto) {
    const result = await this.employees_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  @Get('stats')
  @Permissions('store:payroll:employees:read')
  async getStats() {
    const result = await this.employees_service.getStats();
    return this.response_service.success(result);
  }

  @Get('available-users')
  @Permissions('store:payroll:employees:read')
  async getAvailableUsers() {
    const result = await this.employees_service.getAvailableUsers();
    return this.response_service.success(result);
  }

  // --- Parameter Routes ---

  @Get(':id')
  @Permissions('store:payroll:employees:read')
  async findOne(@Param('id') id: string) {
    const result = await this.employees_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('store:payroll:employees:create')
  async create(@Body() create_dto: CreateEmployeeDto) {
    const result = await this.employees_service.create(create_dto);
    return this.response_service.success(
      result,
      'Employee created successfully',
    );
  }

  @Patch(':id')
  @Permissions('store:payroll:employees:update')
  async update(@Param('id') id: string, @Body() update_dto: UpdateEmployeeDto) {
    const result = await this.employees_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Employee updated successfully',
    );
  }

  @Patch(':id/terminate')
  @Permissions('store:payroll:employees:update')
  async terminate(@Param('id') id: string) {
    const result = await this.employees_service.terminate(+id);
    return this.response_service.success(
      result,
      'Employee terminated successfully',
    );
  }

  // ── Fiscal profile (art. 387 ET — deducciones retefuente laboral) ──

  @Get(':id/fiscal-profile')
  @Permissions('store:payroll:employees:read')
  async getFiscalProfile(@Param('id') id: string) {
    const result = await this.fiscal_profile_service.getOrCreate(+id);
    return this.response_service.success(result);
  }

  @Put(':id/fiscal-profile')
  @Permissions('store:payroll:employees:update')
  async upsertFiscalProfile(
    @Param('id') id: string,
    @Body() dto: EmployeeFiscalProfileDto,
  ) {
    const result = await this.fiscal_profile_service.upsert(+id, dto);
    return this.response_service.success(
      result,
      'Fiscal profile updated successfully',
    );
  }

  /**
   * B5 — Procedimiento 2 (art. 386 ET): calcula el porcentaje fijo del
   * semestre indicado (o el vigente, si se omite `semester`) a partir del
   * histórico de 12 meses de `payroll_items`, y lo persiste en el perfil
   * fiscal junto con `retention_procedure='proc2'`.
   */
  @Post(':id/fiscal-profile/calculate-semester-rate')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:payroll:employees:read')
  async calculateSemesterRate(
    @Param('id') id: string,
    @Body() dto: CalculateSemesterRateDto,
  ) {
    const result = await this.fiscal_profile_service.calculateSemesterRate(
      +id,
      dto.semester,
    );
    return this.response_service.success(
      result,
      'Fixed semester rate calculated successfully',
    );
  }
}
