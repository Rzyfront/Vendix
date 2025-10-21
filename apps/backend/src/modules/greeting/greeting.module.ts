// apps/backend/src/modules/greeting/greeting.module.ts
import { Module } from '@nestjs/common';
import { GreetingController } from './greeting.controller';
import { GreetingService } from './greeting.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';

@Module({
    imports: [PrismaModule, ResponseModule],
    controllers: [GreetingController],
    providers: [GreetingService],
    exports: [GreetingService],
})
export class GreetingModule { }
