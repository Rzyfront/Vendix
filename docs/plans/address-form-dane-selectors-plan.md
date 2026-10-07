# Plan — Dirección con selectores DANE y ajustes POS/GPS

## Context
En el POS de Multimarcas Ever (store 85, 2026-10-02) la dueña escribió una dirección nueva con Ciudad = "La guajira" y Departamento = "Riohacha". `app-address-form-fields` usa texto libre en ambos campos, la zona de envío 59 compara `regions={La Guajira}` contra el departamento y la cotización devolvió `[]` ("No hay tarifa de envío para esta ubicación") aunque la tarifa gratis estaba activa. El resolve DANE también falló con los valores cruzados, así que el selector visible "Municipio (DANE)" quedó como un tercer campo redundante. Además, el mapa no tiene forma de volver a la dirección después de moverlo. Resultado esperado: Departamento y Ciudad salen de un catálogo con búsqueda (DANE), `municipality_code` se llena solo y el mapa tiene un botón para recentrar en la dirección. Por ahora solo se opera con Colombia (decisión del owner, 2026-10-02).

Ampliaciones solicitadas durante la ejecución (owner, 2026-10-02): la propina del POS debe iniciar colapsada en una acción claramente clicable «Agregar propina»; «Recoger en tienda» debe aparecer junto a los métodos de entrega, sin exigir dirección/coordenadas y cobrando su tarifa configurada, nunca un cero inventado. El owner también habilita GPS explícito para preventistas: botón debajo de pantalla completa que solicita permiso solo al pulsarlo, separado del recentrado de dirección. Esta instrucción sustituye la suposición inicial de POS exclusivamente en caja fija. La última anotación del owner retira el botón adicional `amp-recenter-button`: se conserva GPS debajo de pantalla completa, no el recentrado de dirección. Las ampliaciones siguen sopus/parallel en develop y el push solicitado a origin/develop.

## General Objective
Que ninguna dirección capturada en Vendix pueda tener ciudad y departamento inválidos o cruzados, porque ambos salen del catálogo DANE, y que el mapa permita geolocalización explícita por GPS sin sobrescribir la geografía DANE.

## Specific Objectives
1. `GET store/addresses/dian/municipalities?department_code=44` devuelve todos los municipios de ese departamento (La Guajira = 15), sin el tope de 50. Lo mismo para el espejo de superadmin.
2. En `app-address-form-fields`, Departamento es un `app-selector` con búsqueda sobre los 33 departamentos DANE, y Ciudad es un `app-selector` con búsqueda filtrado por el departamento elegido. Ciudad está deshabilitada mientras no haya departamento.
3. Al elegir una ciudad, el form guarda `city` y `state_province` con los nombres oficiales y `municipality_code` con el código DANE de 5 dígitos. El bloque visible "Municipio (DANE)" desaparece en todos los consumidores.
4. Una dirección guardada con texto que resuelve en DANE se rehidrata preseleccionada. Si no resuelve (incluido el caso invertido), los selectores quedan vacíos con el texto viejo como pista y el form es inválido hasta que se elija.
5. Sustituido por la última anotación: retirar el botón extra «Centrar en la dirección» y conservar el GPS explícito debajo de pantalla completa; al invalidar la dirección se limpia el marcador obsoleto.
6. En el POS, con la dirección de Riohacha elegida desde los selectores, la cotización devuelve la tarifa 85 a $0.

7. La propina opcional del POS inicia colapsada; un botón con icono +, borde, hover y foco abre los campos, conserva montos al colapsar y expande errores de validación.
8. El grid de entrega ofrece pickup activo sin dirección: obtiene una tarifa real del método (incluido el bruto fiscal), conserva rate_id y valida el importe también en el cobro servidor.

9. El POS ofrece GPS explícito debajo de pantalla completa para preventistas; permisos/denegación no sobrescriben geografía DANE y al invalidar el punto se retira el marcador anterior.

