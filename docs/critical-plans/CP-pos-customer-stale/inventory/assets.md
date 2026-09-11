# Reusable Assets

- `apps/frontend/src/app/private/modules/store/pos/services/pos-customer.service.ts` — resolveCustomer find-or-create ya existente; reutilizar, no duplicar.
- `apps/frontend/src/app/shared/components/document-identity-fields/document-identity-fields.component.ts` — control documento usado por el selector.
- `apps/frontend/src/app/shared/components/toast` — ToastService para feedback creado/encontrado ya cableado.
- `apps/backend/src/domains/store/customers/dto/resolve-customer.dto.ts` — prioridad email→documento→nombre ya probada.
- `apps/backend/src/common/services/response.service.ts` — envolvente success/data que el frontend ya desenvuelve.
- `skills/how-to-critical-plan/assets/cp-lint.sh` — validador del bundle.
- `skills/how-to-critical-plan/assets/cp-ledger.sh` — regenerador de ledger e índice.
- `skills/how-to-critical-plan/assets/cp-context.sh` — paquetes por actor para ejecución.
