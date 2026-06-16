import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { UomController } from './uom.controller';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [UomController],
})
export class UomModule {}
