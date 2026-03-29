# ImageLightbox

Visor de imagen en pantalla completa (lightbox) con navegacion entre imagenes, cierre por teclado y clic en backdrop.

## Uso

```html
<app-image-lightbox [isOpen]="lightboxOpen" [currentImage]="currentImageUrl" alt="Producto" [title]="'Vista previa'" [description]="'Imagen 1 de 3'" [showInfo]="true" [currentIndex]="currentIndex" [totalImages]="totalImages" (close)="lightboxOpen = false" (previous)="prevImage()" (next)="nextImage()"> </app-image-lightbox>
```

## Inputs

| Input        | Tipo              | Default   | Descripcion                                |
| ------------ | ----------------- | --------- | ------------------------------------------ |
| isOpen       | boolean           | false     | Control de visibilidad                     |
| currentImage | string \| SafeUrl | ''        | URL de la imagen a mostrar                 |
| alt          | string            | 'Imagen'  | Texto alternativo de la imagen             |
| title        | string            | undefined | Titulo opcional en el footer               |
| description  | string            | undefined | Descripcion opcional en el footer          |
| showInfo     | boolean           | true      | Mostrar footer con titulo/descripcion      |
| currentIndex | number            | undefined | Indice actual (para navegacion y contador) |
| totalImages  | number            | undefined | Total de imagenes (para contador)          |

## Outputs

| Output   | Tipo         | Descripcion                                 |
| -------- | ------------ | ------------------------------------------- |
| close    | EventEmitter | Emite al cerrar (Escape, backdrop, boton X) |
| previous | EventEmitter | Emite al navegar a la imagen anterior       |
| next     | EventEmitter | Emite al navegar a la siguiente imagen      |

## Importante

- La navegacion se maneja externamente (padre): el componente solo emite eventos, el padre controla el indice y las imagenes.
- Navegacion por teclado: Escape cierra, ArrowLeft/ArrowRight navegan entre imagenes.
- El cierre por backdrop solo ocurre al hacer clic directamente sobre el overlay (no sobre la imagen).
- El icono de carga aparece mientras la imagen no ha completado la carga (`imageLoaded`).
- Requiere `DomSanitizer` para `SafeUrl`.
