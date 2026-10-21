---
{
  "name": "conciliar-banco",
  "description": "Cruzar automáticamente una conciliación bancaria abierta, explicar la diferencia entre extracto y libros antes de seguir y demostrar el saldo conciliado.",
  "metadata": {
    "version": "1.0.0",
    "owner": "vendix-domain-maintainers",
    "industry": [
      "all"
    ],
    "workflow_key": "conciliar-banco",
    "tool_contracts": [
      {
        "name": "list_reconciliations",
        "version": "1"
      },
      {
        "name": "get_account_ledger",
        "version": "1"
      },
      {
        "name": "auto_match_bank",
        "version": "1"
      }
    ],
    "required_permissions": [
      "store:accounting:bank_reconciliation:read",
      "store:accounting:bank_reconciliation:update",
      "store:accounting:reports:read"
    ],
    "verifier_ids": [
      "conciliar-banco:v1"
    ]
  },
  "vendix_contract": {
    "schema_version": "1",
    "mode": "executable",
    "inputs": [
      {
        "key": "bank_account_id",
        "description": "Cuenta bancaria real resuelta por lectura de conciliaciones.",
        "source": "lookup",
        "required": true
      },
      {
        "key": "reconciliation_id",
        "description": "Conciliación no completada de esa cuenta, resuelta por lectura.",
        "source": "lookup",
        "required": true
      },
      {
        "key": "account_code",
        "description": "Código PUC de la cuenta contable del banco, confirmado; nunca inventarlo.",
        "source": "user",
        "required": false
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
        "id": "list",
        "section": "steps",
        "tool": "list_reconciliations",
        "instruction": "Ubicar la conciliación abierta de la cuenta: saldo del extracto, saldo conciliado y diferencia.",
        "depends_on": [],
        "approval": "none",
        "arguments": {
          "bank_account_id": "${inputs.bank_account_id}"
        }
      },
      {
        "id": "ledger",
        "section": "discrepancy-preflight",
        "tool": "get_account_ledger",
        "instruction": "Si queda diferencia: leer el auxiliar del banco para hallar la causa.",
        "depends_on": [
          "list"
        ],
        "approval": "none",
        "arguments": {
          "account_code": "${inputs.account_code}"
        }
      },
      {
        "id": "match",
        "section": "match",
        "tool": "auto_match_bank",
        "instruction": "Proponer el cruce automático de la conciliación abierta; aprobación individual; nunca sobre una completada.",
        "depends_on": [
          "list"
        ],
        "approval": "individual",
        "arguments": {
          "reconciliation_id": "${inputs.reconciliation_id}"
        }
      },
      {
        "id": "verify",
        "section": "verification",
        "tool": "list_reconciliations",
        "instruction": "Releer las conciliaciones de la misma cuenta después del cruce.",
        "depends_on": [
          "match"
        ],
        "approval": "none",
        "arguments": {
          "bank_account_id": "${inputs.bank_account_id}"
        }
      }
    ],
    "examples": [
      {
        "kind": "happy",
        "description": "Fixture sintético: tras el cruce la conciliación de la cuenta queda con diferencia igual a extracto menos conciliado. Evidencia de dominio, no datos de un comercio real.",
        "input": {
          "bank_account_id": 900400,
          "reconciliation_id": 900401
        },
        "observations": [
          {
            "step_id": "match",
            "tool": "auto_match_bank",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "reconciliation_id": 900401
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "verify",
            "tool": "list_reconciliations",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "reconciliation_id": 900401
            },
            "arguments": {
              "bank_account_id": 900400
            },
            "data": [
              {
                "id": 900401,
                "bank_account_id": 900400,
                "status": "draft",
                "statement_balance": "1500.00",
                "reconciled_balance": "1488.00",
                "difference": "12.00",
                "_count": {
                  "matches": 4
                }
              }
            ],
            "after_step": "match"
          }
        ],
        "expected": "verified"
      },
      {
        "kind": "sad",
        "description": "La relectura devuelve otra cuenta y una diferencia que no corresponde a extracto menos conciliado: no declarar conciliado.",
        "input": {
          "bank_account_id": 900400,
          "reconciliation_id": 900401
        },
        "observations": [
          {
            "step_id": "match",
            "tool": "auto_match_bank",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "reconciliation_id": 900401
            },
            "data": {
              "synthetic_receipt": true
            }
          },
          {
            "step_id": "verify",
            "tool": "list_reconciliations",
            "status": "ok",
            "fresh": true,
            "complete": true,
            "resource_ids": {
              "reconciliation_id": 900401
            },
            "arguments": {
              "bank_account_id": 900400
            },
            "data": [
              {
                "id": 900401,
                "bank_account_id": 900499,
                "status": "draft",
                "statement_balance": "1500.00",
                "reconciled_balance": "1488.00",
                "difference": "0.00",
                "_count": {
                  "matches": 4
                }
              }
            ],
            "after_step": "match"
          }
        ],
        "expected": "not_verified"
      }
    ],
    "gaps": []
  }
}
---
# conciliar-banco

