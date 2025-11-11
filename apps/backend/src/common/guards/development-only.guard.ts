import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DevelopmentOnlyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    if (!isDevelopment) {
      throw new ForbiddenException(
        'This endpoint is only available in development environment',
      );
    }

    return true;
  }
}
