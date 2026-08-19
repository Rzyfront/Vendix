import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationQueryDto,
  AddUserToOrganizationDto,
} from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../auth/guards';
import { Roles, RequirePermissions, CurrentUser } from '../auth/decorators';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.create')
  create(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @CurrentUser() user: any,
  ) {
    return this.organizationsService.create(createOrganizationDto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.read')
  findAll(@Query() query: OrganizationQueryDto) {
    return this.organizationsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.organizationsService.findOne(id);
  }

  @Get('slug/:slug')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.read')
  findBySlug(@Param('slug') slug: string) {
    return this.organizationsService.findBySlug(slug);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(id, updateOrganizationDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'owner')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.organizationsService.remove(id);
  }

  // Endpoints para gestión de usuarios en organizaciones
  @Post(':id/users')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.manage_users')
  addUser(
    @Param('id', ParseIntPipe) organizationId: number,
    @Body() addUserDto: AddUserToOrganizationDto,
  ) {
    return this.organizationsService.addUserToOrganization(
      organizationId,
      addUserDto.user_id,
      addUserDto.role_id,
      addUserDto.permissions,
    );
  }

  @Delete(':organizationId/users/:userId/roles/:roleId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.manage_users')
  removeUser(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('roleId', ParseIntPipe) roleId: number,
  ) {
    return this.organizationsService.removeUserFromOrganization(
      organizationId,
      userId,
      roleId,
    );
  }

  @Get(':id/users')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('organizations.read')
  getUsers(@Param('id', ParseIntPipe) organizationId: number) {
    return this.organizationsService.getOrganizationUsers(organizationId);
  }
}
