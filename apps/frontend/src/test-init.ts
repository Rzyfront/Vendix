/**
 * Punto de entrada del arnés de pruebas del frontend web.
 *
 * Existe por una sola razón: **la aplicación corre zoneless en producción**
 * (`provideZonelessChangeDetection()` en `app.config.ts`, y el target `build`
 * de `angular.json` con `"polyfills": []`). Mientras el target `test` cargaba
 * `["zone.js","zone.js/testing"]`, los specs corrían sobre un motor de
 * detección de cambios que no es el de producción: un componente que sólo se
 * refresca porque Zone.js parchea `setTimeout`/`Promise`/eventos del DOM
 * pasaba su spec y quedaba roto en pantalla. Un total que no se refresca en la
 * pantalla de captura es un documento emitido con el importe que el operador
 * no vio.
 *
 * Este archivo reemplaza el módulo virtual `angular:test-bed-init` que genera
 * `@angular/build:karma` (ver `node_modules/@angular/build/src/builders/karma/
 * application_builder.js`, `virtualTestBedInit`). El módulo virtual sólo llama
 * a `initTestEnvironment` y no provee nada de detección de cambios, así que el
 * `RootScopeModule` interno del `TestBed` acaba proveyendo `NgZone` real — que
 * necesita Zone.js. Al importar un `NgModule` con
 * `provideZonelessChangeDetection()` **después** de `BrowserTestingModule`, el
 * `{provide: NgZone, useClass: NoopNgZone}` de zoneless gana y la raíz del
 * `TestBed` queda zoneless para los 40 specs, en vez de que cada spec lo
 * parchee por su cuenta.
 *
 * `errorOnUnknownElements` / `errorOnUnknownProperties` se conservan en `true`
 * porque son el valor con el que el builder genera su módulo virtual: bajarlos
 * aquí relajaría en silencio la validación de plantillas de todos los specs.
 *
 * Skills: `vendix-zoneless-signals`, `buildcheck-dev`.
 */
import { NgModule, provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

@NgModule({
  providers: [provideZonelessChangeDetection()],
})
export class ZonelessTestingModule {}

getTestBed().initTestEnvironment(
  [BrowserTestingModule, ZonelessTestingModule],
  platformBrowserTesting(),
  {
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  },
);
