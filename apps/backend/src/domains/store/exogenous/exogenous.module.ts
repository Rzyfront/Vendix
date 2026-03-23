import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { ExogenousController } from './exogenous.controller';
import { ExogenousService } from './exogenous.service';
import { ExogenousGeneratorService } from './exogenous-generator.service';
import { ExogenousValidatorService } from './exogenous-validator.service';
import { ExogenousFileBuilderService } from './exogenous-file-builder.service';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module],
  controllers: [ExogenousController],
  providers: [ExogenousService, ExogenousGeneratorService, ExogenousValidatorService, ExogenousFileBuilderService],
  exports: [ExogenousService],
})
export class ExogenousModule {}
