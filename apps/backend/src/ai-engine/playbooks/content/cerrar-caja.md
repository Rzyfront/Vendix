---
{
  "name": "cerrar-caja",
  "description": "Cerrar la sesión indicada con efectivo contado por la persona, revisar pendientes y demostrar cierre y diferencia.",
  "metadata": {
    "version": "1.0.0",
    "owner": "vendix-domain-maintainers",
    "industry": [
      "all"
    ],
    "workflow_key": "cerrar-caja",
    "tool_contracts": [
      {
        "name": "get_active_cash_session",
        "version": "1"
      },
      {
        "name": "call_endpoint",
        "version": "1"
      },
      {
        "name": "close_cash_session",
        "version": "1"
      }
    ],
    "required_permissions": [
      "store:cash_registers:close_session",
      "store:cash_registers:movements",
      "store:cash_registers:read"
    ],
    "verifier_ids": [
      "cerrar-caja:v1"
    ]
  },
  "vendix_contract": {
    "schema_version": "1",
    "mode": "executable",
    "inputs": [
      {
        "key": "session_id",
        "description": "ID de la sesión abierta del alcance actual.",
        "source": "lookup",
        "required": true
      },
      {
        "key": "actual_closing_amount",
        "description": "Efectivo contado por la persona; cero es válido, nunca estimar.",
        "source": "user",
        "required": true
      },
      {
        "key": "currency",
        "description": "Moneda y unidad de arqueo confirmadas.",
        "source": "user",
        "required": true
      },
      {
        "key": "pending_decision",
        "description": "Solo decisión explícita resolved/override si hay pendientes.",
        "source": "user",
        "required": false
      },
      {
        "key": "override_reason",
        "description": "Motivo confirmado para override.",
        "source": "user",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "active",
        "section": "steps",
        "tool": "get_active_cash_session",
        "instruction": "Identificar sesión abierta; comparar con session_id y detener si cambió.",
        "depends_on": [],
        "approval": "none",
        "arguments": {}
      },
      {
        "id": "movements",
        "section": "movements",
        "tool": "call_endpoint",
        "instruction": "Contrastar movimientos de la misma sesión.",
        "depends_on": [
          "active"
        ],
        "approval": "none",
        "arguments": {
          "path": "store/cash-registers/sessions/${inputs.session_id}/movements"
        },
        "bridge": {
          "method": "GET",
          "path": "store/cash-registers/sessions/:sessionId/movements"
        }
      },
      {
        "id": "summary",
        "section": "cash-preflight",
        "tool": "call_endpoint",
        "instruction": "Leer efectivo esperado sin reemplazar el conteo humano.",
        "depends_on": [
          "movements"
        ],
        "approval": "none",
        "arguments": {
          "path": "store/cash-registers/sessions/${inputs.session_id}/cash-summary"
        },
        "bridge": {
          "method": "GET",
          "path": "store/cash-registers/sessions/:id/cash-summary"
        }
      },
      {
        "id": "pending",
        "section": "cash-preflight",
        "tool": "call_endpoint",
        "instruction": "Consultar pendientes/fingerprint actual; la persona decide resolver o excepción.",
        "depends_on": [
          "summary"
        ],
        "approval": "none",
        "arguments": {
          "path": "store/cash-registers/sessions/${inputs.session_id}/pending-orders"
        },
        "bridge": {
          "method": "GET",
          "path": "store/cash-registers/sessions/:id/pending-orders"
        }
      },
      {
        "id": "close",
        "section": "close",
        "tool": "close_cash_session",
        "instruction": "Preparar diff contra lectura actual y esperar aprobación irreversible; no elegir override.",
        "depends_on": [
          "pending"
        ],
        "approval": "individual",
        "arguments": {
          "session_id": "${inputs.session_id}",
          "actual_closing_amount": "${inputs.actual_closing_amount}"
        }
      },
      {
        "id": "verify",
        "section": "verification",
        "tool": "call_endpoint",
        "instruction": "Leer sesión cerrada exacta y diferencia; active=null no demuestra qué sesión cerró.",
        "depends_on": [
          "close"
        ],
        "approval": "none",
        "arguments": {
          "path": "store/cash-registers/sessions/${inputs.session_id}"
        },
        "bridge": {
          "method": "GET",
          "path": "store/cash-registers/sessions/:id"
        }
      }
    ],
    "examples": [
      {
        "kind": "happy",
        "description": "Fixture sintético: Cerrar la sesión indicada con efectivo contado por la persona, revisar pendientes y demostrar cierre y diferencia. Evidencia de dominio, no datos de un comercio real.",
        "input": {
          "session_id": 900020,
          "actual_closing_amount": 105,
          "currency": "COP"
        },
        "observations": [
          {
            "step_id": "close",
            "tool": "close_cash_session",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "session_id": 900020
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "verify",
            "tool": "call_endpoint",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "session_id": 900020
            },
            "data": {
              "id": 900020,
              "status": "closed",
              "actual_closing_amount": 105,
              "expected_closing_amount": 100,
              "difference": 5
            },
            "after_step": "close",
            "bridge": {
              "method": "GET",
              "path": "store/cash-registers/sessions/900020"
            }
          }
        ],
        "expected": "verified"
      },
      {
        "kind": "sad",
        "description": "Falta conteo/moneda o cambia fingerprint: pedir exactamente ese dato o decisión y volver a preflight sin forzar cierre.",
        "input": {
          "session_id": 900020,
          "actual_closing_amount": 105,
          "currency": "COP"
        },
        "observations": [
          {
            "step_id": "close",
            "tool": "close_cash_session",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "session_id": 900020
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "verify",
            "tool": "call_endpoint",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "session_id": 900020
            },
            "data": {
              "id": 900020,
              "status": "closed",
              "actual_closing_amount": 999,
              "expected_closing_amount": 100,
              "difference": 5
            },
            "after_step": "close",
            "bridge": {
              "method": "GET",
              "path": "store/cash-registers/sessions/900020"
            }
          }
        ],
        "expected": "not_verified"
      }
    ],
    "gaps": []
  }
}
---
# cerrar-caja

