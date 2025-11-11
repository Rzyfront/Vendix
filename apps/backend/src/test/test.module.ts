import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResponseModule } from '../common/responses/response.module';

@Module({
  imports: [EmailModule, PrismaModule, ResponseModule],
  controllers: [TestController],
})
export class TestModule {}
