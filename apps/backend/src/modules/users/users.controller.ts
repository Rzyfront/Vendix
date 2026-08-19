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
  ParseIntPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('users.create')
  async create(@Body() createUserDto: CreateUserDto, @CurrentUser() user: any) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @RequirePermissions('users.read')
  async findAll(@Query() query: UserQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.usersService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Get('email/:email')
  @RequirePermissions('users.read')
  async findByEmail(
    @Param('email') email: string,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.usersService.findByEmail(email, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Get('username/:username')
  @RequirePermissions('users.read')
  async findByUsername(
    @Param('username') username: string,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.usersService.findByUsername(username, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.update(id, updateUserDto);
  }

  @Patch(':id/activate')
  @RequirePermissions('users.update')
  async activate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.usersService.activate(id);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('users.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.usersService.deactivate(id);
  }

  @Patch(':id/verify-email')
  @RequirePermissions('users.update')
  async verifyEmail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.usersService.verifyEmail(id);
  }

  @Patch(':id/lock')
  @RequirePermissions('users.lock')
  async lockUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lockUntil: string },
    @CurrentUser() user: any,
  ) {
    const lockUntil = new Date(body.lockUntil);
    return this.usersService.lockUser(id, lockUntil);
  }

  @Patch(':id/unlock')
  @RequirePermissions('users.lock')
  async unlockUser(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.usersService.unlockUser(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.usersService.remove(id);
  }
}
