/**
 * Clave de comparación de direcciones. Réplica EXACTA de
 * `AddressesService.addressKey` (privado): sin tildes, sin mayúsculas y con
 * todo lo que no sea alfanumérico colapsado a un espacio. Se replica aquí para
 * marcar "ya registrada" en el análisis sin tocar el servicio de direcciones.
 */
export function addressKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
