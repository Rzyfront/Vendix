import { Module } from '@nestjs/common';
import { MetadataFieldsController } from './metadata-fields.controller';
import { MetadataFieldsService } from './metadata-fields.service';
import { MetadataValuesController } from './metadata-values.controller';
import { MetadataValuesService } from './metadata-values.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [MetadataFieldsController, MetadataValuesController],
  providers: [MetadataFieldsService, MetadataValuesService],
  exports: [MetadataFieldsService, MetadataValuesService],
})
export class MetadataModule {}
