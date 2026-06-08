import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { CreateNotificationSoundDto } from './dto/create-notification-sound.dto';
import { UpdateNotificationSoundDto } from './dto/update-notification-sound.dto';
import { NotificationSoundsService } from './notification-sounds.service';

// FileInterceptor limit (defense-in-depth; final validation is in the service)
const MAX_UPLOAD_BYTES = 300 * 1024; // 307200 bytes

@Controller('superadmin/notification-sounds')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(UserRole.SUPER_ADMIN)
export class NotificationSoundsController {
  constructor(
    private readonly notificationSoundsService: NotificationSoundsService,
  ) {}

  @Post()
  @Permissions('superadmin:notification_sounds:create')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateNotificationSoundDto,
  ) {
    return this.notificationSoundsService.create(file, dto);
  }

  @Get()
  @Permissions('superadmin:notification_sounds:read')
  findAll(
    @Query('is_active', new ParseBoolPipe({ optional: true }))
    isActive?: boolean,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.notificationSoundsService.findAll({
      isActive,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
    });
  }

  @Get(':id')
  @Permissions('superadmin:notification_sounds:read')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.notificationSoundsService.findOne(id);
  }

  @Patch(':id')
  @Permissions('superadmin:notification_sounds:update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateNotificationSoundDto,
  ) {
    return this.notificationSoundsService.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @Permissions('superadmin:notification_sounds:update')
  toggleActive(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.notificationSoundsService.toggleActive(id);
  }

  @Delete(':id')
  @Permissions('superadmin:notification_sounds:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.notificationSoundsService.remove(id);
  }
}
