import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationsSettingsDto } from './settings-schemas.dto';
import { getDefaultStoreSettings } from '../defaults/default-store-settings';

const invalid = async (payload: Record<string, unknown>) =>
  (await validate(plainToInstance(NotificationsSettingsDto, payload))).map((e) => e.property);

describe('NotificationsSettingsDto · recordatorios de tareas (F1)', () => {
  it('acepta los extremos de los rangos', async () => {
    expect(await invalid({ task_due_soon_minutes: 5, daily_digest_hour: 0 })).toEqual([]);
    expect(await invalid({ task_due_soon_minutes: 1440, daily_digest_hour: 23 })).toEqual([]);
  });

  it('rechaza minutos fuera de 5-1440 o con decimales', async () => {
    expect(await invalid({ task_due_soon_minutes: 4 })).toEqual(['task_due_soon_minutes']);
    expect(await invalid({ task_due_soon_minutes: 1441 })).toEqual(['task_due_soon_minutes']);
    expect(await invalid({ task_due_soon_minutes: 30.5 })).toEqual(['task_due_soon_minutes']);
  });

  it('rechaza una hora fuera de 0-23', async () => {
    expect(await invalid({ daily_digest_hour: -1 })).toEqual(['daily_digest_hour']);
    expect(await invalid({ daily_digest_hour: 24 })).toEqual(['daily_digest_hour']);
  });

  it('una tienda nueva arranca con 60 minutos y resumen a las 7', () => {
    expect(getDefaultStoreSettings().notifications).toMatchObject({
      task_due_soon_minutes: 60,
      daily_digest_hour: 7,
    });
  });
});
