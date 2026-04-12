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
    devMessage: 'Producto no encontrado',
  },
  PROD_CREATE_001: {
    code: 'PROD_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error al crear el producto',
  },
  PROD_VALIDATE_001: {
    code: 'PROD_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'La validación del producto falló',
  },
  PROD_PERM_001: {
    code: 'PROD_PERM_001',
    httpStatus: 403,
    devMessage: 'Acceso denegado al producto',
  },
  PROD_DUP_001: {
    code: 'PROD_DUP_001',
    httpStatus: 409,
    devMessage: 'El producto ya existe',
  },
  PROD_IMAGE_001: {
    code: 'PROD_IMAGE_001',
    httpStatus: 404,
    devMessage: 'Imagen no encontrada',
  },
  PROD_CAT_001: {
    code: 'PROD_CAT_001',
    httpStatus: 400,
    devMessage: 'Categoría o marca inválida',
  },
  PROD_SVC_001: {
    code: 'PROD_SVC_001',
    httpStatus: 400,
    devMessage:
      'Los servicios no pueden tener atributos físicos (peso, dimensiones, inventario)',
  },
  PROD_SVC_002: {
    code: 'PROD_SVC_002',
    httpStatus: 400,
    devMessage: 'No se puede cambiar el tipo de un producto existente',
  },
  PROD_VALIDATE_002: {
    code: 'PROD_VALIDATE_002',
    httpStatus: 400,
    devMessage:
      'El producto debe tener un SKU configurado antes de activar variantes',
  },
  PROD_VALIDATE_003: {
    code: 'PROD_VALIDATE_003',
    httpStatus: 400,
    devMessage: 'El SKU de la variante no puede estar vacío',
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
  INV_BULK_001: {
    code: 'INV_BULK_001',
    httpStatus: 400,
    devMessage: 'Empty file or no valid data',
  },
  INV_BULK_002: {
    code: 'INV_BULK_002',
    httpStatus: 400,
    devMessage: 'Bulk upload batch size exceeded (max 1000)',
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
  CUST_BULK_001: {
    code: 'CUST_BULK_001',
    httpStatus: 400,
    devMessage: 'Bulk upload batch size exceeded',
  },
  CUST_BULK_002: {
    code: 'CUST_BULK_002',
    httpStatus: 400,
    devMessage: 'Bulk upload row validation failed',
  },
  CUST_BULK_003: {
    code: 'CUST_BULK_003',
    httpStatus: 409,
    devMessage: 'Duplicate email in bulk upload batch',
  },
  CUST_BULK_004: {
    code: 'CUST_BULK_004',
    httpStatus: 400,
    devMessage: 'Store context required for bulk upload',
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

  // AI Queue
  AI_QUEUE_001: {
    code: 'AI_QUEUE_001',
    httpStatus: 500,
    devMessage: 'Failed to enqueue AI job',
  },
  AI_QUEUE_002: {
    code: 'AI_QUEUE_002',
    httpStatus: 404,
    devMessage: 'AI job not found',
  },
  AI_CACHE_001: {
    code: 'AI_CACHE_001',
    httpStatus: 500,
    devMessage: 'AI cache operation failed',
  },

  // AI Logging
  AI_LOG_001: {
    code: 'AI_LOG_001',
    httpStatus: 500,
    devMessage: 'Failed to log AI request',
  },

  // AI Streaming
  AI_STREAM_001: {
    code: 'AI_STREAM_001',
    httpStatus: 400,
    devMessage: 'Streaming not supported by this provider',
  },
  AI_STREAM_002: {
    code: 'AI_STREAM_002',
    httpStatus: 500,
    devMessage: 'AI streaming failed',
  },

  // AI Chat
  AI_CHAT_001: {
    code: 'AI_CHAT_001',
    httpStatus: 404,
    devMessage: 'AI conversation not found',
  },
  AI_CHAT_002: {
    code: 'AI_CHAT_002',
    httpStatus: 400,
    devMessage: 'Conversation is archived',
  },
  AI_CHAT_003: {
    code: 'AI_CHAT_003',
    httpStatus: 403,
    devMessage: 'Not authorized to access this conversation',
  },
  AI_CHAT_004: {
    code: 'AI_CHAT_004',
    httpStatus: 400,
    devMessage: 'Message content is required',
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
  PAYROLL_BULK_001: {
    code: 'PAYROLL_BULK_001',
    httpStatus: 400,
    devMessage: 'Bulk upload batch size exceeded',
  },
  PAYROLL_BULK_002: {
    code: 'PAYROLL_BULK_002',
    httpStatus: 400,
    devMessage: 'Bulk upload row validation failed',
  },
  PAYROLL_BULK_003: {
    code: 'PAYROLL_BULK_003',
    httpStatus: 400,
    devMessage: 'Duplicate document in bulk upload batch',
  },
  PAYROLL_BULK_004: {
    code: 'PAYROLL_BULK_004',
    httpStatus: 400,
    devMessage: 'Email required when is_user is true',
  },
  PAYROLL_BULK_005: {
    code: 'PAYROLL_BULK_005',
    httpStatus: 409,
    devMessage: 'User already linked to another employee',
  },
  PAYROLL_BULK_006: {
    code: 'PAYROLL_BULK_006',
    httpStatus: 409,
    devMessage: 'Username already exists for this organization',
  },
  PAYROLL_BULK_007: {
    code: 'PAYROLL_BULK_007',
    httpStatus: 409,
    devMessage: 'Email already exists for this organization',
  },
  PAYROLL_BULK_008: {
    code: 'PAYROLL_BULK_008',
    httpStatus: 400,
    devMessage: 'Unexpected error processing employee in bulk upload',
  },
  PAYROLL_VALIDATE_002: {
    code: 'PAYROLL_VALIDATE_002',
    httpStatus: 400,
    devMessage: 'User with CUSTOMER role cannot be linked as employee',
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
  // Coupons
  CPN_FIND_001: {
    code: 'CPN_FIND_001',
    httpStatus: 404,
    devMessage: 'Coupon not found',
  },
  CPN_DUP_001: {
    code: 'CPN_DUP_001',
    httpStatus: 409,
    devMessage: 'Coupon code already exists',
  },
  CPN_EXPIRED_001: {
    code: 'CPN_EXPIRED_001',
    httpStatus: 400,
    devMessage: 'Coupon expired or not yet valid',
  },
  CPN_LIMIT_001: {
    code: 'CPN_LIMIT_001',
    httpStatus: 400,
    devMessage: 'Coupon usage limit reached',
  },
  CPN_LIMIT_002: {
    code: 'CPN_LIMIT_002',
    httpStatus: 400,
    devMessage: 'Customer already used this coupon',
  },
  CPN_MIN_001: {
    code: 'CPN_MIN_001',
    httpStatus: 400,
    devMessage: 'Minimum purchase amount not met',
  },
  CPN_APPLY_001: {
    code: 'CPN_APPLY_001',
    httpStatus: 400,
    devMessage: 'Coupon not applicable to cart products',
  },
  CPN_VALIDATE_001: {
    code: 'CPN_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Coupon validation failed',
  },

  // ===== LAYAWAY (Plan Separé) =====
  LAY_FIND_001: {
    code: 'LAY_FIND_001',
    httpStatus: 404,
    devMessage: 'Layaway plan not found',
  },
  LAY_STATE_001: {
    code: 'LAY_STATE_001',
    httpStatus: 409,
    devMessage: 'Invalid layaway plan state transition',
  },
  LAY_PAYMENT_001: {
    code: 'LAY_PAYMENT_001',
    httpStatus: 400,
    devMessage: 'Payment amount exceeds remaining balance',
  },
  LAY_INSTALLMENT_001: {
    code: 'LAY_INSTALLMENT_001',
    httpStatus: 400,
    devMessage: 'Installment amounts do not match remaining balance',
  },
  LAY_INSTALLMENT_002: {
    code: 'LAY_INSTALLMENT_002',
    httpStatus: 409,
    devMessage: 'Installment already paid',
  },

  // ===== EMPLOYEE ADVANCES =====
  ADV_FIND_001: {
    code: 'ADV_FIND_001',
    httpStatus: 404,
    devMessage: 'Advance not found',
  },
  ADV_STATUS_001: {
    code: 'ADV_STATUS_001',
    httpStatus: 400,
    devMessage: 'Invalid advance status transition',
  },
  ADV_VALIDATE_001: {
    code: 'ADV_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Employee not found or not active',
  },
  ADV_PAYMENT_001: {
    code: 'ADV_PAYMENT_001',
    httpStatus: 400,
    devMessage: 'Payment amount exceeds pending balance',
  },
  ADV_INSTALLMENT_001: {
    code: 'ADV_INSTALLMENT_001',
    httpStatus: 404,
    devMessage: 'Installment not found',
  },
  ADV_INSTALLMENT_002: {
    code: 'ADV_INSTALLMENT_002',
    httpStatus: 400,
    devMessage: 'Installment already paid',
  },

  // ===== BANK RECONCILIATION =====
  BANK_ACCOUNT_NOT_FOUND: {
    code: 'BANK_ACCOUNT_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Bank account not found',
  },
  BANK_ACCOUNT_DUPLICATE: {
    code: 'BANK_ACCOUNT_DUPLICATE',
    httpStatus: 409,
    devMessage: 'A bank account with this account number already exists',
  },
  BANK_RECONCILIATION_NOT_FOUND: {
    code: 'BANK_RECONCILIATION_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Bank reconciliation not found',
  },
  BANK_RECONCILIATION_ALREADY_COMPLETED: {
    code: 'BANK_RECONCILIATION_ALREADY_COMPLETED',
    httpStatus: 409,
    devMessage: 'This reconciliation has already been completed',
  },
  BANK_RECONCILIATION_DIFFERENCE_NOT_ZERO: {
    code: 'BANK_RECONCILIATION_DIFFERENCE_NOT_ZERO',
    httpStatus: 400,
    devMessage: 'Cannot complete reconciliation: difference is not zero',
  },
  BANK_TRANSACTION_NOT_FOUND: {
    code: 'BANK_TRANSACTION_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Bank transaction not found',
  },
  BANK_TRANSACTION_ALREADY_RECONCILED: {
    code: 'BANK_TRANSACTION_ALREADY_RECONCILED',
    httpStatus: 409,
    devMessage: 'This bank transaction is already reconciled',
  },
  STATEMENT_PARSE_ERROR: {
    code: 'STATEMENT_PARSE_ERROR',
    httpStatus: 400,
    devMessage: 'Error parsing bank statement file',
  },
  INVALID_COLUMN_MAPPING: {
    code: 'INVALID_COLUMN_MAPPING',
    httpStatus: 400,
    devMessage: 'Invalid column mapping configuration',
  },
  UNSUPPORTED_STATEMENT_FORMAT: {
    code: 'UNSUPPORTED_STATEMENT_FORMAT',
    httpStatus: 400,
    devMessage: 'Unsupported bank statement format',
  },

  // ===== FIXED ASSETS =====
  FIXED_ASSET_NOT_FOUND: {
    code: 'FIXED_ASSET_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Fixed asset not found',
  },
  FIXED_ASSET_CATEGORY_NOT_FOUND: {
    code: 'FIXED_ASSET_CATEGORY_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Fixed asset category not found',
  },
  FIXED_ASSET_ALREADY_DISPOSED: {
    code: 'FIXED_ASSET_ALREADY_DISPOSED',
    httpStatus: 409,
    devMessage: 'This asset has already been disposed',
  },
  FIXED_ASSET_FULLY_DEPRECIATED: {
    code: 'FIXED_ASSET_FULLY_DEPRECIATED',
    httpStatus: 409,
    devMessage: 'This asset is already fully depreciated',
  },
  DEPRECIATION_ALREADY_EXISTS: {
    code: 'DEPRECIATION_ALREADY_EXISTS',
    httpStatus: 409,
    devMessage: 'Depreciation entry already exists for this period',
  },
  DEPRECIATION_NO_OPEN_PERIOD: {
    code: 'DEPRECIATION_NO_OPEN_PERIOD',
    httpStatus: 400,
    devMessage: 'No open fiscal period found for depreciation date',
  },

  // ===== BUDGETS =====
  BUDGET_NOT_FOUND: {
    code: 'BUDGET_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Budget not found',
  },
  BUDGET_ALREADY_ACTIVE: {
    code: 'BUDGET_ALREADY_ACTIVE',
    httpStatus: 409,
    devMessage: 'An active budget already exists for this period and store',
  },
  BUDGET_NOT_DRAFT: {
    code: 'BUDGET_NOT_DRAFT',
    httpStatus: 400,
    devMessage: 'Only draft budgets can be modified',
  },
  BUDGET_CANNOT_APPROVE: {
    code: 'BUDGET_CANNOT_APPROVE',
    httpStatus: 400,
    devMessage: 'Only draft budgets can be approved',
  },
  BUDGET_CANNOT_ACTIVATE: {
    code: 'BUDGET_CANNOT_ACTIVATE',
    httpStatus: 400,
    devMessage: 'Only approved budgets can be activated',
  },
  BUDGET_CANNOT_CLOSE: {
    code: 'BUDGET_CANNOT_CLOSE',
    httpStatus: 400,
    devMessage: 'Only active budgets can be closed',
  },

  // ===== CONSOLIDATION =====
  CONSOLIDATION_SESSION_NOT_FOUND: {
    code: 'CONSOLIDATION_SESSION_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Consolidation session not found',
  },
  CONSOLIDATION_NOT_MULTI_STORE: {
    code: 'CONSOLIDATION_NOT_MULTI_STORE',
    httpStatus: 400,
    devMessage: 'Consolidation is only available for multi-store organizations',
  },
  CONSOLIDATION_SESSION_NOT_DRAFT: {
    code: 'CONSOLIDATION_SESSION_NOT_DRAFT',
    httpStatus: 400,
    devMessage: 'Only draft sessions can be started',
  },
  CONSOLIDATION_SESSION_ALREADY_COMPLETED: {
    code: 'CONSOLIDATION_SESSION_ALREADY_COMPLETED',
    httpStatus: 409,
    devMessage: 'This consolidation session has already been completed',
  },
  INTERCOMPANY_TRANSACTION_NOT_FOUND: {
    code: 'INTERCOMPANY_TRANSACTION_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Intercompany transaction not found',
  },
  CONSOLIDATION_ADJUSTMENTS_NOT_BALANCED: {
    code: 'CONSOLIDATION_ADJUSTMENTS_NOT_BALANCED',
    httpStatus: 400,
    devMessage: 'Consolidation adjustments are not balanced (debit ≠ credit)',
  },

  // Payroll Settlements
  SETTLEMENT_FIND_001: {
    code: 'SETTLEMENT_FIND_001',
    httpStatus: 404,
    devMessage: 'Settlement not found',
  },
  SETTLEMENT_STATUS_001: {
    code: 'SETTLEMENT_STATUS_001',
    httpStatus: 400,
    devMessage: 'Invalid settlement status transition',
  },
  SETTLEMENT_CALC_001: {
    code: 'SETTLEMENT_CALC_001',
    httpStatus: 400,
    devMessage: 'Cannot calculate settlement: employee not active',
  },
  SETTLEMENT_CALC_002: {
    code: 'SETTLEMENT_CALC_002',
    httpStatus: 409,
    devMessage: 'Active settlement already exists for this employee',
  },
  SETTLEMENT_VALIDATE_001: {
    code: 'SETTLEMENT_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Employee is already terminated',
  },
  // ===== HABEAS DATA =====
  HABEAS_EXPORT_RATE_LIMIT: {
    code: 'HABEAS_EXPORT_RATE_LIMIT',
    httpStatus: 429,
    devMessage: 'Data export rate limit exceeded (1 per 24h)',
  },
  HABEAS_ANON_SELF: {
    code: 'HABEAS_ANON_SELF',
    httpStatus: 400,
    devMessage: 'Cannot anonymize own account',
  },
  HABEAS_ANON_ALREADY: {
    code: 'HABEAS_ANON_ALREADY',
    httpStatus: 409,
    devMessage: 'User already anonymized',
  },
  HABEAS_EXPORT_PROCESSING: {
    code: 'HABEAS_EXPORT_PROCESSING',
    httpStatus: 409,
    devMessage: 'Data export already in progress',
  },
  HABEAS_ANON_REQUEST_NOT_FOUND: {
    code: 'HABEAS_ANON_REQUEST_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Anonymization request not found',
  },
  HABEAS_CONSENT_INVALID: {
    code: 'HABEAS_CONSENT_INVALID',
    httpStatus: 422,
    devMessage: 'Invalid consent type',
  },

  // ICA Municipal Tax
  ICA_RATE_NOT_FOUND: {
    code: 'ICA_RATE_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'ICA rate not found for the specified municipality',
  },
  ICA_STORE_NO_ADDRESS: {
    code: 'ICA_STORE_NO_ADDRESS',
    httpStatus: 422,
    devMessage: 'Store has no primary address with municipality code',
  },
  ICA_INVALID_PERIOD: {
    code: 'ICA_INVALID_PERIOD',
    httpStatus: 422,
    devMessage: 'Invalid period format. Use YYYY-QN or YYYY-MM',
  },

  // Withholding Tax (Retención en la Fuente)
  WHT_CONCEPT_NOT_FOUND: {
    code: 'WHT_CONCEPT_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Withholding concept not found',
  },
  WHT_UVT_NOT_FOUND: {
    code: 'WHT_UVT_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'UVT value not found for the specified year',
  },
  WHT_CONCEPT_DUPLICATE: {
    code: 'WHT_CONCEPT_DUPLICATE',
    httpStatus: 409,
    devMessage: 'Withholding concept code already exists',
  },
  WHT_CALCULATION_ERROR: {
    code: 'WHT_CALCULATION_ERROR',
    httpStatus: 422,
    devMessage: 'Error calculating withholding tax',
  },

  // Exogenous Reports
  EXO_REPORT_NOT_FOUND: {
    code: 'EXO_REPORT_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Exogenous report not found',
  },
  EXO_INVALID_FORMAT: {
    code: 'EXO_INVALID_FORMAT',
    httpStatus: 422,
    devMessage: 'Invalid exogenous format code',
  },
  EXO_GENERATION_FAILED: {
    code: 'EXO_GENERATION_FAILED',
    httpStatus: 500,
    devMessage: 'Failed to generate exogenous report',
  },
  EXO_VALIDATION_ERRORS: {
    code: 'EXO_VALIDATION_ERRORS',
    httpStatus: 422,
    devMessage: 'Data completeness validation found errors',
  },
  EXO_DOWNLOAD_FAILED: {
    code: 'EXO_DOWNLOAD_FAILED',
    httpStatus: 500,
    devMessage: 'Failed to generate or download exogenous report file',
  },
  // Reviews
  REV_FIND_001: {
    code: 'REV_FIND_001',
    httpStatus: 404,
    devMessage: 'Reseña no encontrada',
  },
  REV_DUP_001: {
    code: 'REV_DUP_001',
    httpStatus: 409,
    devMessage: 'Ya existe una reseña para este producto',
  },
  REV_PURCHASE_001: {
    code: 'REV_PURCHASE_001',
    httpStatus: 403,
    devMessage: 'Debe tener una compra verificada para reseñar este producto',
  },
  REV_RATE_LIMIT_001: {
    code: 'REV_RATE_LIMIT_001',
    httpStatus: 429,
    devMessage: 'Límite de reseñas diarias alcanzado (máximo 3)',
  },
  REV_PERM_001: {
    code: 'REV_PERM_001',
    httpStatus: 403,
    devMessage: 'No tiene permiso para modificar esta reseña',
  },
  REV_STATE_001: {
    code: 'REV_STATE_001',
    httpStatus: 400,
    devMessage: 'Solo se pueden editar reseñas en estado pendiente',
  },
  REV_VOTE_DUP_001: {
    code: 'REV_VOTE_DUP_001',
    httpStatus: 409,
    devMessage: 'Ya votó esta reseña',
  },
  REV_REPORT_DUP_001: {
    code: 'REV_REPORT_DUP_001',
    httpStatus: 409,
    devMessage: 'Ya reportó esta reseña',
  },

  // AI Agent
  AI_AGENT_001: {
    code: 'AI_AGENT_001',
    httpStatus: 500,
    devMessage: 'Agent loop exceeded maximum iterations',
  },
  AI_AGENT_002: {
    code: 'AI_AGENT_002',
    httpStatus: 408,
    devMessage: 'Agent loop timed out',
  },
  AI_AGENT_003: {
    code: 'AI_AGENT_003',
    httpStatus: 500,
    devMessage: 'Tool execution failed',
  },
  AI_AGENT_004: {
    code: 'AI_AGENT_004',
    httpStatus: 403,
    devMessage: 'Insufficient permissions for tool',
  },
  AI_AGENT_005: {
    code: 'AI_AGENT_005',
    httpStatus: 400,
    devMessage: 'Tool requires human confirmation',
  },

  // AI Embeddings
  AI_EMBED_001: {
    code: 'AI_EMBED_001',
    httpStatus: 500,
    devMessage: 'Failed to generate embedding',
  },
  AI_EMBED_002: {
    code: 'AI_EMBED_002',
    httpStatus: 500,
    devMessage: 'Failed to store embedding',
  },
  AI_EMBED_003: {
    code: 'AI_EMBED_003',
    httpStatus: 500,
    devMessage: 'Similarity search failed',
  },

  // Dispatch Notes (Remisiones)
  DSP_FIND_001: {
    code: 'DSP_FIND_001',
    httpStatus: 404,
    devMessage: 'Dispatch note not found',
  },
  DSP_VALIDATE_001: {
    code: 'DSP_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Invalid dispatch note state transition',
  },
  DSP_VALIDATE_002: {
    code: 'DSP_VALIDATE_002',
    httpStatus: 400,
    devMessage: 'Insufficient stock for dispatch note confirmation',
  },
  DSP_VALIDATE_003: {
    code: 'DSP_VALIDATE_003',
    httpStatus: 400,
    devMessage: 'Customer is not active',
  },
  DSP_VALIDATE_004: {
    code: 'DSP_VALIDATE_004',
    httpStatus: 400,
    devMessage: 'Dispatch note can only be modified in draft state',
  },
  DSP_VALIDATE_005: {
    code: 'DSP_VALIDATE_005',
    httpStatus: 400,
    devMessage: 'Dispatched quantity exceeds remaining ordered quantity',
  },

  // MCP (Model Context Protocol)
  AI_MCP_001: {
    code: 'AI_MCP_001',
    httpStatus: 401,
    devMessage: 'MCP authentication failed',
  },
  AI_MCP_002: {
    code: 'AI_MCP_002',
    httpStatus: 403,
    devMessage: 'MCP authorization denied',
  },
  AI_MCP_003: {
    code: 'AI_MCP_003',
    httpStatus: 429,
    devMessage: 'MCP rate limit exceeded',
  },
  AI_MCP_004: {
    code: 'AI_MCP_004',
    httpStatus: 400,
    devMessage: 'Invalid MCP request format',
  },
  // Bulk Image Upload
  BULK_IMG_ZIP_CORRUPT: {
    code: 'BULK_IMG_ZIP_CORRUPT',
    httpStatus: 400,
    devMessage: 'ZIP file is corrupt or invalid',
  },
  BULK_IMG_NO_SKUS: {
    code: 'BULK_IMG_NO_SKUS',
    httpStatus: 400,
    devMessage: 'ZIP contains no valid SKU folders',
  },
  BULK_IMG_SESSION_EXPIRED: {
    code: 'BULK_IMG_SESSION_EXPIRED',
    httpStatus: 404,
    devMessage: 'Analysis session not found or expired',
  },
  BULK_IMG_FORMAT_INVALID: {
    code: 'BULK_IMG_FORMAT_INVALID',
    httpStatus: 400,
    devMessage: 'Unsupported image format',
  },
  BULK_IMG_LIMIT_EXCEEDED: {
    code: 'BULK_IMG_LIMIT_EXCEEDED',
    httpStatus: 400,
    devMessage: 'Product has reached maximum image limit',
  },
  BULK_PROD_FILE_INVALID: {
    code: 'BULK_PROD_FILE_INVALID',
    httpStatus: 400,
    devMessage: 'Excel/CSV file is invalid or corrupt',
  },
  BULK_PROD_EMPTY_FILE: {
    code: 'BULK_PROD_EMPTY_FILE',
    httpStatus: 400,
    devMessage: 'File contains no data rows',
  },
  BULK_PROD_LIMIT_EXCEEDED: {
    code: 'BULK_PROD_LIMIT_EXCEEDED',
    httpStatus: 400,
    devMessage: 'File exceeds maximum product limit (1000)',
  },
  BULK_PROD_SESSION_EXPIRED: {
    code: 'BULK_PROD_SESSION_EXPIRED',
    httpStatus: 404,
    devMessage: 'Analysis session not found or expired',
  },
  BULK_PROD_VALIDATE_001: {
    code: 'BULK_PROD_VALIDATE_001',
    httpStatus: 422,
    devMessage: 'Invalid field type in bulk product data',
  },
  // Invoice Scanner
  INV_SCAN_AI_FAIL: {
    code: 'INV_SCAN_AI_FAIL',
    httpStatus: 502,
    devMessage: 'AI invoice OCR processing failed',
  },
  INV_SCAN_PARSE_FAIL: {
    code: 'INV_SCAN_PARSE_FAIL',
    httpStatus: 422,
    devMessage: 'Failed to parse AI OCR response as valid JSON',
  },
  INV_SCAN_NO_FILE: {
    code: 'INV_SCAN_NO_FILE',
    httpStatus: 400,
    devMessage: 'No invoice file provided',
  },
  INV_SCAN_INVALID_FILE: {
    code: 'INV_SCAN_INVALID_FILE',
    httpStatus: 400,
    devMessage: 'Invalid file type — only images and PDFs are accepted',
  },

  // Monitoring
  MON_CW_001: {
    code: 'MON_CW_001',
    httpStatus: 502,
    devMessage: 'CloudWatch API request failed',
  },
  MON_METRICS_001: {
    code: 'MON_METRICS_001',
    httpStatus: 500,
    devMessage: 'Failed to collect server metrics',
  },
} as const satisfies Record<string, ErrorCodeEntry>;

export type ErrorCodeKey = keyof typeof ErrorCodes;
