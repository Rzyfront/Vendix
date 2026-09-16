# Ronda 0 — sintaxis F-001: salida del transpile (2026-09-11)

Comando (segunda via independiente del `tsc` del revisor delegado):

`node -e` con `transpileModule` del `typescript` del repo sobre los 2 archivos con `template:` inline.

Salida:

`invoice-detail.component.ts` -> 4 errores: TS1005 ',' expected @726 (x2), @727, @1198.
`invoice-create-page.component.ts` -> 7 errores: TS1005 @1550 (x2), @1551, @3016 (x2), @3017.

Veredicto: CONFIRMADO. 11 errores TS1005 en las lineas reportadas; `ng build` falla hasta corregir los 3 comentarios.
