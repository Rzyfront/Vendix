# Recepción de documentos y consolidación tributaria — decisiones

Estado: ejecución autorizada por el usuario el 30-09-2026. Trabajo local sobre `develop`; sin push, PR, deploy ni cambios de producción. Este informe registra decisiones tomadas bajo la autorización «cualquier cosa que necesites preguntar decide lo más recomendado»; no atribuye al usuario decisiones que no tomó.

## Business Analysis Brief

### Request
Recepción manual y automática asistida con IA, sincronización con datos del negocio y un consolidado tributario completo, enlazado a compras, gastos, contabilidad, anticipos, saldo por pagar, declaraciones, cierre y reportes.

### Change Type
Feature + Integration + Rule correction + Reporting + Accounting data integrity.

### Domain And Actors
- Dominio: documentos recibidos, compras/gastos, contabilidad y operación fiscal.
- Apps: STORE_ADMIN y ORG_ADMIN web; backend compartido. Mobile queda fuera de esta implementación web, no de los contratos.
- Tenant: organización, entidad fiscal/NIT y ubicación operativa de tienda; las dimensiones fiscal y operativa no se confunden.
- Actores: dueño/admin, receptor/compras, contador/revisor, integración autenticada y worker.
- Entidades: documento original, proveedor, líneas/impuestos, enlaces OC/recepción/gasto/CxP, eventos, declaraciones, créditos, pagos y asientos.

### Confirmed Decisions
- UI primaria: **Fiscal → Facturación → Documentos recibidos** como tab.
- El usuario pide implementación completa, no sólo plan/MVP.
- Mantener rama actual, commits locales, no push.
- Usar sopus y decidir autónomamente lo recomendado; entregar informe de todas las decisiones.

### Assumptions
- «anticipos salud por pagar» se interpreta como «anticipos, saldo por pagar», por el contexto repetido de impuestos; no se eliminan obligaciones existentes de salud/PILA ni se inventa una nueva liquidación de salud.
- Calcular/conciliar y automatizar recepción es deseado; presentación de declaraciones, aceptación comercial y pago externo requieren autorización/evidencia específica. Las pruebas no deben realizar actos legales productivos ni gastar dinero real.
- «Business» es capacidad de suscripción configurable, no nombre de plan hardcodeado ni fiscalidad determinada por el plan.

### Open Questions
El usuario delegó decisiones. Las conexiones/credenciales externas y datos fiscales de cada cliente se configuran en UI; su ausencia debe mostrarse como «no configurado», nunca «sincronizado» o «validado». Cualquier requisito que dependa de estado externo no comprobable quedará explícito en la matriz de evidencia y mantendrá el goal incompleto hasta verificarlo o resolverlo.

### Business Rules
- El original es evidencia inmutable; XML validado y aritmética determinista prevalecen sobre OCR/IA.
- Recibir/asociar un documento no recibe mercancía ni vuelve a crear stock/CxP/asientos.
- Matching compara proveedor/receptor, referencias, líneas/UoM, cantidades, precio/descuento/impuestos/flete y recepción real; sugerir ≠ confirmar ≠ aceptar comercialmente.
- No exigir OC para gasto/servicio; enlaces N:M y recepciones parciales explícitas.
- Cada fuente cuenta una vez, incluidas notas y puente IVA de compras histórico; la información incierta se señala, no se inventa.
- Impuestos se liquidan por contribuyente, familia, jurisdicción y período; sólo se aplican créditos elegibles de ese ámbito con evidencia.
- Un cierre conserva snapshots y no reescribe historia; correcciones/reversos son trazables.

### Use Cases And Variants
- Primario: original→validación→revisión→matching→recepción real/eventos autorizados→conciliación→elegibilidad fiscal→borrador/aprobación→obligación/pagos→cierre y export.
- Alterno: sin OC; PDF/imagen con extracción editable; factura antes/después de mercancía; varias OC o facturas; nota crédito; receptor fiscal consolidado.
- Bloqueado: tenant/NIT ajeno, evidencia insuficiente, XML malicioso, impuesto desconocido, sobreaplicación de créditos, período cerrado, identidad firmante incorrecta, proveedor no configurado.
- Históricos: enlazar fuentes probadas y no borrar/reemitir asientos; puente legacy incierto permanece visible y pendiente.