## Approach Chosen
Mantener los mismos controles del form (`city`, `state_province` y `municipality_code` como strings), para que el contrato `AddressPayload` y los 7 consumidores no cambien. Encima de ellos se ponen dos `app-selector` searchable alimentados por el catálogo DANE del backend (`dian/departments` ya existe; a `dian/municipalities` se le añade `department_code`). El valor del selector de Ciudad es el código DANE. Al cambiar, escribe por dentro `municipality_code`, `city = name` y `state_province = department_name`. Se reutiliza el patrón `@if CO → selector` de `legal-data-form` y el `DianMunicipalityLookupService` (con su conmutación store/superadmin). El mapa conserva `GeolocateControl` nativo: solicita GPS tras clic y emite solo coordenadas. El control custom de recentrado se retira por instrucción posterior.

## Alternatives Considered
- Selectores sobre api-colombia (`FE/services/country.service.ts`, como `legal-data-form`): se descarta porque sus IDs no son DANE, depende de un servicio externo sin SLA y repetiría el bug documentado de `city="694"` en `address-modal`.
- Dejar texto libre y corregir el cruce en backend (`resolveMatchingZones` reintentando con los campos intercambiados): se descarta como solución principal porque solo tapa el síntoma en envío y deja datos sucios en facturación y despacho. Además, con selectores el cruce deja de ser posible.
- Enviar al frontend el catálogo completo (1122 municipios) y filtrar en cliente: se descarta porque el backend ya tiene el índice por departamento. Un filtro por `department_code` cuesta poco y evita un payload grande en cada form.
- Reemplazar el recentrado de la dirección por GPS: se descarta mezclar ambas acciones. Por la ampliación del owner, GPS sí queda disponible como botón independiente para preventistas; no se reemplaza geografía ni texto de dirección con resultados de GPS. El recentrado adicional se retiró por instrucción posterior.

## Critical Files
- `apps/backend/src/domains/store/addresses/dto/dian-municipality.dto.ts` — nuevo `department_code` opcional (2 dígitos).
- `apps/backend/src/domains/store/addresses/dian-municipalities.service.ts` — `search` filtra por `department_code` y omite el tope de 50 cuando viene.
- `apps/backend/src/domains/store/addresses/addresses.controller.ts` — pasa `department_code` a `search`.
- `apps/backend/src/domains/superadmin/addresses/dian-geography.controller.ts` — mismo parámetro en el espejo de superadmin.
- `apps/backend/src/domains/store/addresses/dian-municipalities.service.spec.ts` — spec del filtro (se crea si no existe).
- `apps/frontend/src/app/shared/services/dian-municipality-lookup.service.ts` — `listDepartments()` y `listByDepartment(code)` cacheados.
- `apps/frontend/src/app/shared/components/address-form-fields/address-form-fields.component.ts` — selectores, rehidratación, quitar `municipalitySelectVisible` y `onMunicipalitySelected` visibles.
- `apps/frontend/src/app/shared/components/address-form-fields/address-form-fields.component.html` — reemplazar los `app-input` de Ciudad y Departamento y el bloque "Municipio (DANE)".
- `apps/frontend/src/app/shared/components/address-form-fields/address-form-fields.component.spec.ts` — actualizar el bloque H7 y añadir specs de selectores y rehidratación.
- `apps/frontend/src/app/private/modules/ecommerce/components/address-map-picker/address-map-picker.component.ts` — GPS debajo de pantalla completa y descarte de marcador obsoleto.
- `apps/frontend/src/app/private/modules/ecommerce/components/address-map-picker/address-map-picker.component.scss` — estilos compartidos del mapa; no debe quedar estilo del botón retirado.

