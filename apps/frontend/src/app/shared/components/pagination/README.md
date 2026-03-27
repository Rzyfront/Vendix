# Pagination

Control de paginacion con navegacion de paginas y info de rango.

## Uso

```html
<app-pagination [currentPage]="1" [totalPages]="10" [total]="100" [limit]="10" infoStyle="range" (pageChange)="onPageChange($event)"></app-pagination>
```

## Inputs

| Input         | Tipo                  | Default | Descripcion                             |
| ------------- | --------------------- | ------- | --------------------------------------- |
| `currentPage` | `number`              | `1`     | Pagina actual                           |
| `totalPages`  | `number`              | `0`     | Total de paginas                        |
| `total`       | `number`              | `0`     | Total de registros                      |
| `limit`       | `number`              | `10`    | Registros por pagina                    |
| `infoStyle`   | `PaginationInfoStyle` | `none`  | Estilo de info: `range`, `page`, `none` |

## Outputs

| Output       | Tipo                   | Descripcion                        |
| ------------ | ---------------------- | ---------------------------------- |
| `pageChange` | `EventEmitter<number>` | Emite la nueva pagina seleccionada |

## Importante

- Solo se muestra cuando `totalPages > 1`
- Soporta ellipsis para paginas intermedias (maximo 2 adyacentes visibles)
- `infoStyle="range"` muestra "1-10 de 100" basado en `limit` y `total`
