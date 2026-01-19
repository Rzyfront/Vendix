import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from 'src/common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
