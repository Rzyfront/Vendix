import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  // RolesModule aporta `SuperadminRoleAssignmentService`: la dirección
  // usuario→rol de este módulo y la dirección rol→usuario de superadmin/roles
  // DEBEN pasar por el mismo servicio (QUI-72). No hay ciclo: RolesModule no
  // depende de UsersModule.
  imports: [PrismaModule, ResponseModule, RolesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
