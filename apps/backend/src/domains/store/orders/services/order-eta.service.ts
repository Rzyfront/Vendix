import { Injectable } from '@nestjs/common';
import { OperationsSettings } from '../../settings/interfaces/store-settings.interface';

export interface EtaResult {
  readyAt: Date;
  deliveredAt: Date;
  prepMinutes: number;
  transitMinutes: number;
}

@Injectable()
export class OrderEtaService {
  computeEta(
    items: { preparation_time_minutes: number | null }[],
    transitTimeMinutes: number,
    storeSettings: OperationsSettings | undefined,
    paidAt: Date,
  ): EtaResult {
    const defaultPrep =
      storeSettings?.default_preparation_time_minutes ?? 15;

    const prepMinutes = items.length
      ? Math.max(
          ...items.map(
            (item) => item.preparation_time_minutes ?? defaultPrep,
          ),
        )
      : defaultPrep;

    const readyAt = new Date(paidAt.getTime() + prepMinutes * 60_000);
    const deliveredAt = new Date(
      readyAt.getTime() + transitTimeMinutes * 60_000,
    );

    return {
      readyAt,
      deliveredAt,
      prepMinutes,
      transitMinutes: transitTimeMinutes,
    };
  }
}
