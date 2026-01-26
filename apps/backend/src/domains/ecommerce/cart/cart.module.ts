import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { StorageModule } from '../../../storage.module';

@Module({
    imports: [PrismaModule, StorageModule],
    controllers: [CartController],
    providers: [CartService],
    exports: [CartService],
})
export class CartModule { }
