import { Module, Global } from '@nestjs/common';
import { StaffProvisioningService } from './staff-provisioning.service';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * StaffProvisioningModule
 *
 * Módulo global que expone `StaffProvisioningService` a los tres dominios que
 * crean o resuelven cuentas staff/owner (auth, organization, store) sin
 * necesidad de importarlo explícitamente ni arriesgar dependencias circulares.
 *
 * Sigue el mismo patrón que `DefaultPanelUIModule`.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [StaffProvisioningService],
  exports: [StaffProvisioningService],
})
export class StaffProvisioningModule {}
