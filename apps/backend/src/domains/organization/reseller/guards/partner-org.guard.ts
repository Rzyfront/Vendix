import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class PartnerOrgGuard implements CanActivate {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    const org = await this.prisma.organizations.findUnique({
      where: { id: ctx.organization_id },
      select: { is_partner: true },
    });
    if (!org?.is_partner) {
      throw new VendixHttpException(ErrorCodes.PARTNER_001);
    }
    return true;
  }
}
