import { Module } from '@nestjs/common';
import { StoreDomainsController } from './domains.controller';
import { StoreDomainsService } from './domains.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
    imports: [PrismaModule, ResponseModule],
    controllers: [StoreDomainsController],
    providers: [StoreDomainsService],
    exports: [StoreDomainsService],
})
export class StoreDomainsModule { }
