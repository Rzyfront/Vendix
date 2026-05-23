# Matriz legal-tecnica DIAN para ejecucion Vendix

Fecha: 2026-05-17  
Estado: baseline ejecutable para fase 1  
Decision productiva: produccion opera bajo modo DIAN software propio/desarrollo propio por entidad fiscal; Vendix provee la herramienta SaaS, cada cliente es el facturador electronico y firma con su certificado digital.

## Fuentes oficiales

- Resolucion DIAN 000227 de 2025: https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm
- Resolucion DIAN 000165 de 2023: https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm
- Anexo tecnico factura electronica de venta v1.9: https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf
- Catalogo DIAN de proveedores tecnologicos: https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proveedores-tecnologicos/
- Ser facturador electronico DIAN: https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx
- DIAN, 3 pasos para facturar electronicamente: https://www.dian.gov.co/Prensa/Paginas/NG-3-pasos-para-facturar-electronicamente.aspx
- Documento soporte en adquisiciones a no obligados: https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-adquisiciones-no-obligados.aspx
- Documento soporte de pago de nomina electronica: https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-de-Pago-de-Nomina-Electronica.aspx

## Reglas transversales bloqueantes

| Regla | Aplicacion Vendix | Evidencia |
| --- | --- | --- |
| Sujeto fiscal | Todo documento definitivo debe tener `accounting_entity_id`. En `fiscal_scope=ORGANIZATION` se usa la entidad consolidada; en `fiscal_scope=STORE` se usa la entidad de la tienda. | Prueba anti-fuga por dos organizaciones y dos tiendas. |
| Modo productivo | No se permite mock en `NODE_ENV=production`. Si se transmite directo a DIAN, debe existir configuracion de software propio por entidad fiscal: `production/enabled`, software ID/PIN, certificado digital vigente, resolucion/rango y evidencia de habilitacion. | Prueba de bloqueo por configuracion incompleta + evidencia de habilitacion por entidad fiscal. |
| Validacion previa | Vendix valida datos, resolucion, rangos, certificado/configuracion y totales antes de consumir envio. | DTO + validadores de negocio + Bruno negativo. |
| Respuesta DIAN/proveedor | `success=false` nunca marca `sent_ok`, `accepted` ni genera asiento contable. | Prueba de rechazo proveedor. |
| Contabilidad | Facturacion genera asiento definitivo solo con aceptacion DIAN/proveedor. | Evento `invoice.accepted`; no evento contable en validacion local. |
| Auditoria | Cada intento debe conservar request, response, estado, hash/correlation cuando aplique, usuario, entidad fiscal y proveedor. | `dian_audit_logs` y futura evidencia fiscal canonica. |
| Idempotencia | Reintentos no duplican consecutivo, CUFE/CUDE/CUDS/CUNE ni documentos. | Prueba de timeout/retry. |

## Tipos documentales

| Tipo | Codigo interno objetivo | Identificador | Requisitos tecnicos minimos | Estado Vendix | Siguiente accion |
| --- | --- | --- | --- | --- | --- |
| Factura electronica de venta | `sales_invoice` | CUFE | UBL/XML, QR, numeracion autorizada, emisor/adquirente, impuestos, firma con certificado del cliente, validacion DIAN. | Parcial. Hay flujo y XML, pero se corrige rechazo y contabilidad. | Completar software propio DIAN productivo y matriz de campos. |
| Nota credito | `credit_note` | CUDE | Referencia a factura aceptada, CUFE original, causal/codigo, totales, numeracion, XML, validacion. | Parcial. | Agregar causales DIAN y referencia obligatoria robusta. |
| Nota debito | `debit_note` | CUDE | Referencia a factura aceptada, causal/codigo, totales, numeracion, XML, validacion. | Parcial/incompleto. | Separar envio real de debito; no reutilizar credit note. |
| Documento soporte | `support_document` | CUDS | Proveedor no obligado, numeracion autorizada, fecha operacion, descripcion, total, firma/proveedor, XML, transmision. | No implementado como dominio Vendix. | Crear dominio y schema propio. |
| Nota de ajuste documento soporte | `support_adjustment_note` | CUDS/CUDE segun anexo aplicable | Referencia a documento soporte, causal, totales, numeracion, XML, validacion. | No implementado. | Crear flujo posterior al documento soporte. |
| Nomina electronica | `payroll` | CUNE | Sujeto obligado, beneficiario, devengados, deducciones, medio de pago, fecha/hora, numeracion, estado por empleado. | Parcial. | Persistir estado/evidencia por `payroll_item` y software propio DIAN. |
| Ajuste nomina | `payroll_adjustment` | CUNE ajuste | Reemplazo/eliminacion/ajuste segun anexo, referencia a nomina original, evidencia por empleado. | Parcial. | Separar ajustes por empleado y pruebas sandbox. |

## Criterios de salida por fase

| Fase | Criterio no negociable |
| --- | --- |
| Predisposicion | Plan y matriz actualizados; mocks bloqueados en produccion; DIAN directo permitido solo con software propio `production/enabled`, certificado vigente y evidencia de habilitacion; rechazos no son exitosos; contabilidad se mueve a aceptacion. |
| Software propio DIAN | Software ID/PIN por entidad fiscal, certificado digital del cliente, resoluciones asociadas, ambiente productivo habilitado y contrato canonico implementado. |
| Scope fiscal | Facturas/notas nuevas persisten `accounting_entity_id`; ORGANIZATION comparte entidad/configuracion; STORE aisla por tienda. |
| Documento soporte | CRUD, validacion, CUDS, notas de ajuste, contabilidad y Bruno. |
| Nomina | Estado/evidencia por empleado, CUNE por item, ajustes y Bruno. |
| Produccion | 100% bloqueantes cerrados, evidencia sandbox/test set y aprobacion tecnica + contable/legal. |