- `apps/backend/src/domains/store/shipping/shipping.controller.ts` — cotización autenticada pickup sin dirección del comprador.
- `apps/backend/src/domains/store/shipping/dto/shipping_calc.dto.ts` — DTO con shipping_method_id positivo para pickup.
- `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` — reutilización de tarifas/impuesto de pickup, sin cambiar el fallback storefront.
- `apps/backend/src/domains/store/shipping/shipping-calculator.service.spec.ts` — tarifas pickup y regresión de geografía del fallback.
- `apps/backend/src/domains/store/orders/orders.service.ts` — trabajo pendiente de otra sesión: conservar tarifa e impuesto de pickup al guardar/editar o asignar entrega; no incluir su fuente en progreso en este push.
- `apps/backend/src/domains/store/orders/orders.service.spec.ts` — regresiones adicionales preparadas en 37301b9c, diferidas con a6ecd1300 hasta recibir la fuente de la otra sesión.
- `apps/backend/src/domains/store/orders/orders.service.shipping-tax.spec.ts` — regresiones preparadas en 37301b9c, diferidas hasta recibir la implementación concurrente.
- `apps/backend/src/domains/store/payments/payments.service.ts` — validación server-authoritative del precio de la tarifa pickup real.
- `apps/backend/src/domains/store/payments/payments.service.shipping-tax.spec.ts` — pruebas de tarifa, impuesto y rechazo de importe manipulado.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-shipping.service.ts` — cliente de pickup-quote y propagación DANE al quote de domicilio.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.ts` — métodos pickup visibles, cotización sin dirección, tarifa real y guards.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.html` — tarifas pickup visibles, sin etiqueta falsa «sin costo» ni override manual pickup.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.spec.ts` — proyección real del editor DANE y pickup con/sin tarifa.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.ts` — estado de expansión de propina y apertura al validar.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.html` — botón indicativo y controles de propina condicionados.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.scss` — affordance de acción y foco accesible.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.spec.ts` — colapso, apertura, reset y contrato de propina.

## Reusable Assets
- `apps/frontend/src/app/shared/components/selector/selector.component.ts` — CVA `app-selector` con `[searchable]="true"` y filtrado en cliente: es el selector con búsqueda que se pide.
- `apps/frontend/src/app/shared/services/dian-municipality-lookup.service.ts` — `resolveByName`, `resolveByCode`, cache y conmutación automática store/superadmin de la URL base.
- `apps/backend/src/domains/store/addresses/addresses.controller.ts:96` — `GET dian/departments` ya devuelve los 33 `{code,name}`. Hoy el frontend no lo consume.
- `apps/backend/src/domains/store/addresses/dian-municipalities.service.ts:256` — índice interno de municipios por departamento.
- `apps/frontend/src/app/shared/components/forms/legal-data-form/legal-data-form.component.ts:305-349` — patrón de layout Departamento → Ciudad con `app-selector`.
- `apps/frontend/src/app/private/modules/ecommerce/components/address-map-picker/address-map-picker.component.ts:52` — `LocateButtonControl`, plantilla del `IControl` custom.
- `apps/frontend/src/app/shared/components/map-view/map-view.component.ts:362` — `onRecenterClick`, referencia de UX para recentrar.

## Steps
1. Filtro `department_code` en el catálogo de municipios (backend)
   Skills: vendix-backend-api, vendix-validation, vendix-address-geocoding, vendix-permissions
   Resources: `npm run buildcheck:test -- src/domains/store/addresses/dian-municipalities.service.spec.ts`; `curl -H 'Authorization: Bearer $TOK' 'http://localhost:3000/api/store/addresses/dian/municipalities?department_code=44'`
   Business decision: el catálogo DANE es la única fuente válida de ciudad y departamento en Colombia. Con `department_code`, la lista es completa (sin tope de 50, porque Antioquia tiene 125 municipios). Se mantiene el permiso `store:addresses:read` y el espejo de superadmin con su permiso actual.
   Why: va primero porque el selector de Ciudad (paso 3) necesita listar los municipios de un departamento y hoy el endpoint no puede.
   Output: DTO con `department_code?: string` (`@Matches(/^\d{2}$/)`). `search({department_code})` devuelve `DianMunicipalityOption[]` ordenado por nombre. Mismo parámetro en `dian-geography.controller.ts`.
   Verification: el spec cubre que `department_code='44'` devuelve 15 municipios, todos con `department_code='44'`, que `'05'` devuelve 125 y que `'99'` devuelve los 4 municipios de Vichada. `'00'` devuelve `[]` como departamento inexistente. Con curl, `department_code=4X` responde 400.

