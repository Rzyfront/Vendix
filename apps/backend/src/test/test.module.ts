import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [EmailModule, PrismaModule],
  controllers: [TestController],
})
export class TestModule {}
