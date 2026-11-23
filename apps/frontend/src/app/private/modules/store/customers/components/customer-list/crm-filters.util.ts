/**
 * Filtros de segmento y etiqueta del listado de clientes.
 *
 * Los valores llegan del backend y son propios de la tienda. Si una lista viene
 * vacía, ese filtro NO se construye: nunca hay un selector sin opciones.
 * Función pura para poder probarla sin TestBed.
 */
export interface CrmFilterOption {
  id: number;
  name: string;
}

export interface CrmSelectConfig {
  key: 'segment' | 'tag';
  label: string;
  type: 'select';
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}

const EMPTY = 'Todas';

function select(
  key: 'segment' | 'tag',
  label: string,
  placeholder: string,
  values: ReadonlyArray<CrmFilterOption> | null | undefined,
): CrmSelectConfig[] {
  if (!values?.length) return [];
  return [
    {
      key,
      label,
      type: 'select',
      placeholder,
      options: values.map((value) => ({ value: String(value.id), label: value.name })),
    },
  ];
}

/** Los dos selects dinámicos, en el orden en que se pintan. */
export function buildCrmFilterConfigs(
  segments: ReadonlyArray<CrmFilterOption> | null | undefined,
  tags: ReadonlyArray<CrmFilterOption> | null | undefined,
): CrmSelectConfig[] {
  return [
    ...select('segment', 'Segmento', `${EMPTY} los segmentos`, segments),
    ...select('tag', 'Etiqueta', `${EMPTY} las etiquetas`, tags),
  ];
}

/** `"12"` → 12; vacío o inválido → undefined (el filtro no se manda). */
export function toCrmFilterId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}
