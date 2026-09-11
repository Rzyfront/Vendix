# Critical Files

- `apps/frontend/src/app/private/modules/store/pos/components/pos-customer-selector/pos-customer-selector.component.ts` — selector con el early-return en resolveIfNeeded:390-393.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-customer-selector/pos-customer-selector.component.html` — tabs search/create y formulario que el cajero diligencia para B.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-customer.service.ts` — resolveCustomer:97, searchCustomers:141, topCustomers:186, selectCustomer y mapeo a PosCustomer.
- `apps/frontend/src/app/private/modules/store/pos/models/customer.model.ts` — tipos PosCustomer y CreatePosCustomerRequest.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.ts` — host que llama resolveIfNeeded:1004 y reemite customerSelected:1656.
- `apps/frontend/src/app/private/modules/store/pos/cart/pos-cart.component.ts` — onCustomerSelected:1863 emite a cartService.setCustomer y al padre.
- `apps/frontend/src/app/private/modules/store/pos/pos.component.ts` — dueño de selectedCustomer:837, cartState:803, onCustomerSelected/setCustomer:1477-1514 y payloads customer_id:1786,1860,2709.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-customer-modal.component.ts` — modal alterno que emite customerSelected:787,1011.
- `apps/backend/src/domains/store/customers/customers.controller.ts` — POST /store/customers/resolve:59, GET search:82, lookup:100, top:119.
- `apps/backend/src/domains/store/customers/dto/resolve-customer.dto.ts` — match email→documento→nombre y creación condicional.
- `apps/backend/src/domains/store/payments/payments.controller.ts` — POST /store/payments/pos processPosPayment:283.
- `apps/backend/src/domains/store/payments/dto/create-pos-payment.dto.ts` — customer_id:235 y customer_alias:251 con XOR.
- `apps/backend/src/domains/store/payments/payments.service.ts` — processPosPayment:692, customer gate:757-833, persistencia customer_id:1583,1936,2198,2323.
- `apps/backend/src/domains/store/invoicing/invoicing.controller.ts` — POST from-order/:orderId:192 que hereda cliente de la orden.
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts` — createFromOrder propaga order.customer_id a la factura.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts` — confirmación que debe mostrar B antes de cobrar.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-ticket-printer.component.ts` — ticket que debe imprimir B.
