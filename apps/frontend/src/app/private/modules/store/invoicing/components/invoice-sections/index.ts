/**
 * Barril de las secciones compartidas de la captura fiscal.
 *
 * Existe para que las dos páginas importen de UN sitio: cuando cada una
 * importaba componente por componente con rutas relativas largas, mover un
 * archivo obligaba a tocar las dos, y en la práctica se tocaba una.
 *
 * No re-exporta las especificaciones ni nada que no consuman las páginas.
 */
export * from './invoice-section-context';
export * from './invoice-section-field-map';
