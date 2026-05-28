import { Controller, Get } from '@nestjs/common';
import { NotificationSoundsCatalogService } from './notification-sounds-catalog.service';

@Controller('notification-sounds')
export class NotificationSoundsCatalogController {
  constructor(
    private readonly catalogService: NotificationSoundsCatalogService,
  ) {}

  @Get()
  list() {
    return this.catalogService.listActive();
  }
}
