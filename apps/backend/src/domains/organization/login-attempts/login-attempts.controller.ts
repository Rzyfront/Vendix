import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LoginAttemptsService } from './login-attempts.service';
import { LoginAttemptsQueryDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Login Attempts')
@Controller('organization/login-attempts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoginAttemptsController {
  constructor(private readonly loginAttemptsService: LoginAttemptsService) {}

  @Get()
  @Permissions('login_attempts:read')
  @ApiOperation({ summary: 'Get all login attempts' })
  @ApiResponse({
    status: 200,
    description: 'Login attempts retrieved successfully',
  })
  async findAll(@Query() query: LoginAttemptsQueryDto) {
    return this.loginAttemptsService.findAll(query);
  }

  @Get('stats')
  @Permissions('login_attempts:read')
  @ApiOperation({ summary: 'Get login attempts statistics' })
  @ApiResponse({
    status: 200,
    description: 'Login attempts statistics retrieved successfully',
  })
  async getStats() {
    return this.loginAttemptsService.getStats();
  }
}
