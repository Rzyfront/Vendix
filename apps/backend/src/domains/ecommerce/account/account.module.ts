import { Module } from '@nestjs/common';
import { S3Module } from '@common/services/s3.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
    imports: [PrismaModule, S3Module],
    controllers: [AccountController],
    providers: [AccountService],
    exports: [AccountService],
})
export class AccountModule { }
