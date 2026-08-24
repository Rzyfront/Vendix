/**
 * Configuración de Karma del frontend web.
 *
 * Existe por un motivo medido, no por gusto: con la configuración que genera
 * `@angular/build:karma` por defecto, la suite **no llega al final**. Se corta
 * con
 *
 *     Disconnected , because no message in 30000 ms.
 *     Executed 172 of 399 (21 FAILED) DISCONNECTED (32.02 secs / 1.82 secs)
 *
 * y se reproduce igual CON Zone.js (172/399) y SIN Zone.js (189/399), así que
 * no lo causa el arnés zoneless: preexiste. Los 30 000 ms son el
 * `browserNoActivityTimeout` por defecto de Karma. Con el umbral por defecto,
 * más de la mitad de los tests **nunca se ejecutan** y el renglón final dice
 * `DISCONNECTED`, no `SUCCESS` ni `FAILED` — es decir: cobertura apagada
 * disfrazada de corrida.
 *
 * Subirlo NO arregla el cuelgue: medido a 180 000 ms, la corrida vuelve a
 * cortarse — `Executed 111 of 412 (11 FAILED) DISCONNECTED (3 mins 2.038 secs /
 * 1.881 secs)`. O sea que tras ~1,9 s de tests algo bloquea el hilo del
 * navegador de forma indefinida, y alargar el umbral sólo alarga la espera. Se
 * queda en 60 s: margen suficiente para un runner de CI cargado (el default de
 * 30 s es frágil ahí) sin regalarle tres minutos a un cuelgue. El cuelgue en sí
 * es un defecto aparte, preexistente al arnés zoneless.
 *
 * ATENCIÓN al declarar `karmaConfig` en `angular.json`: el builder hace
 * `options.karmaConfig ? {} : getBuiltInKarmaConfig(...)`
 * (`node_modules/@angular/build/src/builders/karma/application_builder.js:575`),
 * o sea que en cuanto este archivo existe el builder **deja de aportar su
 * configuración built-in**. Por eso aquí se replica: `frameworks`, `plugins`,
 * los reporters y —sobre todo— el customLauncher `ChromeHeadlessNoSandbox`, que
 * es el que usa el job `frontend-test` de `.github/workflows/ci.yml`. Quitarlo
 * de aquí rompe CI con un «browser not found» que no menciona este archivo.
 *
 * Lo que NO se declara a propósito: `basePath`, `files`, `singleRun`,
 * `browsers` y `client.clearContext`. Esos los inyecta el builder después
 * (`karmaOptions.basePath = outputPath`, `karmaOptions.files.push(...)`) y
 * llegan como overrides de CLI, que en Karma ganan al archivo. Declararlos aquí
 * sería escribir algo que no se lee.
 *
 * Skills: `buildcheck-dev`, `how-to-test`, `vendix-zoneless-signals`.
 */
module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    jasmineHtmlReporter: {
      // Quita las trazas duplicadas, igual que la config built-in.
      suppressAll: true,
    },
    coverageReporter: {
      dir: require('path').join(__dirname, '../../coverage/frontend'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    customLaunchers: {
      // Chrome sin sandbox: `--no-sandbox` porque dentro de un runner de CI
      // Chrome no arranca con el sandbox activo, y `--disable-dev-shm-usage`
      // porque el `/dev/shm` de un contenedor es pequeño y Chrome se cae.
      // Réplica de la que declara el builder — la usa el job `frontend-test`.
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: [
          '--no-sandbox',
          '--headless',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      },
    },
    restartOnFileChange: true,

    // El motivo de que este archivo exista. Ver la cabecera.
    browserNoActivityTimeout: 60000,
    // Margen para que Chrome enganche el socket en un runner cargado; el
    // default (60 s) ya bastaba, pero el arranque compite con el bundle.
    captureTimeout: 180000,
  });
};
