# Reporte: la primera imagen de un producto queda como principal

PR: https://github.com/Rzyfront/Vendix/pull/1392 (base `main`, rama `fix/product-image-main`).

## Historia de usuario
Como dueño de tienda que usa Vex, quiero que la imagen que Vex le agrega a un producto aparezca en las tarjetas del POS, del listado y del e-commerce, sin tener que abrir y guardar el producto.

**Cómo probar:** creo un producto sin imagen, le pido a Vex que le ponga una y miro las tarjetas.
**Lo que se ve:** la imagen aparece de inmediato. Si el producto ya tenía una imagen principal, la nueva queda secundaria.

## Lo hecho (3 commits, sin firmas de IA: el chequeo dio 0)
1. `addImage` (`apps/backend/src/domains/store/products/products.service.ts:6253`): ahora corre dentro de `$transaction` y bloquea la fila del producto con `SELECT ... FOR UPDATE`, después de validar el producto con la consulta que tiene scope de tienda.
   - Si la imagen no viene marcada y el producto no tiene principal, se guarda como principal.
   - Con `is_main: true` se desmarcan las demás.
   - Si ya hay una principal, la nueva queda secundaria.
2. `create` y `update` del producto ya garantizaban la regla al guardar la lista completa de imágenes (~1661 y ~5070), así que no la dupliqué.
3. Migración `apps/backend/prisma/migrations/20270105120000_fix_product_images_main/migration.sql`:
   - Marca como principal una sola imagen por producto que tiene imágenes y ninguna principal: la de menor `sort_order` (NULL cuenta como 0) y, si empatan, la de menor `id`.
   - Es idempotente, no cambia el esquema y lleva la cabecera `DATA IMPACT`.
4. Vex `manage_product_images` (`apps/backend/src/ai-engine/tools/domains/products.tools.ts`): ahora informa el `is_main` que realmente quedó guardado, y la descripción de la herramienta explica la regla. Esto salió como advisory del verificador.

## Specs y resultados
- `src/domains/store/products/products.service.add-image.spec.ts` (nuevo): **6/6**.
  - Con el código anterior el spec falla. En los casos de alta sin principal y de concurrencia falla por la regla; en los demás, porque el código anterior no usaba la transacción que espera el fake.
- `src/ai-engine/tools/domains/products.tools.spec.ts`: **69/69**, incluido el caso nuevo (b2).
- Migración probada en PGlite sin conexión: la primera corrida marcó solo las filas esperadas (ids 4, 6 y 7 en el dataset de prueba) y la segunda cambió 0 filas. El verificador repitió la prueba con 16 filas y obtuvo el mismo resultado.
- Typecheck:
  - No corrí `npx tsc --noEmit -p apps/backend/tsconfig.json` completo, porque en esta Mac revienta la memoria.
  - En su lugar hice un tsc acotado a los archivos tocados: 0 errores en ellos.
  - Salieron 21 errores en otros archivos (`ai-logging.service.ts`, `production-site.util.ts`). Vienen del cliente Prisma compartido del checkout principal, que está generado con otro esquema, y no los causa este cambio.
- Un verificador independiente (subagente) revisó el scope por tienda dentro de la transacción, la serialización con `FOR UPDATE` en READ COMMITTED y la migración. Resultado: OK, sin blockers.
- Antes de cada test confirmé que no había otro jest, tsc o build corriendo. Corrí un spec por invocación, con una configuración temporal `isolatedModules`.
- Limpieza: borré los symlinks temporales de `node_modules` y la configuración temporal de jest.

## Qué quedó fuera
- No tomé snapshot de producción ni ejecuté nada contra producción. Hay que tomar el snapshot antes del deploy y correr el `SELECT count` que está en el PR.
- `removeImage` no promueve otra imagen cuando se borra la principal: el producto vuelve a quedar sin imagen en las tarjetas.
- Los flujos del editor (`create` y `update`) no toman el bloqueo, y si reciben varias imágenes marcadas como principales no las reducen a una.
- La migración no corrige productos que ya tienen dos o más principales; solo trata los que no tienen ninguna.
- Las imágenes de variantes se siguen creando con `is_main: false`. En un producto que solo tiene imagen de variante, `addImage` no interviene, pero la migración sí marcará esa imagen como principal.

Risk: item 1 (migración que modifica `product_images`) e item 4 (bloqueo `FOR UPDATE`). Ambos verificados.
