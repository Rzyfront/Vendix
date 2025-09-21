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
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('users:create')
  async create(@Body() createUserDto: CreateUserDto, @Req() request: Request) {
    const user = await this.usersService.create(createUserDto);
    return this.responseService.created(
      user,
      'User created successfully',
      request.url,
    );
  }

  @Get()
  @Permissions('users:read')
  async findAll(@Query() query: UserQueryDto, @Req() request: Request) {
    const result = await this.usersService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta,
      'Users retrieved successfully',
      request.url,
    );
  }

  @Get(':id')
  @Permissions('users:read')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() request: Request) {
    const user = await this.usersService.findOne(id);
    return this.responseService.success(
      user,
      'User retrieved successfully',
      request.url,
    );
  }

  @Patch(':id')
  @Permissions('users:update')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Permissions('users:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }

  @Post(':id/archive')
  @Permissions('users:delete')
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.archive(id);
  }

  @Post(':id/reactivate')
  @Permissions('users:update')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.reactivate(id);
  }
}