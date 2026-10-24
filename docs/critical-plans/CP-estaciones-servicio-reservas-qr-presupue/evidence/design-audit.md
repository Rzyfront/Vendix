# Auditoría adversarial de diseño — ronda 1

Se auditaron perspectivas 1–13 antes de implementar. Hallazgos F-001 a F-014 registran fallos de diseño, su escenario y corrección en pasos/contratos. Estado `fixed` significa **plan corregido**, no funcionalidad implementada. Los contratos, pruebas y checklists de ejecución permanecen pendientes.

## Cobertura
- 1 arquitectura: checkout sin reserva firme, token/guard separados.
- 2 implementación: borrado de citas y escritores alternos.
- 3 frontend↔backend: rutas reales de confirmación, cancelación, órdenes y pagos.
- 4 base de datos: citas futuras, FK compuestas, versión de orden y snapshot.
- 5 errores: 23P01, hold vencido, 401/403, token indisponible.
- 6 seguridad: token público, tienda cruzada, logs y permisos.
- 7 validación: DTO condicional, bypass flags, intervalos y variantes.
- 8 carga: índices de intervalo, paginación, expiración de holds.
- 9 estrategia: rollback mantiene exclusión y drenaje de sesiones.
- 10 UI/UX: rutas desde servicio, calendario, POS y orden.
- 11 accesibilidad: etiquetas, foco, avisos, contraste y zoom.
- 12 comprensión: desglose y consentimiento, canal alterno, copy por sector.
- 13 observabilidad: correlación de propuesta a aplicación y alertas.

## Decisiones aún humanas
A.1 debe ratificar el carácter compartido/capacidad de la estación, cálculo del tope, canal y prueba de aprobación. Nada de este documento autoriza ejecución.
