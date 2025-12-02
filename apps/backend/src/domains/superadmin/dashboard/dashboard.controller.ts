import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { DashboardService } from './dashboard.service';

@ApiTags('Admin Dashboard')
@Controller('superadmin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DashboardController {
  constructor(private readonly adminDashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get super admin dashboard stats' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard stats retrieved successfully',
  })
  async getDashboardStats() {
    return this.adminDashboardService.getDashboardStats();
  }
}
