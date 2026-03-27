# file-upload-dropzone

Dropzone para seleccion y previsualizacion de archivos. Soporta imagenes con preview y archivos genericos.

## Uso

```html
<!-- Basico -->
<app-file-upload-dropzone (fileSelected)="onFileSelected($event)"></app-file-upload-dropzone>

<!-- Configurado -->
<app-file-upload-dropzone label="Subir logo" helperText="PNG, JPG hasta 5MB" accept="image/png, image/jpeg" icon="image" [disabled]="isUploading" (fileSelected)="onFileSelected($event)" (fileRemoved)="onFileRemoved()"></app-file-upload-dropzone>

<!-- Reset programatico -->
<app-file-upload-dropzone #dropzone ...></app-file-upload-dropzone>
<!-- En el TS: -->
this.dropzone.clear();
```

## Inputs

| Input        | Tipo      | Default           | Descripcion              |
| ------------ | --------- | ----------------- | ------------------------ |
| `label`      | `string`  | `'Subir archivo'` | Texto del dropzone vacio |
| `helperText` | `string`  | `''`              | Texto de ayuda           |
| `accept`     | `string`  | `'*'`             | Tipos MIME aceptados     |
| `icon`       | `string`  | `'upload-cloud'`  | Nombre del icono Lucide  |
| `disabled`   | `boolean` | `false`           | Deshabilitar interaccion |

## Outputs

| Output         | Tipo                 | Descripcion                           |
| -------------- | -------------------- | ------------------------------------- |
| `fileSelected` | `EventEmitter<File>` | Emite cuando se selecciona un archivo |
| `fileRemoved`  | `EventEmitter<void>` | Emite cuando se elimina el archivo    |

## Metodos

| Metodo    | Descripcion                           |
| --------- | ------------------------------------- |
| `clear()` | Resetea el dropzone programaticamente |

## Importante

- Genera previsualizacion automatica para imagenes (FileReader.readAsDataURL)
- Archivos no-imagen solo muestran nombre y boton cambiar
- El metodo `clear()` es util para reset desde el componente padre
