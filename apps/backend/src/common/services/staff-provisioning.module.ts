import { Module, Global } from '@nestjs/common';
import { StaffProvisioningService } from './staff-provisioning.service';
import { UsernameService } from './username.service';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * StaffProvisioningModule
 *
 * Módulo global que expone `StaffProvisioningService` a los tres dominios que
 * crean o resuelven cuentas staff/owner (auth, organization, store) sin
 * necesidad de importarlo explícitamente ni arriesgar dependencias circulares.
 *
 * Sigue el mismo patrón que `DefaultPanelUIModule`.
 *
 * También expone `UsernameService`: unicidad global de `users.username` para
 * los mismos paneles que crean/editan cuentas (store, organization, superadmin).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [StaffProvisioningService, UsernameService],
  exports: [StaffProvisioningService, UsernameService],
})
export class StaffProvisioningModule {}
