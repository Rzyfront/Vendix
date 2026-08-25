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
/**
 * `invoice-section-controls` quedó fuera del barril cuando se creó el armazón,
 * y con él sin exportar el armazón no tenía forma de usarse: es el mecanismo
 * por el que un componente compartido recibe un `FormGroup` ajeno y un MAPA DE
 * RUTAS, en vez de `formControlName` —que exigiría que las dos pantallas
 * nombraran sus controles igual, que es justo lo que no ocurre—.
 */
export * from './invoice-section-controls';
export * from './invoice-section-aiu.logic';
export * from './invoice-section-aiu.component';
export * from './invoice-section-documento.component';
