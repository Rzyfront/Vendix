---
{
  "name": "facturar-venta",
  "description": "Crear desde una orden, validar y emitir una factura con tres consentimientos individuales y verificar su estado fiscal real.",
  "metadata": {
    "version": "1.0.0",
    "owner": "vendix-domain-maintainers",
    "industry": [
      "all"
    ],
    "workflow_key": "facturar-venta",
    "tool_contracts": [
      {
        "name": "get_order",
        "version": "1"
      },
      {
        "name": "create_invoice_from_order",
        "version": "1"
      },
      {
        "name": "get_invoice_status",
        "version": "1"
      },
      {
        "name": "get_emit_readiness",
        "version": "1"
      },
      {
        "name": "validate_invoice",
        "version": "1"
      },
      {
        "name": "get_dian_status",
        "version": "1"
      },
      {
        "name": "list_invoice_resolutions",
        "version": "1"
      },
      {
        "name": "send_invoice_dian",
        "version": "1"
      }
    ],
    "required_permissions": [
      "invoicing:read",
      "invoicing:write",
      "store:orders:read"
    ],
    "verifier_ids": [
      "facturar-venta:v1"
    ]
  },
  "vendix_contract": {
    "schema_version": "1",
    "mode": "executable",
    "inputs": [
      {
        "key": "order_id",
        "description": "Orden identificada, nunca inferida.",
        "source": "lookup",
        "required": true
      },
      {
        "key": "invoice_id",
        "description": "ID obtenido de creación o lectura, conservar idempotencia.",
        "source": "lookup",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "order",
        "section": "steps",
        "tool": "get_order",
        "instruction": "Leer orden, cliente y snapshots fiscales.",
        "depends_on": [],
        "approval": "none",
        "arguments": {
          "order_id": "${inputs.order_id}"
        }
      },
      {
        "id": "create",
        "section": "steps",
        "tool": "create_invoice_from_order",
        "instruction": "Si no existe factura equivalente, proponer creación y esperar su aprobación.",
        "depends_on": [
          "order"
        ],
        "approval": "individual",
        "arguments": {
          "order_id": "${inputs.order_id}"
        }
      },
      {
        "id": "invoice",
        "section": "readiness",
        "tool": "get_invoice_status",
        "instruction": "Leer borrador por el invoice_id devuelto.",
        "depends_on": [
          "create"
        ],
        "approval": "none",
        "arguments": {
          "invoice_id": "${inputs.invoice_id}"
        }
      },
      {
        "id": "readiness",
        "section": "readiness",
        "tool": "get_emit_readiness",
        "instruction": "Resolver bloqueantes del documento, impuestos e identidad emisora.",
        "depends_on": [
          "invoice"
        ],
        "approval": "none",
        "arguments": {
          "invoice_id": "${inputs.invoice_id}"
        }
      },
      {
        "id": "validate",
        "section": "readiness",
        "tool": "validate_invoice",
        "instruction": "Proponer validación solo desde estado permitido; esperar aprobación propia.",
        "depends_on": [
          "readiness"
        ],
        "approval": "individual",
        "arguments": {
          "invoice_id": "${inputs.invoice_id}"
        }
      },
      {
        "id": "preflight",
        "section": "emission-preflight",
        "tool": "get_emit_readiness",
        "instruction": "Actualizar preflight después de validar y antes de emitir.",
        "depends_on": [
          "validate"
        ],
        "approval": "none",
        "arguments": {
          "invoice_id": "${inputs.invoice_id}"
        }
      },
      {
        "id": "dian",
        "section": "emission-preflight",
        "tool": "get_dian_status",
        "instruction": "Comprobar emisión en vivo e identidad fiscal permitida; no cambiar configuración.",
        "depends_on": [
          "preflight"
        ],
        "approval": "none",
        "arguments": {}
      },
      {
        "id": "resolution",
        "section": "emission-preflight",
        "tool": "list_invoice_resolutions",
        "instruction": "Comprobar resolución activa con saldo; no gastar consecutivo en lectura.",
        "depends_on": [
          "dian"
        ],
        "approval": "none",
        "arguments": {}
      },
      {
        "id": "emit",
        "section": "emission",
        "tool": "send_invoice_dian",
        "instruction": "Proponer emisión irreversible; aprobación específica y revalidación de dominio.",
        "depends_on": [
          "resolution"
        ],
        "approval": "individual",
        "arguments": {
          "invoice_id": "${inputs.invoice_id}"
        }
      },
      {
        "id": "order-verify",
        "section": "verification",
        "tool": "get_order",
        "instruction": "Vincular orden original con número/CUFE de factura aceptada; no verificar factura ajena.",
        "depends_on": [
          "emit"
        ],
        "approval": "none",
        "arguments": {
          "order_id": "${inputs.order_id}"
        }
      },
      {
        "id": "verify",
        "section": "verification",
        "tool": "get_invoice_status",
        "instruction": "Consultar mismo ID: sent no es accepted; reportar pendiente/rechazo sin afirmar aceptación.",
        "depends_on": [
          "order-verify"
        ],
        "approval": "none",
        "arguments": {
          "invoice_id": "${inputs.invoice_id}"
        }
      }
    ],
    "examples": [
      {
        "kind": "happy",
        "description": "Fixture sintético: Crear desde una orden, validar y emitir una factura con tres consentimientos individuales y verificar su estado fiscal real. Evidencia de dominio, no datos de un comercio real.",
        "input": {
          "order_id": 900010,
          "invoice_id": 900011
        },
        "observations": [
          {
            "step_id": "preflight",
            "tool": "get_emit_readiness",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "invoice_id": 900011,
              "emittable": true
            }
          },
          {
            "step_id": "create",
            "tool": "create_invoice_from_order",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "validate",
            "tool": "validate_invoice",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "emit",
            "tool": "send_invoice_dian",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "order-verify",
            "tool": "get_order",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "order_id": 900010
            },
            "data": {
              "orden": {
                "order_id": 900010
              },
              "factura_electronica": {
                "numero": "SYNTHETIC-FV",
                "cufe": "SYNTHETIC-CUFE"
              }
            },
            "after_step": "emit"
          },
          {
            "step_id": "verify",
            "tool": "get_invoice_status",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "invoice_id": 900011,
              "invoice_number": "SYNTHETIC-FV",
              "status": "accepted",
              "cufe": "SYNTHETIC-CUFE"
            },
            "after_step": "emit"
          }
        ],
        "expected": "verified"
      },
      {
        "kind": "sad",
        "description": "Preflight bloqueado o documento sent sin aceptación: conservar ID, explicar bloqueo/pendiente y no reenviar automáticamente.",
        "input": {
          "order_id": 900010,
          "invoice_id": 900011
        },
        "observations": [
          {
            "step_id": "preflight",
            "tool": "get_emit_readiness",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "invoice_id": 900011,
              "emittable": true
            }
          },
          {
            "step_id": "create",
            "tool": "create_invoice_from_order",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "validate",
            "tool": "validate_invoice",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "emit",
            "tool": "send_invoice_dian",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "order-verify",
            "tool": "get_order",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "order_id": 900010
            },
            "data": {
              "orden": {
                "order_id": 900010
              },
              "factura_electronica": {
                "numero": "SYNTHETIC-FV",
                "cufe": "SYNTHETIC-CUFE"
              }
            },
            "after_step": "emit"
          },
          {
            "step_id": "verify",
            "tool": "get_invoice_status",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "invoice_id": 900011,
              "order_id": 900010
            },
            "data": {
              "invoice_id": 900011,
              "invoice_number": "SYNTHETIC-FV",
              "status": "sent",
              "cufe": "SYNTHETIC-CUFE"
            },
            "after_step": "emit"
          }
        ],
        "expected": "not_verified"
      }
    ],
    "gaps": []
  }
}
---
# facturar-venta

