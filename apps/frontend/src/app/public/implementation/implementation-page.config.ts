import { environment } from '../../../environments/environment';

// SEO-OPS-19: interruptor de la ruta /implementacion. Encendido en producción desde
// el 17-nov-2026, cuando Adel aprobó el texto como Producto y Ventas (brief B5, G0-G4).
// Apagarlo exige quitar también la ruta del sitemap y de CloudFront; el pie de la portada
// ya sigue al interruptor.
export const IMPLEMENTATION_PAGE_ENABLED = environment.implementationPageEnabled;
