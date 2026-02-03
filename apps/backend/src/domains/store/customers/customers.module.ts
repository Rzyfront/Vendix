import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
    imports: [ResponseModule],
    controllers: [CustomersController],
    providers: [CustomersService, StorePrismaService],
    exports: [CustomersService],
})
export class CustomersModule { }