2. Métodos de catálogo en `DianMunicipalityLookupService` (frontend)
   Skills: vendix-frontend, vendix-frontend-state, vendix-zoneless-signals
   Resources: `docker logs vendix_frontend --tail 50` (o `buildcheck.sh --watch`, según `buildcheck-dev`)
   Business decision: departamentos y municipios por departamento se piden una sola vez por sesión (cache por clave), respetando la URL base store/superadmin que ya resuelve el servicio.
   Why: antes del form (paso 3), porque es su fuente de opciones. Va después del paso 1, porque consume el filtro nuevo.
   Output: `listDepartments(): Observable<{code,name}[]>` y `listByDepartment(code): Observable<DianMunicipalityOption[]>`, ambos con `shareReplay`/cache.
   Verification: el watch del frontend compila sin errores y una llamada repetida no genera una segunda request (revisado en la pestaña de red con Playwright MCP en el paso 6).

3. Selectores Departamento → Ciudad y DANE interno en `app-address-form-fields`
   Skills: vendix-angular-forms, vendix-zoneless-signals, vendix-frontend-component, vendix-address-geocoding, vendix-ui-ux
   Resources: `npm run zoneless:audit`; `docker logs vendix_frontend --tail 50`
   Business decision: solo Colombia por ahora (owner, 2026-10-02), así que no hay rama de texto libre. Departamento y Ciudad son `app-selector` searchable. Ciudad está deshabilitada sin departamento y se limpia al cambiarlo. El valor de Ciudad es el código DANE, que escribe `municipality_code`, `city` (nombre oficial) y `state_province` (`department_name`) con `emitEvent:false` + `markAsDirty()` + `emitAddressChange()`, para que el re-geocode debounced siga disparándose como hoy. Se elimina el bloque visible "Municipio (DANE)" y su lógica de visibilidad (`municipalitySelectVisible`, `cityLockedByMunicipality`) en todos los consumidores. El geocode de una dirección escrita nunca sobreescribe los selectores.
   Why: es el cambio central y depende de los pasos 1 y 2. Va antes del mapa porque el paso 4 es independiente y más pequeño.
   Output: template con dos `app-selector` en el grid actual (Departamento primero). Controles del form sin cambio de forma, así que `AddressPayload` sigue igual para los 7 consumidores. Validación `required` sobre `municipality_code`.
   Verification: el spec de address-form-fields actualizado cubre cinco casos: (a) elegir La Guajira y luego Riohacha emite `{city:'Riohacha', state_province:'La Guajira', municipality_code:'44001'}`; (b) cambiar de departamento limpia la ciudad; (c) no se renderiza `app-dian-municipality-select`; (d) sin ciudad el form es inválido; (e) el texto se rehidrata (paso 3b). Comando: `npx ng test --include='src/app/shared/components/address-form-fields/address-form-fields.component.spec.ts' --watch=false` (respetando la lista literal de `--include`, ver memoria de karma).

