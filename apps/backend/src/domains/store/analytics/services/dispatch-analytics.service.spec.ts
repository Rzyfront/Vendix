import {
  pickActiveStop,
  resolveCarrier,
} from './dispatch-analytics.service';

/**
 * CP-despachos-reportes B.1: helpers puros compartidos por pantalla y export
 * (ADR-01 cascada del portador, ADR-02 grano una-línea-por-orden). Sin DB.
 */

describe('pickActiveStop (ADR-02)', () => {
  it('sin paradas → null y no reasignada', () => {
    expect(pickActiveStop([])).toEqual({ stop: null, reasignada: false });
  });

  it('una parada → esa, no reasignada', () => {
    const s = { id: 1, status: 'pending', settled_at: null };
    expect(pickActiveStop([s])).toEqual({ stop: s, reasignada: false });
  });

  it('terminal gana a pendiente aunque sea más vieja', () => {
    const pending = { id: 2, status: 'pending', settled_at: null };
    const delivered = {
      id: 1,
      status: 'delivered',
      settled_at: new Date('2026-06-19T06:00:00Z'),
    };
    expect(pickActiveStop([pending, delivered]).stop).toBe(delivered);
  });

  it('released solo cuando no hay otra + marca reasignada', () => {
    const released = { id: 5, status: 'released', settled_at: null };
    const r = pickActiveStop([released, { ...released, id: 6 }]);
    expect(r.stop?.id).toBe(6);
    expect(r.reasignada).toBe(true);
  });
});

describe('resolveCarrier (ADR-01)', () => {
  const note = { courier_name: null, delivered_by_name: null, settled_by_name: null };

  it('conductor externo primario', () => {
    expect(
      resolveCarrier(
        {
          is_primary_driver_external: true,
          external_driver_name: 'Carlos Conductor',
          driver_name: null,
          assistant_names: [],
        },
        note,
      ),
    ).toEqual({ nombre: 'Carlos Conductor', tipo: 'conductor_externo' });
  });

  it('conductor interno', () => {
    expect(
      resolveCarrier(
        {
          is_primary_driver_external: false,
          external_driver_name: null,
          driver_name: 'Ana Interna',
          assistant_names: [],
        },
        note,
      ),
    ).toEqual({ nombre: 'Ana Interna', tipo: 'conductor_interno' });
  });

  it('auxiliar cuando la ruta no tiene conductor', () => {
    expect(
      resolveCarrier(
        {
          is_primary_driver_external: false,
          external_driver_name: null,
          driver_name: null,
          assistant_names: [null, 'Pedro Aux'],
        },
        note,
      ),
    ).toEqual({ nombre: 'Pedro Aux', tipo: 'auxiliar' });
  });

  it('domiciliario sin ruta', () => {
    expect(
      resolveCarrier(null, { ...note, courier_name: 'Domi Rápido' }),
    ).toEqual({ nombre: 'Domi Rápido', tipo: 'domiciliario' });
  });

  it('fallbacks registrado_por y null total', () => {
    expect(
      resolveCarrier(null, { ...note, delivered_by_name: 'Carlos Rodríguez' }),
    ).toEqual({ nombre: 'Carlos Rodríguez', tipo: 'registrado_por' });
    expect(resolveCarrier(null, note)).toEqual({ nombre: null, tipo: null });
  });
});
