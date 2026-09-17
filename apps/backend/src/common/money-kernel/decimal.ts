import DecimalJs from 'decimal.js';

/**
 * Constructor de `Decimal` congelado con la configuración EXACTA que usa
 * `Prisma.Decimal` en este monorepo (ADR-16,
 * `docs/critical-plans/CP-pos-exclusive-tax-double-charge/adr/ADR-16-*.md`).
 *
 * VERIFICADO en el árbol instalado, no supuesto:
 * `node_modules/@prisma/client-runtime-utils@7.8.0/dist/index.js` empaqueta
 * `decimal.js@10.5.0` tal cual (`devDependencies: { "decimal.js": "10.5.0" }`
 * en su propio `package.json`) y expone `Prisma.Decimal` como
 * `var Decimal = P.constructor = clone(DEFAULTS)` — es decir, Prisma NUNCA
 * llama a `Decimal.set({...})` con overrides propios. `Prisma.Decimal` corre
 * con los defaults de FÁBRICA de decimal.js:
 *
 *   precision  20   rounding   4 (ROUND_HALF_UP)
 *   toExpNeg   -7   toExpPos   21
 *   modulo     1 (DOWN)
 *
 * `precision` importa de verdad acá: operaciones no exactas como
 * `dividedBy()` (usadas en `dianPriceAmount`, `clearInclusiveLine`,
 * `lineGrossDecimal`) dependen de cuántas cifras significativas trae el
 * cociente ANTES de truncar/redondear a escala DIAN. Si este kernel corriera
 * con un `precision` distinto al de `Prisma.Decimal`, un cociente periódico
 * (2.521,00 / 3 = 840,333333…) podría truncarse en una cifra distinta y
 * producir un centavo de diferencia — exactamente la clase de bug que este
 * ADR existe para eliminar.
 *
 * POR QUÉ SE FIJAN EXPLÍCITOS Y NO SE USA EL DEFAULT DE LA LIBRERÍA TAL CUAL:
 * la configuración de `decimal.js` es GLOBAL por constructor (no por
 * operación). Si este módulo usara el `Decimal` importado sin clonar, y una
 * versión futura de `decimal.js` (en cualquiera de los dos lugares donde se
 * declara — acá o en `client-runtime-utils`) cambiara sus defaults de
 * fábrica, el kernel y `Prisma.Decimal` divergirían en silencio: dos
 * constructores con configuraciones distintas es la reintroducción, por la
 * puerta de atrás, del bug de la orden 5928 que este paquete existe para
 * cerrar. Fijar los cinco valores explícitos hace que la paridad sea un
 * hecho verificado en el código, no una coincidencia entre dos "default" que
 * hoy resultan ser iguales.
 *
 * `maxE`/`minE`/`crypto` no se tocan: ninguna cantidad DIAN (2-6 decimales)
 * se acerca a esos límites, y `clone()` los hereda de los defaults de
 * fábrica de `decimal.js` cuando no se pasan explícitos — que es, de nuevo,
 * lo mismo que hace `Prisma.Decimal`.
 *
 * NADIE en este paquete debe importar `decimal.js` directamente ni usar un
 * `Decimal` distinto de este: todo pasa por acá.
 */
export const Decimal = DecimalJs.clone({
  precision: 20,
  rounding: 4, // ROUND_HALF_UP
  toExpNeg: -7,
  toExpPos: 21,
  modulo: 1, // DOWN
});

// eslint-disable-next-line @typescript-eslint/no-redeclare -- patrón estándar
// de decimal.js: el mismo nombre es el VALOR (constructor) y el TIPO
// (instancia), igual que `Prisma.Decimal` en el resto del backend.
export type Decimal = InstanceType<typeof Decimal>;
