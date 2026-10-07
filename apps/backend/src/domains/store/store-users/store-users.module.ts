import { Module, OnModuleInit } from '@nestjs/common';
import { StoreUsersService } from './store-users.service';
import { StoreUserManagementService } from './store-user-management.service';
import { StoreUsersController } from './store-users.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createStoreUserTools } from '../../../ai-engine/tools/domains/store-users.tools';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [StoreUsersController],
  providers: [StoreUsersService, StoreUserManagementService],
  exports: [StoreUsersService, StoreUserManagementService],
})
export class StoreUsersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly management: StoreUserManagementService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createStoreUserTools({ storeUserManagementService: this.management }),
    );
  }
}
