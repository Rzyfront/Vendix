# Auditoría adversarial del diseño — QUI-919

Tres agentes de lectura revisaron el plan y el código desde las trece perspectivas del protocolo en grupos. Los hallazgos se registraron en `findings/`; la convergencia de implementación aún no ha empezado.

| Perspectiva | Ataque al diseño | Resultado |
|-------------|------------------|-----------|
| 1 Arquitectura | Duplicar conexión SSE o estado KDS persistido | Se reutiliza el bus compartido y se deriva estado; F-001 condiciona exposición de la acción |
| 2 Implementación | Consumir solo ticket nuevo e ignorar edición de ítems | F-003 obliga a incluir `order.items.updated` |
| 3 Contratos FE/BE | Disparar GET con evento sin `ticket.order_id` o usar forma de error equivocada | FB-04 valida payload; F-003/F-004 |
| 4 DB e integridad | Dos POST leen flag false antes de transacción | F-001 blocker; B.2 debe serializar y revalidar |
| 5 Errores | Array vacío devuelve 400, no 422; GET id usa otro código | F-004 y ERR-12 corrigen registro |
| 6 Seguridad | UI bloquea doble clic pero otro cliente duplica POST | F-001, prueba concurrente y backend autoritativo |
| 7 Validación | `skip_kds` y orden terminal enviados por curl | F-002 añade rechazo server-side |
| 8 Carga | Página con 50 órdenes y 20 líneas, varios reenvíos | F-009 exige medición y límite de GET |
| 9 Estrategia | Ejecutar specs Angular bajo runner inexistente | F-005 cambia a Karma one-shot |
| 10 UI/UX | Fuego cae al overflow móvil | B.3 obliga visibilidad y prueba 375/767 px |
| 11 Accesibilidad | Botón disabled/title no accesible en foco/tacto | F-006 redefine indicador enfocable e informativo |
| 12 Comprensión | Falla impresión tras fire confirmado y operador repite envío | F-008 añade guía de reimpresión del ticket existente |
| 13 Observabilidad | Falla GET después de evento con SSE aún abierto | F-007 marca estado obsoleto y exige recuperación |

El hallazgo F-001 fue observado desde integridad y seguridad, y se deduplicó. Los hallazgos permanecen abiertos hasta que su paso tenga implementación y evidencia. Las dos rondas limpias de convergencia corresponden a la ejecución futura, no a esta revisión de diseño.
