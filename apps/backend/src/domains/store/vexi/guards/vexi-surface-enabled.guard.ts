import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { VexiEnabledGuard } from './vexi-enabled.guard';
import { voiceConfirmationEnabled } from '../vexi-voice-consent.service';

/** Only G's dedicated endpoints defer the toggle to their bound conversation. */
@Injectable()
export class VexiSurfaceEnabledGuard implements CanActivate {
  constructor(private readonly legacy: VexiEnabledGuard) {}
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ path?: string }>();
    if (
      voiceConfirmationEnabled() &&
      /^\/api\/store\/vexi\/voice\/confirmations(?:\/|$)/.test(
        request.path ?? '',
      )
    )
      return true;
    return this.legacy.canActivate(context);
  }
}
