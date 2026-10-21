---
{
  "name": "ajustar-inventario-conteo",
  "description": "Cuadrar las existencias de un producto en una bodega con el conteo físico de la persona, revisar antes la causa de la diferencia y demostrar la cantidad final.",
  "metadata": {
    "version": "1.0.0",
    "owner": "vendix-domain-maintainers",
    "industry": [
      "all"
    ],
    "workflow_key": "ajustar-inventario-conteo",
    "tool_contracts": [
      {
        "name": "find_product",
        "version": "1"
      },
      {
        "name": "get_stock_levels",
        "version": "1"
      },
      {
        "name": "get_stock_movements",
        "version": "1"
      },
      {
        "name": "adjust_stock",
        "version": "1"
      }
    ],
    "required_permissions": [
      "store:inventory:adjustments:create",
      "store:inventory:movements:read",
      "store:inventory:stock_levels:read",
      "store:products:read"
    ],
    "verifier_ids": [
      "ajustar-inventario-conteo:v1"
    ]
  },
  "vendix_contract": {
    "schema_version": "1",
    "mode": "executable",
    "inputs": [
      {
        "key": "product_query",
        "description": "Nombre, SKU o código del producto tal como lo dijo la persona.",
        "source": "user",
        "required": true
      },
      {
        "key": "product_id",
        "description": "Producto real resuelto por búsqueda; varias coincidencias exigen elegir.",
        "source": "lookup",
        "required": true
      },
      {
        "key": "location_id",
        "description": "Bodega donde se contó, resuelta por lectura.",
        "source": "lookup",
        "required": true
      },
      {
        "key": "product_variant_id",
        "description": "Variante contada cuando el producto maneja variantes.",
        "source": "lookup",
        "required": false
      },
      {
        "key": "quantity_after",
        "description": "Unidades contadas físicamente; cero es válido, nunca estimar ni pasar la diferencia.",
        "source": "user",
        "required": true
      },
      {
        "key": "discrepancy_reason",
        "description": "Motivo de la diferencia en palabras de la persona; nunca inventarlo.",
        "source": "user",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "find",
        "section": "steps",
        "tool": "find_product",
        "instruction": "Resolver el producto y su variante; con varias coincidencias preguntar cuál.",
        "depends_on": [],
        "approval": "none",
        "arguments": {
          "query": "${inputs.product_query}"
        }
      },
      {
        "id": "stock",
        "section": "steps",
        "tool": "get_stock_levels",
        "instruction": "Leer existencias del sistema en la bodega contada.",
        "depends_on": [
          "find"
        ],
        "approval": "none",
        "arguments": {
          "product_id": "${inputs.product_id}",
          "location_id": "${inputs.location_id}"
        }
      },
      {
        "id": "movements",
        "section": "discrepancy-preflight",
        "tool": "get_stock_movements",
        "instruction": "Si no cuadra: leer movimientos recientes para hallar la causa.",
        "depends_on": [
          "stock"
        ],
        "approval": "none",
        "arguments": {
          "product_id": "${inputs.product_id}"
        }
      },
      {
        "id": "adjust",
        "section": "adjust",
        "tool": "adjust_stock",
        "instruction": "Proponer la cantidad final contada como diferencia de conteo; aprobación individual; con diferencia revisada enviar el motivo de la persona.",
        "depends_on": [
          "stock"
        ],
        "approval": "individual",
        "arguments": {
          "product_id": "${inputs.product_id}",
          "location_id": "${inputs.location_id}",
          "product_variant_id": "${inputs.product_variant_id}",
          "quantity_after": "${inputs.quantity_after}",
          "adjustment_type": "count_variance"
        }
      },
      {
        "id": "verify",
        "section": "verification",
        "tool": "get_stock_levels",
        "instruction": "Releer la misma bodega y producto después del ajuste.",
        "depends_on": [
          "adjust"
        ],
        "approval": "none",
        "arguments": {
          "product_id": "${inputs.product_id}",
          "location_id": "${inputs.location_id}"
        }
      }
    ],
    "examples": [
      {
        "kind": "happy",
        "description": "Fixture sintético: el conteo físico queda registrado y la relectura de la bodega muestra exactamente la cantidad contada. Evidencia de dominio, no datos de un comercio real.",
        "input": {
          "product_query": "Café sintético 500 g",
          "product_id": 900300,
          "location_id": 900301,
          "quantity_after": 7,
          "discrepancy_reason": "Dos unidades se usaron en degustación sin registrar"
        },
        "observations": [
          {
            "step_id": "adjust",
            "tool": "adjust_stock",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "product_id": 900300
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "verify",
            "tool": "get_stock_levels",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "product_id": 900300
            },
            "arguments": {
              "product_id": 900300,
              "location_id": 900301
            },
            "data": {
              "data": [
                {
                  "product_id": 900300,
                  "on_hand": 7,
                  "reserved": 2,
                  "available": 5
                }
              ]
            },
            "after_step": "adjust"
          }
        ],
        "expected": "verified"
      },
      {
        "kind": "sad",
        "description": "Entre el conteo y la relectura se vendió una unidad: la bodega no muestra la cantidad contada; no declarar cuadrado, releer y preguntar.",
        "input": {
          "product_query": "Café sintético 500 g",
          "product_id": 900300,
          "location_id": 900301,
          "quantity_after": 7
        },
        "observations": [
          {
            "step_id": "adjust",
            "tool": "adjust_stock",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "product_id": 900300
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "verify",
            "tool": "get_stock_levels",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "product_id": 900300
            },
            "arguments": {
              "product_id": 900300,
              "location_id": 900301
            },
            "data": {
              "data": [
                {
                  "product_id": 900300,
                  "on_hand": 6,
                  "reserved": 2,
                  "available": 4
                }
              ]
            },
            "after_step": "adjust"
          }
        ],
        "expected": "not_verified"
      }
    ],
    "gaps": []
  }
}
---
# ajustar-inventario-conteo

