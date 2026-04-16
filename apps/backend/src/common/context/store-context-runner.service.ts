import { Injectable, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RequestContextService } from './request-context.service';

@Injectable()
export class StoreContextRunner {
  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  /**
   * Ejecuta un callback dentro del contexto multi-tenant de una tienda.
   * Util para cron jobs, webhooks, y cualquier operacion fuera de HTTP request.
   */
  async runInStoreContext<T>(
    storeId: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });

    if (!store) {
      throw new NotFoundException(`Store #${storeId} not found`);
    }

    return RequestContextService.run(
      {
        store_id: storeId,
        organization_id: store.organization_id,
        is_super_admin: false,
        is_owner: false,
      },
      callback,
    );
  }
}
