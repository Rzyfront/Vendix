import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../errors';

/**
 * DomainRegistrationGuard
 *
 * Anti-abuso para el flujo de provisioning de custom domains.
 * Limita cuántos dominios "no-terminales" puede tener una organización
 * en simultáneo. Default: 5. Configurable vía
 * `DOMAIN_PROVISIONING_MAX_PENDING_PER_ORG`.
 *
 * Estados terminales (no cuentan): active, disabled, failed_*.
 * Estados pending (sí cuentan): pending_ownership, verifying_ownership,
 * pending_certificate, issuing_certificate, pending_alias, propagating.
 */
@Injectable()
export class DomainRegistrationGuard implements CanActivate {
  private readonly maxPending: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: GlobalPrismaService,
  ) {
    this.maxPending =
      this.configService.get<number>(
        'DOMAIN_PROVISIONING_MAX_PENDING_PER_ORG',
      ) ?? 5;
  }

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const ctx = RequestContextService.getContext();
    const orgId = ctx?.organization_id;

    if (!orgId) {
      // Si no hay org context, no aplica este guard (otra capa rechazará).
      return true;
    }

    const pendingCount = await this.prisma.domain_settings.count({
      where: {
        organization_id: orgId,
        status: {
          in: [
            'pending_ownership',
            'verifying_ownership',
            'pending_certificate',
            'issuing_certificate',
            'pending_alias',
            'propagating',
          ],
        },
      },
    });

    if (pendingCount >= this.maxPending) {
      throw new VendixHttpException(
        ErrorCodes.ORG_DOMAIN_004,
        `Maximum ${this.maxPending} domains pending verification at the same time. Complete or remove pending domains before adding more.`,
        { pending: pendingCount, limit: this.maxPending },
      );
    }

    return true;
  }
}
