import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
} from '../../organization/users/dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ResponseService } from 'src/common/responses/response.service';

@ApiTags('Admin Users')
@Controller('superadmin/users')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async create(@Body() createUserDto: CreateUserDto) {
    const result = await this.usersService.create(createUserDto);
    return this.responseService.created(result, 'User created successfully');
  }

  @Get()
  @ApiOperation({ summary: 'Get all users with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async findAll(@Query() query: UserQueryDto) {
    const result = await this.usersService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Users retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for users' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    const stats = await this.usersService.getDashboardStats();
    return this.responseService.success(
      stats,
      'Dashboard statistics retrieved successfully',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findOne(+id);
    return this.responseService.success(user, 'User retrieved successfully');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    const user = await this.usersService.update(+id, updateUserDto);
    return this.responseService.updated(user, 'User updated successfully');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 403,
    description: 'Cannot delete super admin users',
  })
  async remove(@Param('id') id: string) {
    await this.usersService.remove(+id);
    return this.responseService.deleted('User deleted successfully');
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a user' })
  @ApiResponse({ status: 200, description: 'User activated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async activate(@Param('id') id: string) {
    const result = await this.usersService.activateUser(+id);
    return this.responseService.success(result, 'User activated successfully');
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a user' })
  @ApiResponse({ status: 200, description: 'User deactivated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivate(@Param('id') id: string) {
    const result = await this.usersService.deactivateUser(+id);
    return this.responseService.success(
      result,
      'User deactivated successfully',
    );
  }

  @Post(':userId/roles/:roleId')
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiResponse({ status: 200, description: 'Role assigned successfully' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  @ApiResponse({ status: 409, description: 'Role already assigned to user' })
  async assignRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ) {
    const result = await this.usersService.assignRole(+userId, +roleId);
    return this.responseService.success(result, 'Role assigned successfully');
  }

  @Delete(':userId/roles/:roleId')
  @ApiOperation({ summary: 'Remove a role from a user' })
  @ApiResponse({ status: 200, description: 'Role removed successfully' })
  @ApiResponse({
    status: 404,
    description: 'User, role, or assignment not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot remove super admin role',
  })
  async removeRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ) {
    const result = await this.usersService.removeRole(+userId, +roleId);
    return this.responseService.success(result, 'Role removed successfully');
  }

  @Post(':id/verify-email')
  @ApiOperation({ summary: 'Verify user email' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async verifyEmail(@Param('id') id: string) {
    const result = await this.usersService.verifyEmail(+id);
    return this.responseService.success(result, 'Email verified successfully');
  }

  @Patch(':id/2fa')
  @ApiOperation({ summary: 'Toggle 2FA for a user' })
  @ApiResponse({ status: 200, description: '2FA toggled successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async toggle2FA(@Param('id') id: string, @Body('enabled') enabled: boolean) {
    const result = await this.usersService.toggle2FA(+id, enabled);
    return this.responseService.success(result, '2FA toggled successfully');
  }

  @Post(':id/unlock')
  @ApiOperation({ summary: 'Unlock a user' })
  @ApiResponse({ status: 200, description: 'User unlocked successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async unlock(@Param('id') id: string) {
    const result = await this.usersService.unlock(+id);
    return this.responseService.success(result, 'User unlocked successfully');
  }
}
