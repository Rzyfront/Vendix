import { RequestContextService } from '../context/request-context.service';
import {
  describeJobSource,
  jobOrigin,
  readJobOrigin,
  withJobOrigin,
} from './job-origin';

const inRequest = <T>(userId: number | undefined, fn: () => T): T =>
  RequestContextService.runIsolated(
    { user_id: userId, is_super_admin: false, is_owner: false },
    fn,
  );

describe('job-origin (QUI-1031)', () => {
  it('dentro de una petición guarda el usuario y el origen junto al data original', () => {
    const data = inRequest(7, () =>
      withJobOrigin({ store_id: 105, entity_id: 3 }, 'http:compras/escanear-factura'),
    );
    expect(data).toEqual({
      store_id: 105,
      entity_id: 3,
      triggered_by_user_id: 7,
      source: 'http:compras/escanear-factura',
    });
  });

  it('fuera de una petición (cron, webhook) el usuario queda en null', () => {
    expect(jobOrigin('cron:embedding-sync')).toEqual({
      triggered_by_user_id: null,
      source: 'cron:embedding-sync',
    });
  });

  it('no adopta el último contexto estático de getContext(): solo el de la petición en curso', () => {
    RequestContextService.run(
      { user_id: 99, is_super_admin: false, is_owner: false },
      () => undefined,
    );
    expect(jobOrigin('event:product.updated').triggered_by_user_id).toBeNull();
  });

  it('un usuario explícito gana al de la petición, y null explícito lo borra', () => {
    inRequest(7, () => {
      expect(jobOrigin('http:suscripciones/reintentar-cobro', 12).triggered_by_user_id).toBe(12);
      expect(jobOrigin('job:billing-warning', null).triggered_by_user_id).toBeNull();
    });
  });

  it('lee el origen nuevo y cae a los campos de usuario que cada cola ya usaba', () => {
    expect(readJobOrigin({ triggered_by_user_id: 7, source: 'event:product.updated' })).toEqual({
      userId: 7,
      source: 'event:product.updated',
    });
    expect(readJobOrigin({ user_id: 8 }).userId).toBe(8);
    expect(readJobOrigin({ context: { user_id: 9 } }).userId).toBe(9);
    expect(readJobOrigin({ context: { actor_id: 10 } }).userId).toBe(10);
    expect(readJobOrigin({ user_id: 'abc', source: 'no es origen' })).toEqual({
      userId: null,
      source: null,
    });
    expect(readJobOrigin(null)).toEqual({ userId: null, source: null });
  });

  it('describe el origen en español', () => {
    expect(describeJobSource('event:product.updated')).toBe('Evento product.updated');
    expect(describeJobSource('cron:embedding-sync')).toBe('Tarea programada embedding-sync');
    expect(describeJobSource('http:productos/editar')).toBe('Pantalla o API productos/editar');
    expect(describeJobSource(null)).toBeNull();
  });
});
