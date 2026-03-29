# Dropdown

Menu desplegable generico con cierre automatico al hacer clic fuera.

## Uso

```html
<app-dropdown [open]="dropdownOpen" (isOpenChange)="dropdownOpen = $event">
  <button dropdown-trigger (click)="dropdownOpen = true">Opciones</button>

  <a dropdown-item href="/opcion1">Opcion 1</a>
  <a dropdown-item href="/opcion2">Opcion 2</a>
  <button dropdown-item (click)="doSomething()">Accion</button>
</app-dropdown>
```

## Inputs

| Input | Tipo    | Default | Descripcion            |
| ----- | ------- | ------- | ---------------------- |
| open  | boolean | false   | Control de visibilidad |

## Outputs

| Output       | Tipo         | Descripcion                           |
| ------------ | ------------ | ------------------------------------- |
| isOpenChange | EventEmitter | Emite el nuevo estado al abrir/cerrar |

## Importante

- El trigger y los items se pasan via content projection usando `select` directives: `dropdown-trigger` y `dropdown-item`.
- El cierre automatico al hacer clic fuera usa `@HostListener('document:click')` sobre el host del componente.
- El dropdown es `inline-block` y se posiciona absolutamente; el ancestro debe tener `position: relative` si se necesita control preciso.
- No tiene animaciones; el menu aparece/oculta directamente con `*ngIf`.
