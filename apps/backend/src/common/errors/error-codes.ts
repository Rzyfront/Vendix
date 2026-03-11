export interface ErrorCodeEntry {
  code: string;
  httpStatus: number;
  devMessage: string;
}

export const ErrorCodes = {
  // System
  SYS_INTERNAL_001: {
    code: 'SYS_INTERNAL_001',
    httpStatus: 500,
    devMessage: 'Unexpected internal error',
  },
  SYS_VALIDATION_001: {
    code: 'SYS_VALIDATION_001',
    httpStatus: 422,
    devMessage: 'DTO validation failed',
  },
  SYS_NOT_FOUND_001: {
    code: 'SYS_NOT_FOUND_001',
    httpStatus: 404,
    devMessage: 'Resource not found',
  },
  SYS_FORBIDDEN_001: {
    code: 'SYS_FORBIDDEN_001',
    httpStatus: 403,
    devMessage: 'Access denied',
  },
  SYS_UNAUTHORIZED_001: {
    code: 'SYS_UNAUTHORIZED_001',
    httpStatus: 401,
    devMessage: 'Authentication required',
  },
  SYS_CONFLICT_001: {
    code: 'SYS_CONFLICT_001',
    httpStatus: 409,
    devMessage: 'Resource conflict',
  },

  // Payments
  PAY_INVALID_ORDER_001: {
    code: 'PAY_INVALID_ORDER_001',
    httpStatus: 400,
    devMessage: 'Invalid or non-existent order',
  },
  PAY_INVALID_AMOUNT_001: {
    code: 'PAY_INVALID_AMOUNT_001',
    httpStatus: 400,
    devMessage: 'Invalid payment amount',
  },
  PAY_METHOD_DISABLED_001: {
    code: 'PAY_METHOD_DISABLED_001',
    httpStatus: 400,
    devMessage: 'Payment method disabled',
  },
  PAY_PROCESSOR_001: {
    code: 'PAY_PROCESSOR_001',
    httpStatus: 502,
    devMessage: 'Payment processor error',
  },
  PAY_DUPLICATE_001: {
    code: 'PAY_DUPLICATE_001',
    httpStatus: 409,
    devMessage: 'Duplicate payment',
  },
  PAY_FIND_001: {
    code: 'PAY_FIND_001',
    httpStatus: 404,
    devMessage: 'Payment not found',
  },
  PAY_VALIDATE_001: {
    code: 'PAY_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Payment validation failed',
  },
  PAY_PERM_001: {
    code: 'PAY_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to payment resource',
  },

  // Authentication
  AUTH_FIND_001: {
    code: 'AUTH_FIND_001',
    httpStatus: 404,
    devMessage: 'User not found',
  },
  AUTH_CREATE_001: {
    code: 'AUTH_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating user',
  },
  AUTH_VALIDATE_001: {
    code: 'AUTH_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Authentication validation failed',
  },
  AUTH_DUP_001: {
    code: 'AUTH_DUP_001',
    httpStatus: 409,
    devMessage: 'User already exists',
  },
  AUTH_PERM_001: {
    code: 'AUTH_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied',
  },
  AUTH_TOKEN_001: {
    code: 'AUTH_TOKEN_001',
    httpStatus: 401,
    devMessage: 'Invalid or expired token',
  },
  AUTH_CREDENTIALS_001: {
    code: 'AUTH_CREDENTIALS_001',
    httpStatus: 401,
    devMessage: 'Invalid credentials',
  },
  AUTH_PASSWORD_001: {
    code: 'AUTH_PASSWORD_001',
    httpStatus: 400,
    devMessage: 'Invalid password',
  },
  AUTH_ROLE_001: {
    code: 'AUTH_ROLE_001',
    httpStatus: 404,
    devMessage: 'Role not found',
  },
  AUTH_STORE_001: {
    code: 'AUTH_STORE_001',
    httpStatus: 404,
    devMessage: 'Store not found',
  },
  AUTH_VERIFY_001: {
    code: 'AUTH_VERIFY_001',
    httpStatus: 400,
    devMessage: 'Email verification failed',
  },
  AUTH_CONTEXT_001: {
    code: 'AUTH_CONTEXT_001',
    httpStatus: 400,
    devMessage: 'Context required',
  },

  // Ecommerce
  ECOM_CART_001: {
    code: 'ECOM_CART_001',
    httpStatus: 400,
    devMessage: 'Cart is empty',
  },
  ECOM_CART_002: {
    code: 'ECOM_CART_002',
    httpStatus: 400,
    devMessage: 'Invalid cart item',
  },
  ECOM_CART_003: {
    code: 'ECOM_CART_003',
    httpStatus: 400,
    devMessage: 'Insufficient stock',
  },
  ECOM_CART_004: {
    code: 'ECOM_CART_004',
    httpStatus: 404,
    devMessage: 'Cart not found',
  },
  ECOM_PRODUCT_001: {
    code: 'ECOM_PRODUCT_001',
    httpStatus: 404,
    devMessage: 'Product not found',
  },
  ECOM_PRODUCT_002: {
    code: 'ECOM_PRODUCT_002',
    httpStatus: 400,
    devMessage: 'Product not available',
  },
  ECOM_CHECKOUT_001: {
    code: 'ECOM_CHECKOUT_001',
    httpStatus: 400,
    devMessage: 'Checkout validation failed',
  },
  ECOM_CHECKOUT_002: {
    code: 'ECOM_CHECKOUT_002',
    httpStatus: 400,
    devMessage: 'Invalid payment method',
  },
  ECOM_CHECKOUT_003: {
    code: 'ECOM_CHECKOUT_003',
    httpStatus: 400,
    devMessage: 'Invalid shipping method',
  },
  ECOM_ACCOUNT_001: {
    code: 'ECOM_ACCOUNT_001',
    httpStatus: 404,
    devMessage: 'Account not found',
  },
  ECOM_ACCOUNT_002: {
    code: 'ECOM_ACCOUNT_002',
    httpStatus: 400,
    devMessage: 'Invalid password',
  },
  ECOM_WISHLIST_001: {
    code: 'ECOM_WISHLIST_001',
    httpStatus: 404,
    devMessage: 'Wishlist not found',
  },
  ECOM_WISHLIST_002: {
    code: 'ECOM_WISHLIST_002',
    httpStatus: 404,
    devMessage: 'Item not in wishlist',
  },

  // Support
  SUP_TICKET_001: {
    code: 'SUP_TICKET_001',
    httpStatus: 404,
    devMessage: 'Ticket not found',
  },
  SUP_COMMENT_001: {
    code: 'SUP_COMMENT_001',
    httpStatus: 404,
    devMessage: 'Comment not found',
  },
  SUP_ORG_001: {
    code: 'SUP_ORG_001',
    httpStatus: 404,
    devMessage: 'Organization not found',
  },
  SUP_USER_001: {
    code: 'SUP_USER_001',
    httpStatus: 404,
    devMessage: 'User not found',
  },

  // Organization
  ORG_FIND_001: {
    code: 'ORG_FIND_001',
    httpStatus: 404,
    devMessage: 'Organization not found',
  },
  ORG_CREATE_001: {
    code: 'ORG_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating organization',
  },
  ORG_VALIDATE_001: {
    code: 'ORG_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Organization validation failed',
  },
  ORG_PERM_001: {
    code: 'ORG_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to organization',
  },
  ORG_CONTEXT_001: {
    code: 'ORG_CONTEXT_001',
    httpStatus: 400,
    devMessage: 'Organization context required',
  },
  ORG_USER_001: {
    code: 'ORG_USER_001',
    httpStatus: 404,
    devMessage: 'Organization user not found',
  },
  ORG_STORE_001: {
    code: 'ORG_STORE_001',
    httpStatus: 404,
    devMessage: 'Store not found',
  },
  ORG_ROLE_001: {
    code: 'ORG_ROLE_001',
    httpStatus: 404,
    devMessage: 'Role not found',
  },
  ORG_DOMAIN_001: {
    code: 'ORG_DOMAIN_001',
    httpStatus: 404,
    devMessage: 'Domain not found',
  },
  ORG_DOMAIN_002: {
    code: 'ORG_DOMAIN_002',
    httpStatus: 400,
    devMessage: 'Invalid domain',
  },

  // Store
  STORE_FIND_001: {
    code: 'STORE_FIND_001',
    httpStatus: 404,
    devMessage: 'Store not found',
  },
  STORE_CREATE_001: {
    code: 'STORE_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating store',
  },
  STORE_VALIDATE_001: {
    code: 'STORE_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Store validation failed',
  },
  STORE_PERM_001: {
    code: 'STORE_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to store',
  },
  STORE_CONTEXT_001: {
    code: 'STORE_CONTEXT_001',
    httpStatus: 400,
    devMessage: 'Store context required',
  },

  // Products
  PROD_FIND_001: {
    code: 'PROD_FIND_001',
    httpStatus: 404,
    devMessage: 'Product not found',
  },
  PROD_CREATE_001: {
    code: 'PROD_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating product',
  },
  PROD_VALIDATE_001: {
    code: 'PROD_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Product validation failed',
  },
  PROD_PERM_001: {
    code: 'PROD_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to product',
  },
  PROD_DUP_001: {
    code: 'PROD_DUP_001',
    httpStatus: 409,
    devMessage: 'Product already exists',
  },
  PROD_IMAGE_001: {
    code: 'PROD_IMAGE_001',
    httpStatus: 404,
    devMessage: 'Image not found',
  },
  PROD_CAT_001: {
    code: 'PROD_CAT_001',
    httpStatus: 400,
    devMessage: 'Invalid category or brand',
  },

  // Orders
  ORD_FIND_001: {
    code: 'ORD_FIND_001',
    httpStatus: 404,
    devMessage: 'Order not found',
  },
  ORD_CREATE_001: {
    code: 'ORD_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating order',
  },
  ORD_VALIDATE_001: {
    code: 'ORD_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Order validation failed',
  },
  ORD_PERM_001: {
    code: 'ORD_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to order',
  },
  ORD_STATUS_001: {
    code: 'ORD_STATUS_001',
    httpStatus: 400,
    devMessage: 'Invalid order status',
  },
  ORD_SHIP_001: {
    code: 'ORD_SHIP_001',
    httpStatus: 404,
    devMessage: 'Shipping method not found',
  },

  // Inventory
  INV_FIND_001: {
    code: 'INV_FIND_001',
    httpStatus: 404,
    devMessage: 'Inventory item not found',
  },
  INV_CREATE_001: {
    code: 'INV_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating inventory record',
  },
  INV_VALIDATE_001: {
    code: 'INV_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Inventory validation failed',
  },
  INV_PERM_001: {
    code: 'INV_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to inventory',
  },
  INV_CONTEXT_001: {
    code: 'INV_CONTEXT_001',
    httpStatus: 400,
    devMessage: 'Organization context required',
  },
  INV_STOCK_001: {
    code: 'INV_STOCK_001',
    httpStatus: 400,
    devMessage: 'Insufficient stock',
  },
  INV_LOC_001: {
    code: 'INV_LOC_001',
    httpStatus: 404,
    devMessage: 'Location not found',
  },
  INV_ADJ_001: {
    code: 'INV_ADJ_001',
    httpStatus: 404,
    devMessage: 'Adjustment not found',
  },

  // Customers
  CUST_FIND_001: {
    code: 'CUST_FIND_001',
    httpStatus: 404,
    devMessage: 'Customer not found',
  },
  CUST_CREATE_001: {
    code: 'CUST_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating customer',
  },
  CUST_VALIDATE_001: {
    code: 'CUST_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Customer validation failed',
  },
  CUST_PERM_001: {
    code: 'CUST_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to customer',
  },

  // Shipping
  SHIP_FIND_001: {
    code: 'SHIP_FIND_001',
    httpStatus: 404,
    devMessage: 'Shipping method not found',
  },
  SHIP_CREATE_001: {
    code: 'SHIP_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating shipping method',
  },
  SHIP_VALIDATE_001: {
    code: 'SHIP_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Shipping validation failed',
  },
  SHIP_PERM_001: {
    code: 'SHIP_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to shipping',
  },

  // Categories & Brands
  CAT_FIND_001: {
    code: 'CAT_FIND_001',
    httpStatus: 404,
    devMessage: 'Category not found',
  },
  BRAND_FIND_001: {
    code: 'BRAND_FIND_001',
    httpStatus: 404,
    devMessage: 'Brand not found',
  },

  // Refunds
  REF_FIND_001: {
    code: 'REF_FIND_001',
    httpStatus: 404,
    devMessage: 'Refund not found',
  },
  REF_CREATE_001: {
    code: 'REF_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating refund',
  },
  REF_VALIDATE_001: {
    code: 'REF_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Refund validation failed',
  },

  // Superadmin
  SUP_ADMIN_USER_001: {
    code: 'SUP_ADMIN_USER_001',
    httpStatus: 404,
    devMessage: 'Superadmin user not found',
  },
  SUP_ADMIN_ORG_001: {
    code: 'SUP_ADMIN_ORG_001',
    httpStatus: 404,
    devMessage: 'Superadmin organization not found',
  },
  SUP_ADMIN_ROLE_001: {
    code: 'SUP_ADMIN_ROLE_001',
    httpStatus: 404,
    devMessage: 'Superadmin role not found',
  },
  SUP_ADMIN_PERM_001: {
    code: 'SUP_ADMIN_PERM_001',
    httpStatus: 403,
    devMessage: 'Superadmin permission denied',
  },

  // AI Engine
  AI_CONFIG_001: {
    code: 'AI_CONFIG_001',
    httpStatus: 404,
    devMessage: 'AI configuration not found',
  },
  AI_PROVIDER_001: {
    code: 'AI_PROVIDER_001',
    httpStatus: 502,
    devMessage: 'AI provider connection failed',
  },
  AI_PROVIDER_002: {
    code: 'AI_PROVIDER_002',
    httpStatus: 400,
    devMessage: 'No default AI provider configured',
  },
  AI_REQUEST_001: {
    code: 'AI_REQUEST_001',
    httpStatus: 500,
    devMessage: 'AI provider request failed',
  },
  AI_CONFIG_002: {
    code: 'AI_CONFIG_002',
    httpStatus: 409,
    devMessage: 'AI configuration already exists (duplicate provider+model)',
  },
  AI_APP_001: {
    code: 'AI_APP_001',
    httpStatus: 404,
    devMessage: 'AI application not found',
  },
  AI_APP_002: {
    code: 'AI_APP_002',
    httpStatus: 409,
    devMessage: 'AI application key already exists',
  },
  AI_APP_003: {
    code: 'AI_APP_003',
    httpStatus: 400,
    devMessage: 'AI application is disabled',
  },
  AI_APP_004: {
    code: 'AI_APP_004',
    httpStatus: 429,
    devMessage: 'AI application rate limit exceeded',
  },

  // Invoicing
  INVOICING_FIND_001: {
    code: 'INVOICING_FIND_001',
    httpStatus: 404,
    devMessage: 'Invoice not found',
  },
  INVOICING_FIND_002: {
    code: 'INVOICING_FIND_002',
    httpStatus: 404,
    devMessage: 'Invoice resolution not found',
  },
  INVOICING_FIND_003: {
    code: 'INVOICING_FIND_003',
    httpStatus: 404,
    devMessage: 'Order not found',
  },
  INVOICING_FIND_004: {
    code: 'INVOICING_FIND_004',
    httpStatus: 404,
    devMessage: 'Sales order not found',
  },
  INVOICING_CREATE_001: {
    code: 'INVOICING_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating invoice',
  },
  INVOICING_VALIDATE_001: {
    code: 'INVOICING_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Invoice validation failed',
  },
  INVOICING_STATUS_001: {
    code: 'INVOICING_STATUS_001',
    httpStatus: 400,
    devMessage: 'Invalid invoice state transition',
  },
  INVOICING_STATUS_002: {
    code: 'INVOICING_STATUS_002',
    httpStatus: 400,
    devMessage: 'Cannot modify invoice in current state',
  },
  INVOICING_RESOLUTION_001: {
    code: 'INVOICING_RESOLUTION_001',
    httpStatus: 400,
    devMessage: 'No active resolution available for invoice numbering',
  },
  INVOICING_RESOLUTION_002: {
    code: 'INVOICING_RESOLUTION_002',
    httpStatus: 400,
    devMessage: 'Resolution range exhausted',
  },
  INVOICING_DUP_001: {
    code: 'INVOICING_DUP_001',
    httpStatus: 409,
    devMessage: 'Duplicate invoice number',
  },
  INVOICING_PROVIDER_001: {
    code: 'INVOICING_PROVIDER_001',
    httpStatus: 502,
    devMessage: 'Invoice provider communication error',
  },

  // Payroll
  PAYROLL_FIND_001: {
    code: 'PAYROLL_FIND_001',
    httpStatus: 404,
    devMessage: 'Employee not found',
  },
  PAYROLL_FIND_002: {
    code: 'PAYROLL_FIND_002',
    httpStatus: 404,
    devMessage: 'Payroll run not found',
  },
  PAYROLL_FIND_003: {
    code: 'PAYROLL_FIND_003',
    httpStatus: 404,
    devMessage: 'Payroll item not found',
  },
  PAYROLL_CREATE_001: {
    code: 'PAYROLL_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating employee',
  },
  PAYROLL_CREATE_002: {
    code: 'PAYROLL_CREATE_002',
    httpStatus: 400,
    devMessage: 'Error creating payroll run',
  },
  PAYROLL_DUP_001: {
    code: 'PAYROLL_DUP_001',
    httpStatus: 409,
    devMessage: 'Employee code already exists',
  },
  PAYROLL_DUP_002: {
    code: 'PAYROLL_DUP_002',
    httpStatus: 409,
    devMessage: 'Employee document already exists',
  },
  PAYROLL_DUP_003: {
    code: 'PAYROLL_DUP_003',
    httpStatus: 409,
    devMessage: 'Payroll number already exists',
  },
  PAYROLL_VALIDATE_001: {
    code: 'PAYROLL_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Payroll validation failed',
  },
  PAYROLL_STATUS_001: {
    code: 'PAYROLL_STATUS_001',
    httpStatus: 409,
    devMessage: 'Invalid payroll status transition',
  },
  PAYROLL_CALC_001: {
    code: 'PAYROLL_CALC_001',
    httpStatus: 400,
    devMessage: 'Payroll calculation failed - no active employees found',
  },
  PAYROLL_PROVIDER_001: {
    code: 'PAYROLL_PROVIDER_001',
    httpStatus: 502,
    devMessage: 'Payroll provider error',
  },
  PAYROLL_PERM_001: {
    code: 'PAYROLL_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to payroll resource',
  },

  // Accounting
  ACC_FIND_001: {
    code: 'ACC_FIND_001',
    httpStatus: 404,
    devMessage: 'Account not found',
  },
  ACC_FIND_002: {
    code: 'ACC_FIND_002',
    httpStatus: 404,
    devMessage: 'Journal entry not found',
  },
  ACC_FIND_003: {
    code: 'ACC_FIND_003',
    httpStatus: 404,
    devMessage: 'Fiscal period not found',
  },
  ACC_VALIDATE_001: {
    code: 'ACC_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Accounting validation failed',
  },
  ACC_VALIDATE_002: {
    code: 'ACC_VALIDATE_002',
    httpStatus: 400,
    devMessage: 'Invalid date range',
  },
  ACC_CONFLICT_001: {
    code: 'ACC_CONFLICT_001',
    httpStatus: 409,
    devMessage: 'Accounting resource conflict',
  },
  ACC_PERM_001: {
    code: 'ACC_PERM_001',
    httpStatus: 403,
    devMessage: 'Access denied to accounting resource',
  },
  // DIAN Electronic Invoicing
  DIAN_CONFIG_001: {
    code: 'DIAN_CONFIG_001',
    httpStatus: 404,
    devMessage: 'DIAN configuration not found for this store',
  },
  DIAN_CONFIG_002: {
    code: 'DIAN_CONFIG_002',
    httpStatus: 409,
    devMessage: 'DIAN configuration already exists for this store',
  },
  DIAN_CERT_001: {
    code: 'DIAN_CERT_001',
    httpStatus: 400,
    devMessage: 'Invalid certificate file',
  },
  DIAN_CERT_002: {
    code: 'DIAN_CERT_002',
    httpStatus: 400,
    devMessage: 'Invalid certificate password',
  },
  DIAN_CERT_003: {
    code: 'DIAN_CERT_003',
    httpStatus: 400,
    devMessage: 'Certificate expired',
  },
  DIAN_CONN_001: {
    code: 'DIAN_CONN_001',
    httpStatus: 502,
    devMessage: 'DIAN connection test failed',
  },
  DIAN_SEND_001: {
    code: 'DIAN_SEND_001',
    httpStatus: 422,
    devMessage: 'DIAN rejected the document',
  },
  DIAN_SEND_002: {
    code: 'DIAN_SEND_002',
    httpStatus: 504,
    devMessage: 'DIAN request timed out',
  },
} as const satisfies Record<string, ErrorCodeEntry>;

export type ErrorCodeKey = keyof typeof ErrorCodes;