### Edge Cases
Reentrega manual/webhook/correo/poll; mismo número entre proveedores; CUFE repetido con contenido conflictivo; OCR parcial; cantidades fraccionarias/UoM; impuestos incluidos múltiples; timeout con resultado externo desconocido; competencia entre workers/aprobaciones; crédito compartido; abono/reverso y períodos fiscales distintos de creación OC.

### Acceptance Criteria
- Usuario ve originales/fuentes/exclusiones y puede recorrer documento↔compra↔recepción↔CxP↔asiento↔declaración.
- Intake/matching reintentados no duplican stock, IVA, asiento ni deuda.
- UI/API/borrador/obligación/auxiliar/XLSX coinciden según estado y período; cada diferencia tiene explicación trazable.
- Manual, automático y OCR producen el mismo contrato normalizado y revisión sin falsa aceptación.
- Pagos parciales, créditos y reversos cuadran centavo a centavo y sobreviven recarga/cambio de scope sin datos cruzados.

### Risks / Critical Decisions
Las decisiones D03–D12 siguientes afectan obligaciones legales/contables/datos. Se mantienen controles de autorización y fail-closed; la autonomía del desarrollo no equivale a autorización de operaciones reales externas.

### Candidate Skills For Planning
`how-to-plan`, `how-to-dev`, `sopus`, `parallel`, `vendix-fiscal-scope`, `vendix-operating-scope`, `vendix-prisma-scopes`, `vendix-tax-typing`, `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-ai-engine`, `vendix-ai-queue`, `vendix-report-xlsx`, `how-to-test`, skills frontend/validación/archivos/autorización.

### Handoff To how-to-plan
Plan completo en `docs/plans/received-documents-tax-consolidation-plan.md`. La instrucción del usuario ya autoriza plan+ejecución autónoma; el bloque estándar de Approval Request se conserva como formato, no como una nueva espera obligatoria que contradiga esa autorización.

## Decisiones tomadas

