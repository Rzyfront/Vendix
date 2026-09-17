# Evidence — E.3 Mobile POS search parity (2026-09-17)

## Cambios (solo apps/mobile)

- `ProductService.list`: strip de min_price/max_price/in_stock/sort_by/
  sort_order antes de enviar (siguen en el tipo para el fallback local).
- `ProductService.search`: nuevo param opcional `page` (default 1).
- `pos/index.tsx`: useQuery → useInfiniteQuery (límite p1 intacto 50/20),
  footer con contador "Mostrando X de Y" + botón "Cargar más", no-re-sort
  bajo search (`sort_by && !search`), 3 comentarios corregidos.

## Specs

- `product.service.spec.ts`: 4/4 (strip 5 keys, URL 200-segura, search+page,
  default p1 intacto).
- `tsc --noEmit` móvil: limpio.

## Vivo (store 10)

- Request móvil nuevo (strip) → 200.
- Request móvil viejo (+min_price=1000) → 400 SYS_VALIDATION_001 (el bug era
  real: drawer "Precio Mínimo" ⇒ grid vacía; el strip lo cierra).
- `search=a&limit=20&page=2` → total 87, 20 filas (ranks 21-40: rank-25
  alcanzable igual que web).