## activation
Crear desde una orden, validar y emitir una factura con tres consentimientos individuales y verificar su estado fiscal real.
Guía, no aprobación ni autoridad. Usar solo para este objetivo explícito.

## inputs
- `order_id` — obligatorio, resuelto desde lectura/recibo de dominio: Orden identificada, nunca inferida.
- `invoice_id` — opcional/condicional, resuelto desde lectura/recibo de dominio: ID obtenido de creación o lectura, conservar idempotencia.
Si falta un campo obligatorio pedir exactamente ese campo. Los IDs simbólicos del contrato se sustituyen solo con lecturas/recibos del alcance autenticado; los fixtures numéricos son sintéticos y nunca argumentos por defecto.

## setup
Resolver permisos actuales y tools/versiones del metadata, app/industria, scope operativo/fiscal relevante y estado actual. Nunca almacenar usuarios, tiendas, tokens ni IDs comerciales en este documento. Confirmar datos ambiguos y paginar hasta cobertura suficiente; datos truncados/históricos no son evidencia viva.
No improvisar IVA/INC, identidad del emisor ni scope fiscal. Un documento aceptado exige nota crédito, nunca reenvío. Desconocido tras send bloquea repetición hasta consultar el mismo ID; accepted requiere CUFE y número.

## steps
Leer orden y proponer borrador si no existe. Tras aprobar cargar readiness; no emitir todavía.

## approvals
Cada escritura exige preview de dominio actual y tarjeta individual del circuito propose→confirm→execute; el playbook no es consentimiento general, no emite tokens ni ejecuta handlers. Tras rechazo/no respuesta conservar estado pendiente. Nunca repetir un efecto desconocido ni un pago por un segundo seam.
Si algún write pierde preview/contrato vigente, degradar a preparación-only y registrar el gap, no aprobar a ciegas.

## recovery
Preflight bloqueado o documento sent sin aceptación: conservar ID, explicar bloqueo/pendiente y no reenviar automáticamente.
Error recuperable no permite bucle infinito. Respuesta perdida: consultar mismo ID/recibo; unknown_effect queda detenido. Si el producto no soporta una capacidad explicar módulo/seam permitido y registrar gap sin improvisar reglas de stock o fiscales.

## verification
Consultar mismo ID con evidencia fresca/completa posterior al efecto. Verificador `facturar-venta:v1`. Si falta postcondición, informar parcial; nunca éxito por prosa/receipt solo.

## alternative
Si tool, permiso, contrato, preview o verificador falta, presentar restricción concreta y el módulo del dominio correspondiente. No ampliar autoridad ni crear wrappers de negocio para cumplir el guion. Mantener IDs ya resueltos y pedir la decisión mínima necesaria para continuar.

## readiness
Leer borrador por el invoice_id devuelto. Resolver bloqueantes del documento, impuestos e identidad emisora. Proponer validación solo desde estado permitido; esperar aprobación propia.

## emission-preflight
Actualizar preflight después de validar y antes de emitir. Comprobar emisión en vivo e identidad fiscal permitida; no cambiar configuración. Comprobar resolución activa con saldo; no gastar consecutivo en lectura.

## emission
Proponer emisión irreversible; aprobación específica y revalidación de dominio.
