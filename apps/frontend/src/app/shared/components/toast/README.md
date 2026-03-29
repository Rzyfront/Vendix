# ToastContainer / ToastService

Sistema de notificaciones temporales (toasts) con animaciones de entrada/salida, progresion y auto-dismiss.

## ToastService

Servicio inyectable proporcionado a nivel root. Es el punto de entrada para mostrar toasts.

### Uso del servicio

```typescript
import { ToastService } from './toast.service';

constructor(private toast: ToastService) {}

// Metodo generico
this.toast.show({
  title: 'Guardado',
  description: 'Los cambios se guardaron correctamente.',
  variant: 'success',
  duration: 2000,
});

// Helpers rapidos
this.toast.success('Producto creado', 'Exito');
this.toast.error('Error de conexion', 'Error', 3000);
this.toast.warning('Verifica los datos');
this.toast.info('Nueva actualizacion disponible');
```

### Metodos del ToastService

| Metodo    | Parametros                                               | Descripcion                    |
| --------- | -------------------------------------------------------- | ------------------------------ |
| show()    | Partial<Toast> con description, title, variant, duration | Muestra un toast personalizado |
| success() | msg, title?, duration?                                   | Toast con variante 'success'   |
| error()   | msg, title?, duration?                                   | Toast con variante 'error'     |
| warning() | msg, title?, duration?                                   | Toast con variante 'warning'   |
| info()    | msg, title?, duration?                                   | Toast con variante 'info'      |
| dismiss() | id: string                                               | Cierra un toast por su id      |
| clear()   | -                                                        | Cierra todos los toasts        |

### Interfaz Toast

```typescript
interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant: "default" | "success" | "warning" | "error" | "info";
  duration: number; // ms
  leaving: boolean; // Estado interno para animacion de salida
}
```

## ToastContainerComponent

Componente standalone que renderiza la pila de toasts. Debe incluirse una sola vez en la raiz de la aplicacion.

### Uso

```html
<!-- En app.component.html o similar -->
<app-toast-container></app-toast-container>
```

## Importante

- `<app-toast-container>` debe existir en el template raiz para que los toasts se rendericen.
- `ToastService` es un singleton (`providedIn: 'root'`), se inyecta donde se necesite.
- La duracion por defecto es 1750ms (1750ms para helpers: success/info=1500ms, error=2000ms, warning=1750ms).
- Los toasts se auto-dismiss al completar la duracion, con animacion de salida de 200ms.
- El container se posiciona en `fixed top-4 right-4` con z-index alto (10000).
