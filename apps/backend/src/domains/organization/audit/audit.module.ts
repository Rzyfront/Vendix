import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { ResponseModule } from '@common/responses/response.module';

@Module({
    imports: [ResponseModule],
    controllers: [AuditController],
    providers: [AuditService, OrganizationPrismaService],
    exports: [AuditService],
})
export class AuditModule { }
