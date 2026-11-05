/** Spanish labels shown as the card/page subtitle for each station type. */
export const STATION_TYPE_LABELS: Record<string, string> = {
  carro: 'Carro / Automóvil',
  moto: 'Motocicleta / Moto',
  celular: 'Celular / Electrónica',
  peluqueria: 'Peluquería',
  barberia: 'Barbería',
  salon_belleza: 'Salón de Belleza / Spa',
  general: 'Estación General',
  cava: 'Cava',
  cancha: 'Cancha',
  sala: 'Sala',
  finca: 'Finca',
};

export function stationTypeLabel(type: string | null | undefined): string {
  return (type && STATION_TYPE_LABELS[type]) || STATION_TYPE_LABELS['general'];
}
