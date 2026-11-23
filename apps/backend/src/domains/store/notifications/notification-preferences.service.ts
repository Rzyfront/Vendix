import { Injectable } from '@nestjs/common';
import { notification_type_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_GROUPS,
  NotificationChannelFlags,
  NotificationGroupKey,
  StoredSubscription,
  resolveEffectiveChannels,
} from './notification-catalog';

export interface NotificationPreferenceItem {
  type: notification_type_enum;
  label: string;
  description: string;
  /** Canales que la persona puede controlar para este tipo. */
  channels: NotificationChannelFlags;
  defaults: NotificationChannelFlags;
  /** Valor que se aplica hoy: su fila guardada o el default del tipo. */
  effective: NotificationChannelFlags;
  /** True cuando la persona ya guardó una preferencia para el tipo. */
  customized: boolean;
}

export interface NotificationPreferenceGroup {
  key: NotificationGroupKey;
  label: string;
  types: NotificationPreferenceItem[];
}

/**
 * Preferencias por tipo × canal × usuario × tienda (plan §3.2). Lee
 * `notification_subscriptions` con la tienda SIEMPRE explícita: se usa desde
 * crons sin contexto y desde el request (con la tienda del contexto). Sin fila
 * manda el default del catálogo; nunca crea filas.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly global_prisma: GlobalPrismaService) {}

  /** Valor efectivo de un tipo para varios usuarios de UNA tienda. */
  async resolveForUsers(
    store_id: number,
    user_ids: number[],
    type: string,
  ): Promise<Map<number, NotificationChannelFlags>> {
    const result = new Map<number, NotificationChannelFlags>();
    if (user_ids.length === 0) return result;

    const rows = await this.global_prisma.notification_subscriptions.findMany({
      where: {
        store_id,
        user_id: { in: user_ids },
        type: type as notification_type_enum,
      },
      select: { user_id: true, in_app: true, email: true },
    });
    const byUser = new Map<number, StoredSubscription>(
      rows.map((row) => [row.user_id, row]),
    );
    for (const user_id of user_ids) {
      result.set(user_id, resolveEffectiveChannels(type, byUser.get(user_id)));
    }
    return result;
  }

  /**
   * Catálogo agrupado por módulo con el valor efectivo por canal de la persona
   * en la tienda. Es la lectura de la pantalla de preferencias.
   */
  async getGroupedForUser(
    store_id: number,
    user_id: number,
  ): Promise<NotificationPreferenceGroup[]> {
    const rows = await this.global_prisma.notification_subscriptions.findMany({
      where: { store_id, user_id },
      select: { type: true, in_app: true, email: true },
    });
    const byType = new Map<string, StoredSubscription>(
      rows.map((row) => [row.type, row]),
    );

    return NOTIFICATION_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      types: NOTIFICATION_CATALOG.filter(
        (entry) => entry.user_configurable && entry.group === group.key,
      ).map((entry) => ({
        type: entry.type,
        label: entry.label,
        description: entry.description,
        channels: { ...entry.channels },
        defaults: { ...entry.defaults },
        effective: resolveEffectiveChannels(entry.type, byType.get(entry.type)),
        customized: byType.has(entry.type),
      })),
    })).filter((group) => group.types.length > 0);
  }
}
