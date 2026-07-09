export { PosHeader } from './pos-header';
export { PosScreenHeader } from './pos-screen-header';
export { PosSearchBar } from './pos-search-bar';
export { PosMobileFooter } from './pos-mobile-footer';
export { PosCartModal } from './pos-cart-modal';
export { PosFilterDropdown } from './pos-filter-dropdown';
export { PosAddModal } from './pos-add-modal';
export { PosCustomerModal } from './pos-customer-modal';
export { ShippingModal } from './shipping-modal';
export { PosCustomItemModal } from './pos-custom-item-modal';
export { PosPaymentModal } from './pos-payment-modal';
export { PosOrderCreateModal } from './pos-order-create-modal';
// Sub-PR #5: los 4 cash-register modals son stubs vacíos que permiten a
// pos/index.tsx compilar standalone. Sub-PR #6 (5d) los reemplazará con
// la implementación real (open/close/movement/detail de sesiones de caja).
export { PosCashOpenModal } from './pos-cash-open-modal';
export { PosCashCloseModal } from './pos-cash-close-modal';
export { PosCashMovementModal } from './pos-cash-movement-modal';
export { PosCashDetailModal } from './pos-cash-detail-modal';
export { CheckoutStepIndicator } from './checkout-step-indicator';
export type { CheckoutStep } from './checkout-step-indicator';