import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Global() // ✅ Hacemos el módulo global para no tener que importarlo en todos lados
@Module({
    imports: [ResponseModule, PrismaModule],
    providers: [AuditService, AuditInterceptor],
    exports: [AuditService, AuditInterceptor],
})
export class AuditModule { }
