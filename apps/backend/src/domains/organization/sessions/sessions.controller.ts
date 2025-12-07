import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { UserSessionsQueryDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('User Sessions')
@Controller('organization/sessions')
@UseGuards(PermissionsGuard)
export class SessionsController {
  constructor(private readonly userSessionsService: SessionsService) { }

  @Get()
  @Permissions('organization:user_sessions:read')
  @ApiOperation({ summary: 'Get all user sessions' })
  @ApiResponse({
    status: 200,
    description: 'User sessions retrieved successfully',
  })
  async findAll(@Query() query: UserSessionsQueryDto) {
    return this.userSessionsService.findAll(query);
  }

  @Get(':id')
  @Permissions('organization:user_sessions:read')
  @ApiOperation({ summary: 'Get user session by ID' })
  @ApiResponse({
    status: 200,
    description: 'User session retrieved successfully',
  })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userSessionsService.findOne(id);
  }

  @Delete(':id')
  @Permissions('organization:user_sessions:delete')
  @ApiOperation({ summary: 'Terminate user session' })
  @ApiResponse({
    status: 200,
    description: 'User session terminated successfully',
  })
  async terminateSession(@Param('id', ParseIntPipe) id: number) {
    return this.userSessionsService.terminateSession(id);
  }

  @Delete('user/:userId')
  @Permissions('organization:user_sessions:delete')
  @ApiOperation({ summary: 'Terminate all sessions for a user' })
  @ApiResponse({
    status: 200,
    description: 'User sessions terminated successfully',
  })
  async terminateUserSessions(@Param('userId', ParseIntPipe) userId: number) {
    return this.userSessionsService.terminateUserSessions(userId);
  }
}
