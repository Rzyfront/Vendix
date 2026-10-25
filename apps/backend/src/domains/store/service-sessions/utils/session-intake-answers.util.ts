/**
 * Respuestas de la plantilla de estación guardadas en la atención (placa, marca,
 * kilometraje, estilo, alergias…), listas para mostrar en el detalle de la orden y
 * en el seguimiento del cliente.
 *
 * Solo lee los campos de entidad `service_session` (los de cliente viven en su
 * perfil). Con `hideSensitive` se omiten claves/patrones de desbloqueo: el enlace
 * público de seguimiento se puede reenviar.
 */
export interface SessionIntakeAnswer {
  label: string;
  value: string;
}

interface MetadataValuesReader {
  entity_metadata_values: {
    findMany(args: unknown): Promise<unknown[]>;
  };
}

const SENSITIVE_KEY = /(clave|contrase|password|\bpin(?:[_-]|\b)|patron|patrón|desbloqueo|codigo|código|passcode|cedula|cédula|documento|alergia|salud)/i;

export async function loadSessionIntakeAnswers(
  client: MetadataValuesReader,
  storeId: number,
  sessionId: number,
  options: { hideSensitive: boolean },
): Promise<SessionIntakeAnswer[]> {
  const rows = (await client.entity_metadata_values.findMany({
    where: { store_id: storeId, entity_type: 'service_session', entity_id: sessionId },
    select: {
      value_text: true,
      value_number: true,
      value_date: true,
      value_bool: true,
      field: { select: { label: true, field_key: true, field_type: true, sort_order: true, id: true } },
    },
  })) as Array<{
    value_text: string | null;
    value_number: unknown;
    value_date: Date | null;
    value_bool: boolean | null;
    field: { label: string; field_key: string; field_type: string; sort_order: number; id: number };
  }>;
  return rows
    .filter((row) => !(options.hideSensitive && SENSITIVE_KEY.test(`${row.field.field_key} ${row.field.label}`)))
    .sort((a, b) => a.field.sort_order - b.field.sort_order || a.field.id - b.field.id)
    .map((row) => ({ label: row.field.label, value: formatValue(row) }))
    .filter((answer) => answer.value !== '');
}

function formatValue(row: { value_text: string | null; value_number: unknown; value_date: Date | null; value_bool: boolean | null; field: { field_type: string } }): string {
  switch (row.field.field_type) {
    case 'checkbox':
      return row.value_bool == null ? '' : row.value_bool ? 'Sí' : 'No';
    case 'number':
      return row.value_number == null ? '' : String(Number(row.value_number));
    case 'date':
      return row.value_date ? row.value_date.toISOString().slice(0, 10) : '';
    default:
      return (row.value_text ?? '').trim();
  }
}
