import { ManufacturingPlant } from '../../../interfaces';
import {
  createPlantPayload,
  managerName,
  plantFormError,
  plantFormValue,
  toId,
  updatePlantPayload,
} from './plant-form.util';

/** QUI-1013 — the "Nueva planta / Editar planta" form. */
describe('plant-form.util (QUI-1013)', () => {
  const saved: ManufacturingPlant = {
    id: 4,
    store_id: 1,
    name: 'Camisas',
    input_location_id: 11,
    output_location_id: 12,
    manager_user_id: 7,
    is_active: true,
  };

  it('starts empty for a new plant and with the saved values when editing', () => {
    expect(plantFormValue(null)).toEqual({
      name: '',
      input_location_id: null,
      output_location_id: null,
      manager_user_id: null,
    });
    expect(plantFormValue(saved)).toEqual({
      name: 'Camisas',
      input_location_id: 11,
      output_location_id: 12,
      manager_user_id: 7,
    });
  });

  it('asks for the name and both locations; the manager is optional', () => {
    const ok = { name: 'Pantalones', input_location_id: 11, output_location_id: '12', manager_user_id: '' };
    expect(plantFormError(ok)).toBeNull();
    expect(plantFormError({ ...ok, name: '   ' })).toBe('Escribe el nombre de la planta');
    expect(plantFormError({ ...ok, name: 'x'.repeat(101) })).toBe('El nombre admite hasta 100 caracteres');
    expect(plantFormError({ ...ok, input_location_id: null })).toBe('Elige la bodega de insumos');
    expect(plantFormError({ ...ok, output_location_id: '' })).toBe('Elige la bodega de producto terminado');
  });

  it('creates with numeric ids, a trimmed name and no manager when none is chosen', () => {
    expect(
      createPlantPayload({ name: ' Zapatos ', input_location_id: '11', output_location_id: 12, manager_user_id: '' }),
    ).toEqual({ name: 'Zapatos', input_location_id: 11, output_location_id: 12, manager_user_id: null });
  });

  it('an edit sends only what changed', () => {
    expect(updatePlantPayload(saved, plantFormValue(saved))).toEqual({});
    expect(
      updatePlantPayload(saved, { ...plantFormValue(saved), name: 'Camisas premium', output_location_id: '13' }),
    ).toEqual({ name: 'Camisas premium', output_location_id: 13 });
  });

  it('clearing the manager sends null; a new manager sends its id', () => {
    expect(updatePlantPayload(saved, { ...plantFormValue(saved), manager_user_id: '' })).toEqual({
      manager_user_id: null,
    });
    expect(updatePlantPayload(saved, { ...plantFormValue(saved), manager_user_id: '9' })).toEqual({
      manager_user_id: 9,
    });
  });

  it('reads ids from the selectors and rejects anything else', () => {
    expect(toId('5')).toBe(5);
    expect(toId(5)).toBe(5);
    expect(toId('')).toBeNull();
    expect(toId(null)).toBeNull();
    expect(toId('0')).toBeNull();
    expect(toId('1.5')).toBeNull();
  });

  it('shows the manager by name', () => {
    expect(managerName({ first_name: 'Ana', last_name: 'Ríos' })).toBe('Ana Ríos');
    expect(managerName({ first_name: 'Ana', last_name: null })).toBe('Ana');
    expect(managerName(null)).toBeNull();
    expect(managerName({ first_name: null, last_name: null })).toBeNull();
  });
});
