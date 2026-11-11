import { environment } from '../../../environments/environment';

// SEO-OPS-19: interruptor de la ruta /implementacion. Apagado en producción
// hasta que Ventas y Producto firmen el texto (brief B5, G0-G4).
export const IMPLEMENTATION_PAGE_ENABLED = environment.implementationPageEnabled;