## activation
Cuadrar las existencias de un producto en una bodega con el conteo físico de la persona, revisar antes la causa de la diferencia y demostrar la cantidad final.
Guía, no aprobación ni autoridad. Usar solo para un conteo o corrección explícita; no para entrada de mercancía nueva (eso es compra o recepción) ni para traslados.

## inputs
- `product_query` — obligatorio, confirmado por persona: Nombre, SKU o código del producto.
- `product_id` — obligatorio, resuelto desde lectura: Producto real; varias coincidencias exigen elegir.
- `location_id` — obligatorio, resuelto desde lectura: Bodega donde se contó.
- `product_variant_id` — opcional/condicional, resuelto desde lectura: Variante contada si el producto maneja variantes.
- `quantity_after` — obligatorio, confirmado por persona: Unidades contadas; cero es válido, nunca estimar ni pasar la diferencia.
- `discrepancy_reason` — opcional/condicional, confirmado por persona: Motivo de la diferencia; nunca inventarlo.
Si falta un campo obligatorio pedir exactamente ese campo. Los fixtures numéricos son sintéticos y nunca argumentos por defecto.

## setup
Resolver permisos actuales, tools/versiones del metadata y bodega. Nunca almacenar usuarios, tiendas, tokens ni IDs comerciales en este documento. El ajuste recibe la cantidad FINAL contada, no la diferencia; deja traza, recalcula costo y genera asiento. No editar el producto para corregir existencias.

## steps
Resolver producto, variante y bodega. Pedir la cantidad contada; no estimar. Leer existencias del sistema y comparar con el conteo. Si difieren, cargar discrepancy-preflight antes de adjust.

## approvals
Cada escritura exige preview de dominio actual y tarjeta individual del circuito propose→confirm→execute; el playbook no es consentimiento general, no emite tokens ni ejecuta handlers. Tras rechazo/no respuesta conservar estado pendiente. Nunca repetir un efecto desconocido.
Si algún write pierde preview/contrato vigente, degradar a preparación-only y registrar el gap, no aprobar a ciegas.

## recovery
Producto ambiguo, variante o bodega sin resolver: pedir exactamente esa elección. Existencias cambiaron entre conteo y propuesta: releer y confirmar el conteo de nuevo. Respuesta perdida: releer existencias antes de reintentar; unknown_effect queda detenido.

## verification
Releer la misma bodega y producto después del ajuste con evidencia fresca y completa. Verificador `ajustar-inventario-conteo:v1`: una sola fila de esa bodega y producto con existencias iguales al conteo. Un producto con varias variantes en la misma bodega no se distingue en esa lectura: informar parcial, no éxito.

## alternative
Si tool, permiso, contrato, preview o verificador falta, presentar restricción concreta y remitir al módulo de inventario (ajustes). No ampliar autoridad ni crear wrappers para cumplir el guion. Mantener IDs ya resueltos y pedir la decisión mínima necesaria.

## discrepancy-preflight
Diferencia = conteo − sistema en esa bodega. Tolerancia: cero. Si cuadra, no hay ajuste: decirlo sin molestar.
Si difiere, antes de proponer: explicar cifras sin regañar, preguntar si conoce el motivo, revisar movimientos recientes y mostrar candidatos. Luego cargar discrepancy-causes.

## adjust
Proponer la cantidad final contada como diferencia de conteo; aprobación individual; con diferencia revisada enviar el motivo de la persona.

## discrepancy-causes
Causas típicas de inventario: ventas o despachos sin registrar, traslados sin registrar, compras o recepciones sin registrar, devoluciones, conteo en otra variante, bodega o presentación, averías o consumo interno, reservas.
Guiar a registrar lo faltante con su propio flujo y aprobación, y releer existencias. Luego proponer el ajuste con `discrepancy_reviewed`=true y `discrepancy_reason` en palabras de la persona. Si insiste en ajustar ya, respetarlo y registrar su motivo o que siguió sin conocerlo. Avería, pérdida, robo o vencimiento usan su propio tipo de ajuste.