3b. Rehidratación de direcciones guardadas (mismo componente)
   Skills: vendix-angular-forms, vendix-address-geocoding, vendix-zoneless-signals
   Resources: `none`
   Business decision: con `municipality_code` guardado se preselecciona por código (`resolveByCode`). Sin código, se intenta `resolveByName(city, state_province)`; si resuelve, se preselecciona y se normaliza. Si no resuelve (texto basura o campos cruzados como "La guajira"/"Riohacha"), los selectores quedan vacíos con la pista "Antes: <ciudad>, <depto>" y el form queda inválido hasta que el operador elija. Nunca se inventa un municipio.
   Why: va junto al paso 3 porque sin esto los consumidores con datos legados (por ejemplo, las direcciones de la tienda guardadas con códigos "694"/"19") abrirían selectores vacíos sin explicación.
   Output: `initialAddress` sin código hace un único resolve. El estado del form refleja el resultado.
   Verification: casos (e) del spec: `{city:'Riohacha', state_province:'La Guajira'}` sale preseleccionado; `{city:'La guajira', state_province:'Riohacha'}` queda vacío, inválido y muestra la pista.

4. GPS y eliminación del botón adicional (instrucciones posteriores del owner)
   Skills: vendix-address-geocoding, vendix-zoneless-signals, vendix-ui-ux
   Resources: MapLibre `GeolocateControl`; Playwright MCP local; spec focal del mapa.
   Business decision: retirar «Centrar en la dirección» (`amp-recenter-button`), preservando GPS debajo de fullscreen con permiso solo tras clic. El pin/GPS no modifica ciudad ni departamento DANE.
   Why: sustituye el requisito original de recentrado mediante la última anotación del owner.
   Output: Navigation → Fullscreen → GPS; sin control custom de recentrado. `center=null` limpia el marcador y `hasPoint`, incluyendo carga asíncrona.
   Verification: no hay botón retirado; GPS sigue visible y solo solicita posición al pulsar. La limpieza del marcador se conserva en specs y navegador.

5. Revisión de consumidores
   Skills: vendix-frontend, vendix-angular-forms, vendix-zoneless-signals
   Resources: `grep -rn "app-address-form-fields" apps/frontend/src/app`; `npx ng test --include='src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.spec.ts' --watch=false`
   Business decision: ningún consumidor cambia de contrato. Solo se comprueba que ninguno dependía del selector DANE visible ni del `[readonly]` de ciudad. El stub de `pos-checkout-shell.component.spec.ts:178` se ajusta si hace falta.
   Why: va después de los pasos 3-4, cuando el componente compartido ya está terminado.
   Output: los 7 consumidores siguen compilando y sus specs pasan.
   Verification: el spec del POS shipping step pasa y el watch del frontend no muestra errores.

6. Propina opcional colapsada y acción claramente indicativa (ampliación del owner)
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-ui-ux, vendix-currency-formatting, vendix-frontend-icons
   Resources: `npx ng test --include='src/app/shared/components/payment-collector/payment-collector.component.spec.ts' --watch=false --browsers=ChromeHeadless`; Playwright MCP en `https://vendix.com/admin/pos`.
   Business decision: se ocultan inicialmente los campos opcionales, no la propina ya ingresada en el total. El botón de acción tiene +, borde, hover y foco; colapsar conserva el valor, reset lo limpia como antes y un error abre la sección. No cambia ninguna fórmula ni payload.
   Why: solicitud explícita durante la ejecución, independiente del catálogo DANE y de pickup; conserva el contrato del collector compartido en sus dos layouts.
   Output: signal tipExpanded(false), botón «Agregar propina», controles @if y pruebas en payment-collector.
   Verification: specs DOM prueban default cerrado, click abre, importe/submit conservados, reset y error visible; Playwright confirma apariencia y apertura sin cobrar una venta.