| ID | Decisión | Motivo / alternativa descartada | Qué puede revisar el usuario |
|---|---|---|---|
| D01 | Tab primaria recibidos dentro Facturación, compartida tienda/org | Preferencia explícita; no esconder originales bajo una OC | Etiqueta/orden de tabs |
| D02 | Dominio compartido separado de emitidos, con enlaces explícitos | Números iguales de varios proveedores y diferencias de lifecycle | Organización visual, no mezclar identidades |
| D03 | Intake no modifica stock/CxP/asientos; conciliación confirma efectos | Evitar recepción/deuda/impuesto duplicado | Política de conciliación automática inequívoca |
| D04 | IA transcribe/sugiere; determinismo calcula; OCR requiere revisión | Evidencia y aceptación legal no se delegan al modelo | Umbrales de confianza y tolerancias |
| D05 | Acuse, entrega y aceptación separados; aceptación expresa manual/autorizada por defecto | No convertir coincidencia administrativa en acto jurídico | Autoacuse/autorreglas de aprobación explícitas |
| D06 | 034 sólo observado del emisor en bandeja receptora | No atribuir evento del emisor al comprador | Alertas/plazos; no cambiar el responsable legal |
| D07 | Webhook autenticado/polling configurado y adaptador correo real; cursor y secretos cifrados | No prometer API DIAN universal por NIT ni fuente no probada | Canal/proveedor y frecuencia |
| D08 | Impuesto por NIT/familia/jurisdicción/período; ningún neto universal | Distinguir créditos y obligaciones incompatibles | Reglas legales específicas con evidencia |
| D09 | Reusar/completar calculador de declaraciones para preview y reportes | No crear una tercera cifra fiscal paralela | Presentación/indicadores, no fórmula duplicada |
| D10 | Anticipos, arrastres y retenciones sufridas con procedencia y aplicaciones transaccionales | Impedir doble uso o descuento contra impuesto ajeno | Política de aplicación/revisión |
| D11 | Pago tributario estructurado por obligación, con abonos/reverso/evidencia | Metadata status paid no prueba cancelación de deuda | Métodos/cuentas y autorizaciones de registro |
| D12 | Cierre por conciliación y snapshots; pago futuro no bloquea cierre de causación | No confundir cierre contable con vencimiento de obligación | Checks/overrides auditados |
| D13 | Calendario verificable/versionado y warning bloqueante de fechas no confirmadas | Día20 genérico no es vencimiento legal | Calendario municipal/excepciones concretas |
| D14 | Capacidades de plan y RBAC, sin hardcodear Business | Separar licencia de permisos y obligaciones fiscales | Comercialización/cupos |
| D15 | Migraciones aditivas/idempotentes y FKs RESTRICT | Conservar originales/históricos y seguridad de despliegue | Ninguna eliminación de datos aprobada |
| D16 | Sólo local y QA no productivo; commits incrementales auditados | Mandato del usuario y árbol compartido | Cuándo publicar/desplegar después |
| D17 | Resumen muestra estimado/revisado/declarado/pagado y cobertura | No ocultar fuente incompleta tras número aparentemente definitivo | Diseño de alertas y filtros |
| D18 | «salud por pagar» se interpreta como «saldo por pagar» | Contexto de impuestos; preservar salud/PILA ya existente | Confirmar si quiso una ampliación específica de salud |
| D19 | Validar montos con el perfil DIAN, no la ecuación UBL genérica | En anexo 1.9, TaxInclusive=LineExtension+impuestos directos y Payable=Inclusive−descuentos globales+cargos; anticipos/retenciones son informativos | Perfil por jurisdicción si se amplía fuera de Colombia |
| D20 | Originales locales sólo en desarrollo/pruebas; S3 en producción | QA no debe escribir al bucket productivo; driver local se rechaza en producción y cada descarga comprueba SHA-256 | Bucket y retención de originales por ambiente |
| D21 | Preservar tienda operacional aparte de entidad fiscal consolidada | Resolver fiscal puede devolver store_id=null; eso no autoriza al usuario de tienda a ver todas las sucursales | Vista consolidada sólo con contexto organización autorizado |
| D22 | Recibir documentos no requiere habilitación del flujo de emisión DIAN | Un comprador puede recibir sin emitir; JWT, RBAC, scope y compuerta de suscripción siguen vigentes | Visibilidad comercial por capacidades, no habilitación de ventas |

## Fuentes oficiales consultadas

- [Resolución DIAN 227 de 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm): entrega de documentos y confirmaciones de recepción en ventas a crédito; revisar art. 1.5.4.9.1. No implica descubrimiento universal automático de facturas por NIT.
- [Decreto 1154 de 2020](https://www.cancilleria.gov.co/normograma/compilacion/docs/decreto_1154_2020.htm): separación de aceptación y constancia del emisor; plazo general ligado a recepción de bienes/servicios, no al OCR.
- [Documentación técnica DIAN](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documentacion-tecnica/): contratos UBL/eventos y anexo 1.9 vigente consultado.
- [Calendario tributario DIAN 2026](https://www.dian.gov.co/Calendarios/Calendario_Tributario_2026.pdf): fechas nacionales por dígitos del NIT y periodicidad; no sustituye calendario municipal/excepciones.
- [Concepto DIAN 7762 de 2025](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_7762_2025.htm): distinguir causación IVA de recaudo efectivo.
- [Concepto DIAN 9471 de 2026](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_9471_2026.htm): eventos/aceptación diferenciados; no presentar registro local como validación electrónica.

## Registro de cambios de decisión

- 30-09-2026: se conserva la corrección UI del usuario: recibidos en Facturación, no OC. La ejecución autónoma sustituye la fase previa de sólo propuesta; no implica presentación/pago legal automático productivo.
- Las decisiones adicionales se añadirán aquí con evidencia y motivo, sin borrar las anteriores.
