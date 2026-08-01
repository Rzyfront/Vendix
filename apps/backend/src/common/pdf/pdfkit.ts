/**
 * Constructor de PDFKit resuelto de forma segura para el emit de `tsc`.
 *
 * ## Por qué existe este archivo
 *
 * `pdfkit` es CommonJS puro: `module.exports = PDFDocument`. No marca
 * `__esModule` ni expone `.default`. Verificable en runtime:
 *
 * ```
 * node -e "const m=require('pdfkit'); console.log(typeof m, !!m.__esModule, typeof m.default)"
 * // function false undefined
 * ```
 *
 * `apps/backend/tsconfig.json` declara `allowSyntheticDefaultImports: true`
 * pero NO `esModuleInterop: true`. Esa combinación es la trampa:
 *
 *  - `allowSyntheticDefaultImports` solo relaja el TYPE-CHECK — permite
 *    escribir `import PDFDocument from 'pdfkit'` sin error de compilación.
 *  - `esModuleInterop` es lo que cambia el EMIT — inyecta el helper
 *    `__importDefault`, que envuelve el módulo CJS en `{ default: modulo }`.
 *
 * Sin el segundo, `tsc` emite `pdfkit_1.default` crudo → `undefined` →
 * `TypeError: pdfkit_1.default is not a constructor` en runtime.
 *
 * El fallo NO se ve en desarrollo porque `npm run start:dev` compila con
 * `--builder swc`, y SWC sí aplica interop (`_interop_require_default`) sin
 * pedir la bandera. Producción compila con `nest build` (tsc), que no. Ese
 * desfase es lo que dejaba pasar el bug hasta prod: build verde, dev verde,
 * 400 en producción.
 *
 * ## Por qué el fix es este y no `esModuleInterop: true`
 *
 * Activar `esModuleInterop` arregla la raíz pero cambia el emit de TODO el
 * backend: los `import * as X` que hoy se usan como callables dejarían de
 * type-checkear y el interop de cada dependencia CJS cambiaría de forma. Es
 * un cambio que merece su propio PR con build completo, no un hotfix de
 * producción. Este módulo neutraliza el problema en el único punto donde
 * importa, con costo cero y sin tocar la configuración global.
 *
 * ## Uso
 *
 * ```ts
 * import { PDFDocument } from '@common/pdf/pdfkit';
 * const doc = new PDFDocument({ size: 'letter' });
 * ```
 *
 * Nunca `import PDFDocument from 'pdfkit'` en este repo mientras
 * `esModuleInterop` siga apagado.
 */
import * as PDFKitNs from 'pdfkit';

export const PDFDocument: typeof import('pdfkit') =
  ((PDFKitNs as unknown as { default?: typeof import('pdfkit') }).default ??
    PDFKitNs) as typeof import('pdfkit');

export default PDFDocument;
