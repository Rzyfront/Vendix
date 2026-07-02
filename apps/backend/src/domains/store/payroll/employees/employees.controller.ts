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

@Controller('store/payroll/employees')
export class EmployeesController {
  constructor(
    private readonly employees_service: EmployeesService,
    private readonly fiscal_profile_service: EmployeeFiscalProfileService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
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
  async getStats() {
    const result = await this.employees_service.getStats();
    return this.response_service.success(result);
  }

  @Get('available-users')
  async getAvailableUsers() {
    const result = await this.employees_service.getAvailableUsers();
    return this.response_service.success(result);
  }

  // --- Parameter Routes ---

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.employees_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateEmployeeDto) {
    const result = await this.employees_service.create(create_dto);
    return this.response_service.success(
      result,
      'Employee created successfully',
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() update_dto: UpdateEmployeeDto) {
    const result = await this.employees_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Employee updated successfully',
    );
  }

  @Patch(':id/terminate')
  async terminate(@Param('id') id: string) {
    const result = await this.employees_service.terminate(+id);
    return this.response_service.success(
      result,
      'Employee terminated successfully',
    );
  }

  // ── Fiscal profile (art. 387 ET — deducciones retefuente laboral) ──

  @Get(':id/fiscal-profile')
  async getFiscalProfile(@Param('id') id: string) {
    const result = await this.fiscal_profile_service.getOrCreate(+id);
    return this.response_service.success(result);
  }

  @Put(':id/fiscal-profile')
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
