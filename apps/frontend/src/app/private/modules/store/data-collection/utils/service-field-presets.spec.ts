import { SERVICE_FIELD_PRESETS, STATION_TEMPLATE_TYPES } from './service-field-presets';

describe('STATION_TEMPLATE_TYPES', () => {
  const byValue = (value: string) => STATION_TEMPLATE_TYPES.find((t) => t.value === value)!;

  it('offers a court type whose template does not ask about failures', () => {
    const cancha = byValue('cancha');
    expect(cancha).toBeTruthy();
    expect(cancha.keys).toEqual(['observaciones_atencion']);
    const labels = cancha.keys.map((k) => SERVICE_FIELD_PRESETS[k].label);
    expect(labels).toEqual(['Observaciones de la atención']);
    expect(labels.join(' ')).not.toContain('Falla');
  });

  it('keeps the workshop templates unchanged', () => {
    expect(byValue('carro').keys).toContain('motivo_ingreso');
    expect(byValue('general').keys).toEqual(['motivo_ingreso']);
    expect(SERVICE_FIELD_PRESETS['motivo_ingreso'].label).toBe('Falla o motivo del ingreso');
  });

  it('only references presets that exist', () => {
    for (const type of STATION_TEMPLATE_TYPES) {
      for (const key of type.keys) expect(SERVICE_FIELD_PRESETS[key]).toBeDefined();
    }
  });
});
