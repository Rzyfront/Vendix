import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  ManufacturingCostMethod,
  UpdateManufacturingSettingsDto,
} from '../dto';

export interface ManufacturingSettingsView {
  default_input_location_id: number | null;
  default_output_location_id: number | null;
  cost_method: ManufacturingCostMethod;
  lot_required: boolean;
  wip_account_id: number | null;
}

export const DEFAULT_MANUFACTURING_SETTINGS: ManufacturingSettingsView = {
  default_input_location_id: null,
  default_output_location_id: null,
  cost_method: 'fifo',
  lot_required: false,
  wip_account_id: null,
};

/**
 * Configuración de planta (una fila por tienda). Sin fila devuelve los
 * valores por defecto; el primer PATCH crea la fila.
 */
@Injectable()
export class ManufacturingSettingsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  async get(): Promise<ManufacturingSettingsView> {
    this.requireStoreId();
    const row = await this.prisma.manufacturing_settings.findFirst();
    if (!row) return { ...DEFAULT_MANUFACTURING_SETTINGS };
    return {
      default_input_location_id: row.default_input_location_id,
      default_output_location_id: row.default_output_location_id,
      cost_method: (row.cost_method === 'cpp' ? 'cpp' : 'fifo'),
      lot_required: row.lot_required,
      wip_account_id: row.wip_account_id,
    };
  }

  async update(
    dto: UpdateManufacturingSettingsDto,
  ): Promise<ManufacturingSettingsView> {
    const store_id = this.requireStoreId();

    for (const location_id of [
      dto.default_input_location_id,
      dto.default_output_location_id,
    ]) {
      if (location_id != null) {
        const location = await this.prisma.inventory_locations.findFirst({
          where: { id: location_id },
          select: { id: true },
        });
        if (!location) {
          throw new VendixHttpException(ErrorCodes.MFG_INVALID_LOCATION);
        }
      }
    }

    const data = {
      ...(dto.default_input_location_id !== undefined && {
        default_input_location_id: dto.default_input_location_id,
      }),
      ...(dto.default_output_location_id !== undefined && {
        default_output_location_id: dto.default_output_location_id,
      }),
      ...(dto.cost_method !== undefined && { cost_method: dto.cost_method }),
      ...(dto.lot_required !== undefined && { lot_required: dto.lot_required }),
      ...(dto.wip_account_id !== undefined && {
        wip_account_id: dto.wip_account_id,
      }),
      updated_at: new Date(),
    };

    const existing = await this.prisma.manufacturing_settings.findFirst({
      select: { id: true },
    });
    if (existing) {
      await this.prisma.manufacturing_settings.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.manufacturing_settings.create({
        data: { store_id, ...data },
      });
    }
    return this.get();
  }
}
