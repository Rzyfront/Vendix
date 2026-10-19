---
{
  "name": "reponer-inventario",
  "description": "Preparar una propuesta de reposición por existencias disponibles, reservas, bodega y proveedor sin comprar automáticamente.",
  "metadata": {
    "version": "1.0.0",
    "owner": "vendix-domain-maintainers",
    "industry": [
      "all"
    ],
    "workflow_key": "reponer-inventario",
    "tool_contracts": [
      {
        "name": "get_low_stock_alerts",
        "version": "1"
      },
      {
        "name": "get_stock_levels",
        "version": "1"
      },
      {
        "name": "get_sourcing_suggestion",
        "version": "1"
      },
      {
        "name": "find_supplier",
        "version": "1"
      }
    ],
    "required_permissions": [
      "store:inventory:stock_levels:read",
      "store:inventory:suppliers:read"
    ],
    "verifier_ids": [
      "reponer-inventario:v1"
    ]
  },
  "vendix_contract": {
    "schema_version": "1",
    "mode": "executable",
    "inputs": [
      {
        "key": "product_id",
        "description": "Producto real obtenido por búsqueda.",
        "source": "lookup",
        "required": true
      },
      {
        "key": "quantity",
        "description": "Unidades mínimas enteras solicitadas.",
        "source": "user",
        "required": true
      },
      {
        "key": "supplier_query",
        "description": "Proveedor preferido; pedir decisión si no hay coincidencia única.",
        "source": "user",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "alerts",
        "section": "steps",
        "tool": "get_low_stock_alerts",
        "instruction": "Leer alertas; no confundir espejo stock_quantity con disponibles.",
        "depends_on": [],
        "approval": "none",
        "arguments": {}
      },
      {
        "id": "stock",
        "section": "steps",
        "tool": "get_stock_levels",
        "instruction": "Consultar on_hand, reserved y available del producto y ubicación.",
        "depends_on": [
          "alerts"
        ],
        "approval": "none",
        "arguments": {
          "product_id": "${inputs.product_id}"
        }
      },
      {
        "id": "sourcing",
        "section": "sourcing",
        "tool": "get_sourcing_suggestion",
        "instruction": "Resolver surtido: available/transfer/purchase. Solo propuesta.",
        "depends_on": [
          "stock"
        ],
        "approval": "none",
        "arguments": {
          "product_id": "${inputs.product_id}",
          "quantity": "${inputs.quantity}"
        }
      },
      {
        "id": "supplier",
        "section": "supplier",
        "tool": "find_supplier",
        "instruction": "Solo si requiere compra: buscar proveedor indicado; cero o varios candidatos exige decisión específica.",
        "depends_on": [
          "sourcing"
        ],
        "approval": "none",
        "arguments": {
          "query": "${inputs.supplier_query}"
        }
      },
      {
        "id": "verify",
        "section": "verification",
        "tool": "get_sourcing_suggestion",
        "instruction": "Releer sourcing coherente con stock y conservar alternativa pendiente, no ejecutar OC.",
        "depends_on": [
          "supplier"
        ],
        "approval": "none",
        "arguments": {
          "product_id": "${inputs.product_id}",
          "quantity": "${inputs.quantity}"
        }
      }
    ],
    "examples": [
      {
        "kind": "happy",
        "description": "Fixture sintético: Preparar una propuesta de reposición por existencias disponibles, reservas, bodega y proveedor sin comprar automáticamente. Evidencia de dominio, no datos de un comercio real.",
        "input": {
          "product_id": 900001,
          "quantity": 10,
          "supplier_query": "Proveedor sintético"
        },
        "observations": [
          {
            "step_id": "stock",
            "tool": "get_stock_levels",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "data": [
                {
                  "product_id": 900001,
                  "on_hand": 8,
                  "reserved": 3,
                  "available": 5,
                  "reorder_point": 10
                }
              ]
            }
          },
          {
            "step_id": "supplier",
            "tool": "find_supplier",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "encontrados": 1,
              "total_coincidencias": 1,
              "hay_mas": false,
              "candidatos": [
                {
                  "supplier_id": 900002,
                  "name": "Proveedor sintético"
                }
              ]
            }
          },
          {
            "step_id": "verify",
            "tool": "get_sourcing_suggestion",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "sugerencia": "purchase",
              "cantidad_solicitada": 10,
              "bodega_principal": {
                "available": 5
              },
              "otras_bodegas": []
            },
            "arguments": {
              "product_id": 900001,
              "quantity": 10
            }
          }
        ],
        "expected": "verified"
      },
      {
        "kind": "sad",
        "description": "Proveedor no encontrado: preguntar cuál crear/elegir o si dejar la propuesta sin proveedor; no sustituirlo ni crear OC.",
        "input": {
          "product_id": 900001,
          "quantity": 10,
          "supplier_query": "Proveedor sintético"
        },
        "observations": [
          {
            "step_id": "stock",
            "tool": "get_stock_levels",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "data": [
                {
                  "product_id": 900001,
                  "on_hand": 8,
                  "reserved": 3,
                  "available": 5,
                  "reorder_point": 10
                }
              ]
            }
          },
          {
            "step_id": "supplier",
            "tool": "find_supplier",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "encontrados": 0,
              "candidatos": [],
              "hay_mas": false
            }
          },
          {
            "step_id": "verify",
            "tool": "get_sourcing_suggestion",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {},
            "data": {
              "sugerencia": "purchase",
              "cantidad_solicitada": 10,
              "bodega_principal": {
                "available": 5
              },
              "otras_bodegas": []
            },
            "arguments": {
              "product_id": 900001,
              "quantity": 10
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
# reponer-inventario

## activation
Preparar una propuesta de reposición por existencias disponibles, reservas, bodega y proveedor sin comprar automáticamente.
Guía, no aprobación ni autoridad. Usar solo para este objetivo explícito.

## inputs
- `product_id` — obligatorio, resuelto desde lectura/recibo de dominio: Producto real obtenido por búsqueda.
- `quantity` — obligatorio, confirmado por persona: Unidades mínimas enteras solicitadas.
- `supplier_query` — opcional/condicional, confirmado por persona: Proveedor preferido; pedir decisión si no hay coincidencia única.
Si falta un campo obligatorio pedir exactamente ese campo. Los IDs simbólicos del contrato se sustituyen solo con lecturas/recibos del alcance autenticado; los fixtures numéricos son sintéticos y nunca argumentos por defecto.

## setup
Resolver permisos actuales y tools/versiones del metadata, app/industria, scope operativo/fiscal relevante y estado actual. Nunca almacenar usuarios, tiendas, tokens ni IDs comerciales en este documento. Confirmar datos ambiguos y paginar hasta cobertura suficiente; datos truncados/históricos no son evidencia viva.
La propuesta distingue físico/reservado/disponible y no altera inventario. Si requiere compra, elegir proveedor con evidencia. La futura OC requiere otro proceso y su propia aprobación.

## steps
Leer alertas y disponibles. Luego cargar sourcing y supplier. No comprar automáticamente.

## approvals
Cada escritura exige preview de dominio actual y tarjeta individual del circuito propose→confirm→execute; el playbook no es consentimiento general, no emite tokens ni ejecuta handlers. Tras rechazo/no respuesta conservar estado pendiente. Nunca repetir un efecto desconocido ni un pago por un segundo seam.
Si algún write pierde preview/contrato vigente, degradar a preparación-only y registrar el gap, no aprobar a ciegas.

## recovery
Proveedor no encontrado: preguntar cuál crear/elegir o si dejar la propuesta sin proveedor; no sustituirlo ni crear OC.
Error recuperable no permite bucle infinito. Respuesta perdida: consultar mismo ID/recibo; unknown_effect queda detenido. Si el producto no soporta una capacidad explicar módulo/seam permitido y registrar gap sin improvisar reglas de stock o fiscales.

## verification
Consultar mismo ID con evidencia fresca/completa posterior al efecto. Verificador `reponer-inventario:v1`. Si falta postcondición, informar parcial; nunca éxito por prosa/receipt solo.

## alternative
Si tool, permiso, contrato, preview o verificador falta, presentar restricción concreta y el módulo del dominio correspondiente. No ampliar autoridad ni crear wrappers de negocio para cumplir el guion. Mantener IDs ya resueltos y pedir la decisión mínima necesaria para continuar.

## sourcing
Resolver surtido: available/transfer/purchase. Solo propuesta.

## supplier
Solo si requiere compra: buscar proveedor indicado; cero o varios candidatos exige decisión específica.
