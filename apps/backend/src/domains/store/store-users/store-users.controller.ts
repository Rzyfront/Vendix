import { Controller } from '@nestjs/common';
import { StoreUsersService } from './store-users.service';

@Controller('store/store-users')
export class StoreUsersController {
  constructor(private readonly storeUsersService: StoreUsersService) {}

  // TODO: Implement store users endpoints
}