7. Pickup visible con tarifa configurada, sin dirección (ampliación confirmada del owner)
   Skills: vendix-backend-api, vendix-validation, vendix-permissions, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-error-handling, vendix-calculated-pricing, vendix-tax-typing, vendix-frontend, vendix-zoneless-signals, vendix-angular-forms
   Resources: `POST /api/shipping/pickup-quote` con `{shipping_method_id}` y JWT seed; Jest focal de shipping-calculator.service.spec.ts y payments.service.shipping-tax.spec.ts; Karma focal de pos-shipping-step.component.spec.ts; Playwright MCP en `https://vendix.com/admin/pos`.
   Business decision: pickup no requiere dirección ni coordenadas, pero sí una tarifa activa real del método/tienda. Precio: regla de pickup ya vigente en backend (`free=0`, otras=`base_cost`), con el mismo cálculo fiscal de bruto. Se ofrecen todas las tarifas activas de ese método; si no hay ninguna se informa y bloquea, sin inventar gratis. El fallback storefront conserva geografía y deduplicación anteriores. El cobro valida el tipo real del método y el bruto en servidor, no delivery_type ni costo manipulados. El override manual pickup sigue oculto; snapshots originales intactos no se re-cotizan.
   Why: respuesta explícita del owner a la ausencia de «Recoger en tienda» en el grid; requiere backend de cotización antes de verificar el nuevo frontend y cobro autoritativo.
   Output: DTO positivo, endpoint autenticado con permisos POS, quotePickupRates reutilizando precio/impuesto pickup, grid y rate selector pickup, validación del cobro y regresiones.
   Verification: quote de pickup con tarifa positiva sin address devuelve el costo real/rate_id; free configurada vale 0; sin tarifa/inactivos/cross-store no producen una opción; pago con importe alterado se rechaza; domicilio conserva required de dirección/coordenadas. Playwright muestra pickup y tarifa sin formulario de dirección.

8. GPS explícito para preventistas y descarte de marcador obsoleto (ampliación del owner)
   Skills: vendix-address-geocoding, vendix-zoneless-signals, vendix-ui-ux, vendix-angular-forms
   Resources: Playwright MCP en `https://vendix.com/admin/pos`; Karma focal de address-map-picker.component.spec.ts y pos-shipping-step.component.spec.ts.
   Business decision: ambas instancias POS habilitan allowGeolocation. El GPS nativo solo pide permiso tras gesto y aparece justo bajo fullscreen; el botón adicional de recentrado se retira por la última instrucción. GPS/pin no sobrescribe ciudad/departamento DANE. Borrar el centro invalida marker y hasPoint.
   Why: el owner señaló uso por preventistas a domicilio; evita el supuesto incorrecto de caja fija y el marcador residual descubierto al cambiar departamento.
   Output: orden Navigation → Fullscreen → GPS, etiqueta «Usar mi ubicación actual», allowGeolocation=true en POS y limpieza de marker sobre center=null.
   Verification: sin gesto no hay getCurrentPosition; al clic se solicita ubicación, denegación no bloquea captura manual; marker/coords llegan en located sin cambiar DANE; al cambiar departamento el pin viejo desaparece y hasPoint queda false.

## End-to-End Verification
1. Con Playwright MCP en `https://<tienda-seed>.vendix.com/admin/pos`: venta → cliente → Envío → Dirección nueva → elegir "La Guajira" → "Riohacha" → escribir una dirección. Se espera que la cotización se haga contra `/api/shipping/calculate` con `city:'Riohacha', state_province:'La Guajira', municipality_code:'44001'` (`browser_network_requests`) y que el paso muestre una tarifa en lugar de "No hay tarifa de envío para esta ubicación". Requiere una zona/tarifa equivalente en la tienda seed.
2. En el mismo flujo, editar una dirección guardada con los campos cruzados: los selectores aparecen vacíos con la pista y "Siguiente" queda bloqueado hasta elegir.
3. Revisar con Playwright MCP el modal de cliente (`customer-modal`) y el editor de dirección de remisión: no aparece "Municipio (DANE)" y al guardar se persiste `municipality_code` (`curl -H 'Authorization: Bearer $TOK' http://localhost:3000/api/store/addresses/<id>` muestra el código).
4. Tests siempre focales y seriales por indicación de memoria del owner (Jest runInBand/heap1024 MB; Karma 1 worker/heap2048 MB): `npx ng test --include='src/app/shared/components/address-form-fields/address-form-fields.component.spec.ts' --include='src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.spec.ts' --watch=false`; `npm run zoneless:audit` sin violaciones nuevas.


