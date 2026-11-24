import { ProductsService } from './products.service';

/**
 * QUI-1060 modo Plan: coherencia de la ficha del plan al crear/editar el servicio.
 * Se prueba la regla sobre el valor efectivo (lo enviado o, al editar, lo guardado).
 */
describe('ProductsService.assertPlanFields (QUI-1060)', () => {
  const service = Object.create(ProductsService.prototype) as any;
  const check = (dto: Record<string, unknown>, existing?: Record<string, unknown>) => () =>
    service.assertPlanFields(dto, existing);

  it('acepta un plan coherente y un servicio sin datos de plan', () => {
    expect(check({ plan_duration_days: 3, plan_duration_nights: 2, plan_min_pax: 2, plan_max_pax: 8 })).not.toThrow();
    expect(check({})).not.toThrow();
  });

  it('rechaza más noches que días', () => {
    expect(check({ plan_duration_days: 2, plan_duration_nights: 3 })).toThrow(
      expect.objectContaining({ errorCode: 'SERVICE_PLAN_017' }),
    );
  });

  it('rechaza mínimo de personas mayor que el máximo', () => {
    expect(check({ plan_min_pax: 9, plan_max_pax: 4 })).toThrow(expect.objectContaining({ errorCode: 'SERVICE_PLAN_003' }));
  });

  it('al editar combina lo enviado con lo guardado', () => {
    expect(check({ plan_min_pax: 6 }, { plan_min_pax: 1, plan_max_pax: 4 })).toThrow(
      expect.objectContaining({ errorCode: 'SERVICE_PLAN_003' }),
    );
    expect(check({ plan_max_pax: null }, { plan_min_pax: 6, plan_max_pax: 4 })).not.toThrow();
  });
});

/** QUI-1060 F2: acortar el plan no deja actividades del itinerario fuera de rango. */
describe('ProductsService.assertPlanDurationChange (QUI-1060 F2)', () => {
  const build = (outside: number) => {
    const service = Object.create(ProductsService.prototype) as any;
    const count = jest.fn(async () => outside);
    service.prisma = { service_plan_activities: { count } };
    return { service, count };
  };

  it('rechaza bajar la duración con actividades en días que desaparecen', async () => {
    const { service, count } = build(2);
    await expect(service.assertPlanDurationChange(10, { plan_duration_days: 2 }, { plan_duration_days: 4 })).rejects.toMatchObject({
      errorCode: 'SERVICE_PLAN_023',
    });
    expect(count).toHaveBeenCalledWith({ where: { product_id: 10, day_number: { gt: 2 } } });
  });

  it('permite bajarla si no quedan actividades fuera', async () => {
    const { service } = build(0);
    await expect(service.assertPlanDurationChange(10, { plan_duration_days: 2 }, { plan_duration_days: 4 })).resolves.toBeUndefined();
  });

  it('no consulta si la duración no baja o no se envía (servicios por horas intactos)', async () => {
    const { service, count } = build(5);
    await service.assertPlanDurationChange(10, { plan_duration_days: 5 }, { plan_duration_days: 4 });
    await service.assertPlanDurationChange(10, { name: 'Corte' }, { plan_duration_days: null });
    await service.assertPlanDurationChange(10, { plan_duration_days: null }, { plan_duration_days: 4 });
    expect(count).not.toHaveBeenCalled();
  });
});
