import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

/**
 * QUI-580 — personal reminders log (bitácora): CRUD API. The Prisma services
 * come from global modules.
 */
@Module({
  imports: [ResponseModule],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
