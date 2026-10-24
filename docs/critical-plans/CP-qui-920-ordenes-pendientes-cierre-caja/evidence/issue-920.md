# Fuente QUI-920

- URL: https://linear.app/quickss/issue/QUI-920/feat-alerta-y-gestion-de-ordenes-pendientes-al-cerrar-caja-admin
- Consultado: 2026-10-06 mediante Linear GraphQL, proyecto Vendix; estado In Progress.
- Título: FEAT/ Alerta y gestión de órdenes pendientes al cerrar caja [admin].
- Requisitos: banner rojo con contador; Ver más muestra órdenes de la caja actual; cada fila navega al detalle/POS; opción completar todas; intento de cierre con abiertas exige modal con «Revisar órdenes» o «Continuar y cerrar caja»; cierre con pendientes permitido tras confirmación.
- Criterio original masivo: «funciona de forma atómica». El código actual de bulk es parcial; ADR-03 trata la incompatibilidad.
- Estados nombrados por ticket `completed/delivered/cancelled/refunded`; enum real usa `finished`, no `completed`. La traducción se fija en A.1.