Evidencia de ejecución local (2026-10-02):
- Backend: 7/7 DANE, 36/36 shipping calculator y 26/26 Payments shipping tax (69 total), runInBand y heap1024 MB. Transform aislado de ts-jest solo en CLI: son tests runtime, no typecheck completo.
- Frontend antes del retiro final del botón: 156/156 en seis specs focales, ChromeHeadless, NG_BUILD_MAX_WORKERS=1 y heap2048 MB. Tras retirar el botón, spec del mapa 2/2 SUCCESS; sin suite/build global.
- API store/superadmin: 33 departamentos; 44=15, 05=125, 99=Vichada con4 y 00=vacío; 4X=400, sin JWT=401, owner en espejo superadmin=403. La respuesta de 05 publica limit125/totalPages1/hasNextPagefalse.
- Pickup-quote local devuelve rate28/costo2500 sin address; id0 o store_id inyectado=400, sin/badJWT=401, método de otra tienda=no opciones. Playwright recorrió pickup hasta Cobro sin dirección y con total12500. No se confirmó orden ni pago.
- POS DANE real: departamento La Guajira/ciudad Riohacha genera city Riohacha, state_province La Guajira, municipality_code44001 y coordenadas en shipping/calculate; zona seed equivalente devuelve tarifa gratis real. No se validó la tarifa85/store85 en producción.
- GPS navegador: cero llamadas al montar; bajo fullscreen; clic con posición simulada11.55/-72.91 hace una llamada y conserva texto/geografía. Denegación nativa conserva campos. Cambiar departamento elimina coords/marker y hasPoint=false.
- Tip: specs DOM cubren ambos layouts, apertura, conservación, reset, validación y affordance. La tienda seed tiene allowTip=false, por lo que no se atribuye una prueba visual de tip habilitada en esa tienda.
- Los7 consumidores se revisaron por código y el contrato compartido se conservó; los guardados E2E de cliente/remisión y la edición de dirección invertida en otros consumidores quedan pendientes de QA adicional. La hidratación invertida sí tiene regresión unitaria.
- Zoneless audit: fallos globales existentes idénticos a de68005a2, sin nuevas violaciones. Frontend watch y API health saludables para los cambios de este equipo.
- Se borraron exclusivamente fixtures QA creados por este equipo: rates27/28, methods12/13, zone14; verificado que no quedan en métodos/zonas. Sin cambios persistentes de suscripción/settings.
- Orders concurrente: owner confirmó otra sesión activa. Se reprodujo ReferenceError rateCost en su fuente en progreso; no se sobrescribió ni se publicó. Specs de editor/asignación preparadas en37301b9c se difieren con a6ecd1300, recuperables de historia al entregar la implementación. El editor/draft de pickup queda pendiente de esa sesión; no se declara completado por este lote.

## Knowledge Gaps
- Resuelto: `vendix-address-geocoding` actualizado con selectores DANE, department_code, geografía vs texto operativo y GPS explícito; copias sincronizadas. El botón adicional de recentrado se retira también de la guía.
- Resuelto: `vendix-frontend-country-api` distingue direcciones de envío/facturación (DANE backend) de otros selectores api-colombia.
- Fuera de alcance, pero pendiente del diagnóstico: `StoreShippingMethodsService.reEnableForStore` no reactiva las tarifas que `disableForStore` apagó en cascada (plan aparte).

Aprobación de las ampliaciones: instrucciones directas y respuesta del owner durante esta sesión, 2026-10-02.

## Approval Request
Ejecución y push a develop autorizados directamente por el owner. Las anotaciones posteriores prevalecen sobre el requisito original de recentrado. Se publica el trabajo verificado de este equipo; la fuente activa de Órdenes de la otra sesión y el QA adicional detallado arriba no se declaran completados.
