import { Controller } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('store/settings')
export class SettingsController {
  constructor(private readonly storeSettingsService: SettingsService) {}

  // TODO: Implement store settings endpoints
}
