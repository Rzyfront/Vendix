import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../../prisma/prisma.module'; // ✅ Importar PrismaModule

@Module({
  imports: [PrismaModule], // ✅ Agregar PrismaModule a las importaciones
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
