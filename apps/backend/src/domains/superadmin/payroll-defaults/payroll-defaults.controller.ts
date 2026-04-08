import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PayrollDefaultsService } from './payroll-defaults.service';
import { CreatePayrollDefaultsDto, UpdatePayrollDefaultsDto } from './dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';

@Controller('superadmin/payroll-defaults')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PayrollDefaultsController {
  constructor(
    private readonly payrollDefaultsService: PayrollDefaultsService,
  ) {}

  @Post()
  create(@Body() dto: CreatePayrollDefaultsDto) {
    return this.payrollDefaultsService.create(dto);
  }

  @Get()
  findAll() {
    return this.payrollDefaultsService.findAll();
  }

  @Get(':year')
  findOne(@Param('year', ParseIntPipe) year: number) {
    return this.payrollDefaultsService.findOne(year);
  }

  @Patch(':year')
  update(
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: UpdatePayrollDefaultsDto,
  ) {
    return this.payrollDefaultsService.update(year, dto);
  }

  @Post(':year/publish')
  publish(@Param('year', ParseIntPipe) year: number, @Req() req: any) {
    const user_id: number = req.user?.id ?? req.user?.user_id ?? 0;
    return this.payrollDefaultsService.publish(year, user_id);
  }

  @Post(':year/unpublish')
  unpublish(@Param('year', ParseIntPipe) year: number) {
    return this.payrollDefaultsService.unpublish(year);
  }
}
