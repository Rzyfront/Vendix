import { Module } from '@nestjs/common';
import { PaymentMethodsController } from './controllers/payment-methods.controller';
import { PaymentMethodsService } from './services/payment-methods.service';
import { S3Service } from '@common/services/s3.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [PaymentMethodsController],
    providers: [PaymentMethodsService, S3Service],
    exports: [PaymentMethodsService],
})
export class PaymentMethodsModule { }