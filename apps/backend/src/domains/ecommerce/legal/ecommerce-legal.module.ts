import { Module } from '@nestjs/common';
import { EcommerceLegalController } from './ecommerce-legal.controller';
import { EcommerceLegalService } from './ecommerce-legal.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';

@Module({
    imports: [PrismaModule, ResponseModule, S3Module],
    controllers: [EcommerceLegalController],
    providers: [EcommerceLegalService],
    exports: [EcommerceLegalService],
})
export class EcommerceLegalModule { }
