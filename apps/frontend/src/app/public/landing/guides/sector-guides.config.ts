import { environment } from '../../../../environments/environment';

// Interruptor de vista previa: en desarrollo monta las siete guías y la sección de
// la portada; en producción está apagado.
export const SECTOR_GUIDES_ENABLED = environment.sectorGuidesEnabled;

/** Todas las guías que existen en `sector-guides.content.ts`. */
export const SECTOR_GUIDE_KEYS: readonly string[] = [
  'comandas-restaurantes',
  'ventas-mayoristas-al-detal',
  'preparar-demostracion',
  'cierre-de-caja',
  'control-de-inventario',
  'elegir-software-pos',
  'pasar-productos-excel-a-pos',
];

/**
 * SEO-OPS-36: guías piloto aprobadas una por una por Adel (Producto y Ventas) el
 * 19-nov-2026. Son las únicas que se sirven en producción, indexables y con
 * canonical propio. Al publicar otra: agregarla aquí, al sitemap del backend
 * (marketing-sitemap.registry.ts) y al smoke SEO.
 */
export const PUBLISHED_SECTOR_GUIDES: readonly string[] = [
  'comandas-restaurantes',
  'ventas-mayoristas-al-detal',
  'pasar-productos-excel-a-pos',
];

/** Guías con ruta: todas en vista previa; solo las publicadas en producción. */
export const ROUTED_SECTOR_GUIDES: readonly string[] = SECTOR_GUIDES_ENABLED
  ? SECTOR_GUIDE_KEYS
  : PUBLISHED_SECTOR_GUIDES;

export function isPublishedSectorGuide(key: string): boolean {
  return PUBLISHED_SECTOR_GUIDES.includes(key);
}
