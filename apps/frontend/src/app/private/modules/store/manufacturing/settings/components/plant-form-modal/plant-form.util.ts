import {
  CreateManufacturingPlantDto,
  ManufacturingPlant,
  UpdateManufacturingPlantDto,
} from '../../../interfaces';

/** Raw values of the plant form (selectors may hand back strings or ''). */
export interface PlantFormValue {
  name: string;
  input_location_id: number | string | null;
  output_location_id: number | string | null;
  manager_user_id: number | string | null;
}

/** A positive integer id, or `null` for an empty / invalid selection. */
export function toId(value: number | string | null | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Form values for a new plant, or for editing `plant`. */
export function plantFormValue(plant: ManufacturingPlant | null): PlantFormValue {
  return {
    name: plant?.name ?? '',
    input_location_id: plant?.input_location_id ?? null,
    output_location_id: plant?.output_location_id ?? null,
    manager_user_id: plant?.manager_user_id ?? null,
  };
}

/** What is missing to save the plant, or `null` when the form is complete. */
export function plantFormError(value: PlantFormValue): string | null {
  if (!value.name.trim()) return 'Escribe el nombre de la planta';
  if (value.name.trim().length > 100) return 'El nombre admite hasta 100 caracteres';
  if (toId(value.input_location_id) == null) return 'Elige la bodega de insumos';
  if (toId(value.output_location_id) == null) return 'Elige la bodega de producto terminado';
  return null;
}

export function createPlantPayload(value: PlantFormValue): CreateManufacturingPlantDto {
  return {
    name: value.name.trim(),
    input_location_id: toId(value.input_location_id)!,
    output_location_id: toId(value.output_location_id)!,
    manager_user_id: toId(value.manager_user_id),
  };
}

/** Only the fields that changed: an edit never rewrites what the user did not touch. */
export function updatePlantPayload(
  plant: ManufacturingPlant,
  value: PlantFormValue,
): UpdateManufacturingPlantDto {
  const dto: UpdateManufacturingPlantDto = {};
  const name = value.name.trim();
  const input = toId(value.input_location_id);
  const output = toId(value.output_location_id);
  const manager = toId(value.manager_user_id);
  if (name !== plant.name) dto.name = name;
  if (input != null && input !== plant.input_location_id) dto.input_location_id = input;
  if (output != null && output !== plant.output_location_id) dto.output_location_id = output;
  if (manager !== (plant.manager_user_id ?? null)) dto.manager_user_id = manager;
  return dto;
}

/** "Nombre Apellido" of the plant manager, or `null`. */
export function managerName(
  manager: { first_name?: string | null; last_name?: string | null } | null | undefined,
): string | null {
  if (!manager) return null;
  const name = [manager.first_name, manager.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}
