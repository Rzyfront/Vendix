import { Logger } from '@nestjs/common';

/**
 * Ronda 3 (plan CP-pos-exclusive-tax-double-charge, QUI-832, G5): las suites
 * que PASAN igual emiten sus logs `[Nest] LOG` (por ejemplo, `SplitOrderService`
 * registrando cada split en verde), y ese ruido domina el log de CI. Medido
 * antes de este cambio (`src/domains/store/tables`, conteo de líneas `[Nest]`):
 * 19 antes, 0 después — ver el informe de la verificación.
 *
 * `setupFilesAfterEnv` corre esto antes de cada archivo de test, así que
 * aplica a toda corrida de jest sin tocar cada spec uno por uno.
 *
 * DOS silenciadores, no uno, y la razón está medida:
 *
 * 1. `Logger.overrideLogger([])` calla el logger de Nest para cualquier
 *    servicio instanciado directamente (`new FooService(...)`) — cubre la
 *    mayoría de los specs de este repo, que son unitarios sin DI real.
 *
 * 2. Los specs que SÍ usan `Test.createTestingModule({...}).compile()`
 *    quedan FUERA del silenciador de arriba: `@nestjs/testing`
 *    (`testing-module.builder.js`, ruta interna, no exportada en el API
 *    público del paquete) llama internamente
 *    `Logger.overrideLogger(new TestingLogger())` DENTRO de `compile()`, es
 *    decir DESPUÉS de que este archivo corrió — y `TestingLogger` no-opea
 *    `log/warn/debug/verbose` a propósito, pero deja pasar `error()` sin
 *    condición (`error(m, ...p) { return super.error(m, ...p); }`). Medido:
 *    sin el parche de abajo, un spec con `.compile()` que ejercita un
 *    catch-y-loguea (p. ej. `PurchaseOrdersService` probando que un fallo de
 *    auditoría no aborta el receive) sigue imprimiendo `[Nest] ERROR` con el
 *    silenciador (1) solo.
 *
 *    En vez de importar la clase `TestingLogger` por una ruta interna del
 *    paquete (frágil entre versiones), se envuelve `Logger.overrideLogger`
 *    en sí: cualquier logger-objeto que alguien instale DESPUÉS del nuestro
 *    (el propio `TestingModuleBuilder.compile()` incluido) se re-silencia
 *    aquí mismo, apenas se instala, sin importar de qué clase sea.
 *
 * Ninguno de los dos toca el reporter de jest: un test que falla se sigue
 * reportando como falla con toda su traza normal — esto sólo apaga lo que
 * `Logger.log/warn/error/...` imprimiría por su cuenta.
 *
 * Para recuperar los logs de Nest (por ejemplo, depurando un test que sí
 * falla y cuyo log de Nest ayuda a entender por qué):
 *
 *   NEST_TEST_LOGS=1 npm run test:path -- <ruta>
 */
if (process.env.NEST_TEST_LOGS !== '1') {
  Logger.overrideLogger([]);

  const LOG_METHODS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const;
  const originalOverrideLogger = Logger.overrideLogger.bind(Logger);
  Logger.overrideLogger = ((logger: unknown) => {
    const result = originalOverrideLogger(logger as never);
    if (logger && typeof logger === 'object') {
      for (const level of LOG_METHODS) {
        const target = logger as Record<string, unknown>;
        if (typeof target[level] === 'function') {
          target[level] = () => undefined;
        }
      }
    }
    return result;
  }) as typeof Logger.overrideLogger;
}
