import { environment } from '../../../environments/environment';

// Gate y rutas de las páginas de sector, sin importar el contenido editorial:
// así el borrador no entra al bundle de producción mientras esté apagado.
// Mantener `SECTOR_PAGE_PATHS` alineado con `SECTOR_PAGES` (lo verifica el spec del contenido).
export const SECTOR_PAGES_ENABLED = environment.sectorPagesEnabled;

export const SECTOR_PAGE_PATHS: readonly string[] = ['sectores/restaurantes', 'soluciones/software-pos'];