## activation
Cruzar automáticamente una conciliación bancaria abierta, explicar la diferencia entre extracto y libros antes de seguir y demostrar el saldo conciliado.
Guía, no aprobación ni autoridad. Usar solo por intención explícita. Crear la conciliación, importar el extracto, cruzar a mano o completarla se hace en el módulo de conciliación bancaria.

## inputs
- `bank_account_id` — obligatorio, resuelto desde lectura: Cuenta bancaria real.
- `reconciliation_id` — obligatorio, resuelto desde lectura: Conciliación no completada de esa cuenta.
- `account_code` — opcional/condicional, confirmado por persona: Código PUC de la cuenta del banco; nunca inventarlo.
- `discrepancy_reason` — opcional/condicional, confirmado por persona: Motivo de la diferencia; nunca inventarlo.
Si falta un campo obligatorio pedir exactamente ese campo. Los fixtures numéricos son sintéticos y nunca argumentos por defecto.

## setup
Resolver permisos actuales, tools/versiones del metadata y la cuenta bancaria. Nunca almacenar usuarios, tiendas, tokens ni IDs comerciales en este documento. Diferencia = saldo del extracto − saldo conciliado. No crear asientos de cuadre ni marcar movimientos como conciliados por prosa.

## steps
Ubicar la conciliación abierta de la cuenta. Proponer el cruce automático. Si después del cruce queda diferencia, cargar discrepancy-preflight antes de dar el proceso por cerrado.

## approvals
Cada escritura exige preview de dominio actual y tarjeta individual del circuito propose→confirm→execute; el playbook no es consentimiento general, no emite tokens ni ejecuta handlers. Tras rechazo/no respuesta conservar estado pendiente. Nunca repetir un efecto desconocido.
Si algún write pierde preview/contrato vigente, degradar a preparación-only y registrar el gap, no aprobar a ciegas.

## recovery
Conciliación completada, inexistente o de otra cuenta: pedir elegir otra abierta. Respuesta perdida: releer la conciliación antes de reintentar; unknown_effect queda detenido.

## verification
Releer las conciliaciones de la misma cuenta después del cruce con evidencia fresca y completa. Verificador `conciliar-banco:v1`: la conciliación existe, es de esa cuenta y su diferencia es extracto − conciliado. Diferencia distinta de cero es resultado válido del cruce, no éxito de conciliación: seguir discrepancy-preflight.

## alternative
Si tool, permiso, contrato, preview o verificador falta, presentar restricción concreta y remitir al módulo de conciliación bancaria. Completar la conciliación (solo con diferencia cero) y cruces manuales se hacen allí. No ampliar autoridad ni crear wrappers para cumplir el guion.

## discrepancy-preflight
Tolerancia: cero; solo se completa con diferencia cero. Si cuadra, no molestar: puede completarla en el módulo.
Si queda diferencia: explicar cifras sin jerga (extracto, conciliado, diferencia); preguntar si conoce el motivo; revisar el auxiliar del banco en el periodo y mostrar candidatos.
Causas: comisiones, intereses o GMF (4x1000) no registrados, transferencias de clientes sin aplicar, cheques en tránsito, pagos duplicados, fechas de corte distintas.
Guiar a registrar lo faltante con su flujo y aprobación (gasto bancario, abono de cliente), volver a cruzar y releer. Si insiste en seguir con la diferencia, respetarlo y anotar su motivo; nunca forzar el cuadre.

## match
Proponer el cruce automático de la conciliación abierta; aprobación individual; nunca sobre una completada.
