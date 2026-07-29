import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { SuperadminRoleAssignmentService } from './superadmin-role-assignment.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [RolesController],
  providers: [RolesService, SuperadminRoleAssignmentService],
  // `SuperadminRoleAssignmentService` se exporta para que `superadmin/users`
  // use la MISMA instancia/lógica en la dirección usuario→rol. Es lo que evita
  // que las dos pantallas de la relación diverjan (QUI-72).
  exports: [RolesService, SuperadminRoleAssignmentService],
})
export class RolesModule {}
