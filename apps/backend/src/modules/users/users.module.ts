import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ResponseModule } from '../../common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