## activation
Cerrar la sesión indicada con efectivo contado por la persona, revisar pendientes y demostrar cierre y diferencia.
Guía, no aprobación ni autoridad. Usar solo para este objetivo explícito.

## inputs
- `session_id` — obligatorio, resuelto desde lectura/recibo de dominio: ID de la sesión abierta del alcance actual.
- `actual_closing_amount` — obligatorio, confirmado por persona: Efectivo contado por la persona; cero es válido, nunca estimar.
- `currency` — obligatorio, confirmado por persona: Moneda y unidad de arqueo confirmadas.
- `pending_decision` — opcional/condicional, confirmado por persona: Solo decisión explícita resolved/override si hay pendientes.
- `override_reason` — opcional/condicional, confirmado por persona: Motivo confirmado para override.
Si falta un campo obligatorio pedir exactamente ese campo. Los IDs simbólicos del contrato se sustituyen solo con lecturas/recibos del alcance autenticado; los fixtures numéricos son sintéticos y nunca argumentos por defecto.

## setup
Resolver permisos actuales y tools/versiones del metadata, app/industria, scope operativo/fiscal relevante y estado actual. Nunca almacenar usuarios, tiendas, tokens ni IDs comerciales en este documento. Confirmar datos ambiguos y paginar hasta cobertura suficiente; datos truncados/históricos no son evidencia viva.
El campo real de tool es session_id y el conteo es actual_closing_amount. Diferencia = contado - esperado; una diferencia legítima no se corrige inventando movimientos. Revalidar si cambian sesión, pendientes o esperado.

## steps
Identificar la sesión indicada. Pedir efectivo contado y moneda; no estimar. Luego cargar movements y cash-preflight.

## approvals
Cada escritura exige preview de dominio actual y tarjeta individual del circuito propose→confirm→execute; el playbook no es consentimiento general, no emite tokens ni ejecuta handlers. Tras rechazo/no respuesta conservar estado pendiente. Nunca repetir un efecto desconocido ni un pago por un segundo seam.
Si algún write pierde preview/contrato vigente, degradar a preparación-only y registrar el gap, no aprobar a ciegas.

## recovery
Falta conteo/moneda o cambia fingerprint: pedir exactamente ese dato o decisión y volver a preflight sin forzar cierre.
Error recuperable no permite bucle infinito. Respuesta perdida: consultar mismo ID/recibo; unknown_effect queda detenido. Si el producto no soporta una capacidad explicar módulo/seam permitido y registrar gap sin improvisar reglas de stock o fiscales.

## verification
Consultar mismo ID con evidencia fresca/completa posterior al efecto. Verificador `cerrar-caja:v1`. Si falta postcondición, informar parcial; nunca éxito por prosa/receipt solo.

## alternative
Si tool, permiso, contrato, preview o verificador falta, presentar restricción concreta y el módulo del dominio correspondiente. No ampliar autoridad ni crear wrappers de negocio para cumplir el guion. Mantener IDs ya resueltos y pedir la decisión mínima necesaria para continuar.

## movements
Contrastar movimientos de la misma sesión.

## cash-preflight
Leer efectivo esperado sin reemplazar el conteo humano. Consultar pendientes/fingerprint actual; la persona decide resolver o excepción.

## close
Preparar diff contra lectura actual y esperar aprobación irreversible; no elegir override.
