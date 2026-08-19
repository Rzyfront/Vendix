import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true; // Si no hay roles requeridos, permitir acceso
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    if (!user.roles || user.roles.length === 0) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));

    if (!hasRole) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    return true;
  }
}
