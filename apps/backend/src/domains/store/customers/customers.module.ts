import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

@Module({
    controllers: [CustomersController],
    providers: [CustomersService, StorePrismaService],
    exports: [CustomersService],
})
export class CustomersModule { }
