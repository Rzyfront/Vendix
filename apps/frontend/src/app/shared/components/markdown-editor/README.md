# markdown-editor

Editor Markdown con toolbar, previsualizacion en tiempo real y soporte para subir imagenes.

## Uso

```html
<!-- Basico con two-way binding -->
<app-markdown-editor [(content)]="markdownContent"></app-markdown-editor>

<!-- Con upload de imagenes -->
<app-markdown-editor [(content)]="markdownContent" [uploadFn]="uploadImageFn"></app-markdown-editor>
```

```typescript
// Registrar la funcion de upload
uploadImageFn = (file: File): Observable<{ key: string; url: string }> => {
  return this.uploadService.upload(file);
};
```

## Inputs

| Input      | Tipo                                     | Default     | Descripcion                             |
| ---------- | ---------------------------------------- | ----------- | --------------------------------------- |
| `content`  | `string`                                 | `''`        | Contenido Markdown                      |
| `uploadFn` | `(file: File) => Observable<{key, url}>` | `undefined` | Funcion para subir imagenes al servidor |

## Outputs

| Output          | Tipo                   | Descripcion                      |
| --------------- | ---------------------- | -------------------------------- |
| `contentChange` | `EventEmitter<string>` | Emite cuando el contenido cambia |

## Importante

- Toolbar incluye: negrita, cursiva, H2, H3, lista, lista numerada, enlace, imagen
- El boton de imagen solo aparece cuando `uploadFn` esta definido
- La previsualizacion se renderiza con `markdownToHtml` de `shared/utils/markdown.util`
- El cursor se posiciona automaticamente al insertar markdown o imagenes
- Usa `@ViewChild` para el textarea — requiere `ViewChild` en el selector del componente
