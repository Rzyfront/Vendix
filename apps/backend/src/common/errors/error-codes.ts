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
  /**
   * RED DE SEGURIDAD DEL FILTRO GLOBAL — Prisma P2020 («value out of range»).
   *
   * Por qué existe: `ParseIntPipe` acepta `999999999999999999` porque ES un
   * entero sintácticamente válido; quien lo rechaza es Postgres, ya dentro de la
   * consulta, con `22003` sobre una columna `int4`. Sin este código, cualquier
   * `:id` desmesurado —o un bot barriendo la API— produce un 500 que ensucia la
   * observabilidad con falsos incidentes de servidor.
   *
   * Por qué 400 y no 404: la petición nunca llegó a ser una búsqueda. Postgres
   * se negó a comparar el valor, así que responder 404 afirmaría que se buscó y
   * no se encontró, cuando lo cierto es que el identificador no es legal para la
   * columna.
   *
   * El texto crudo de Prisma NO viaja al cliente: incluye el fragmento de la
   * invocación con nombres de tabla y columna. Ese detalle va al log.
   */
  SYS_VALUE_OUT_OF_RANGE_001: {
    code: 'SYS_VALUE_OUT_OF_RANGE_001',
    httpStatus: 400,
    devMessage:
      'A value in the request exceeds the range the database column can store (Prisma P2020)',
  },
  /**
   * RED DE SEGURIDAD DEL FILTRO GLOBAL — subconjunto ESTRECHO de
   * `PrismaClientValidationError`: solo el desajuste de TIPO de un valor.
   *
   * `PrismaClientValidationError` cubre dos poblaciones muy distintas y
   * mezclarlas sería el peor de los arreglos. «Unknown argument» o «Argument X
   * is missing» son consultas que Vendix construyó mal: bugs del servidor, y
   * deben seguir siendo 500 para que sigan doliendo y se vean. Solo el caso
   * «Invalid value provided. Expected Int, provided String» tiene su origen en
   * el dato que mandó el cliente, y ese es el único que este código traduce.
   */
  SYS_INVALID_FIELD_VALUE_001: {
    code: 'SYS_INVALID_FIELD_VALUE_001',
    httpStatus: 400,
    devMessage:
      'A request value does not match the type the model field expects (narrow PrismaClientValidationError subset)',
  },

  // Role scope (QUI-72) — shared by superadmin / organization / store levels.
  // Live next to SYS_* on purpose: the scope matrix is cross-domain, so the
  // three levels must answer with the SAME code for the same violation.
  ROLE_SCOPE_001: {
    code: 'ROLE_SCOPE_001',
    httpStatus: 403,
    devMessage: 'Role is read-only at this level (scope/edit matrix)',
  },
  ROLE_SCOPE_002: {
    code: 'ROLE_SCOPE_002',
    httpStatus: 403,
    devMessage: 'Organization context required to resolve role scope',
  },
  ROLE_SCOPE_003: {
    code: 'ROLE_SCOPE_003',
    httpStatus: 403,
    devMessage: 'Store context required to resolve role scope',
  },
  ROLE_SCOPE_004: {
    code: 'ROLE_SCOPE_004',
    httpStatus: 404,
    devMessage: 'Role not found or not visible at this level',
  },
  ROLE_ASSIGN_001: {
    code: 'ROLE_ASSIGN_001',
    httpStatus: 403,
    devMessage: 'Role cannot be assigned to a user outside its scope',
  },
  ROLE_ASSIGN_002: {
    code: 'ROLE_ASSIGN_002',
    httpStatus: 403,
    devMessage: 'Immutable role cannot be assigned or removed through this API',
  },
  ROLE_ASSIGN_003: {
    code: 'ROLE_ASSIGN_003',
    httpStatus: 403,
    devMessage:
      'System role not assignable at this level (see ASSIGNABLE_SYSTEM_ROLES)',
  },
  ROLE_ASSIGN_004: {
    code: 'ROLE_ASSIGN_004',
    httpStatus: 404,
    devMessage: 'Role assignment not found',
  },
  ROLE_ASSIGN_005: {
    code: 'ROLE_ASSIGN_005',
    httpStatus: 409,
    devMessage: 'Role is already assigned to this user in this scope',
  },
  ROLE_ASSIGN_006: {
    code: 'ROLE_ASSIGN_006',
    httpStatus: 404,
    devMessage: 'Target user not found in this scope',
  },
  ROLE_ASSIGN_007: {
    code: 'ROLE_ASSIGN_007',
    httpStatus: 403,
    devMessage: 'Assignment store does not belong to the role organization',
  },

  // Uploads
  UPLOAD_FILE_001: {
    code: 'UPLOAD_FILE_001',
    httpStatus: 400,
    devMessage: 'Upload file is required',
  },
  UPLOAD_CONTEXT_001: {
    code: 'UPLOAD_CONTEXT_001',
    httpStatus: 400,
    devMessage: 'Organization context required for upload',
  },
  UPLOAD_STORE_CONTEXT_001: {
    code: 'UPLOAD_STORE_CONTEXT_001',
    httpStatus: 400,
    devMessage: 'Store context required for upload',
  },
  UPLOAD_ORG_001: {
    code: 'UPLOAD_ORG_001',
    httpStatus: 404,
    devMessage: 'Upload organization not found',
  },
  UPLOAD_STORE_001: {
    code: 'UPLOAD_STORE_001',
    httpStatus: 404,
    devMessage: 'Upload store not found',
  },
  UPLOAD_TYPE_001: {
    code: 'UPLOAD_TYPE_001',
    httpStatus: 400,
    devMessage: 'Unsupported upload entity type',
  },
  UPLOAD_FORBIDDEN_001: {
    code: 'UPLOAD_FORBIDDEN_001',
    httpStatus: 403,
    devMessage: 'Upload file access denied',
  },
  UPLOAD_FAILED_001: {
    code: 'UPLOAD_FAILED_001',
    httpStatus: 502,
    devMessage: 'File upload failed',
  },
  UPLOAD_REMOTE_URL_001: {
    code: 'UPLOAD_REMOTE_URL_001',
    httpStatus: 400,
    devMessage: 'Remote image URL is invalid',
  },
  UPLOAD_REMOTE_FORBIDDEN_001: {
    code: 'UPLOAD_REMOTE_FORBIDDEN_001',
    httpStatus: 403,
    devMessage: 'Remote image URL is not allowed',
  },
  UPLOAD_REMOTE_TYPE_001: {
    code: 'UPLOAD_REMOTE_TYPE_001',
    httpStatus: 415,
    devMessage: 'Remote URL did not return a supported image',
  },
  UPLOAD_REMOTE_SIZE_001: {
    code: 'UPLOAD_REMOTE_SIZE_001',
    httpStatus: 413,
    devMessage: 'Remote image is too large',
  },
  UPLOAD_REMOTE_FETCH_001: {
    code: 'UPLOAD_REMOTE_FETCH_001',
    httpStatus: 502,
    devMessage: 'Remote image could not be downloaded',
  },
  VALIDATION_FILE_TYPE: {
    code: 'VALIDATION_FILE_TYPE',
    httpStatus: 400,
    devMessage:
      'Uploaded file type is not allowed (expected one of: image/jpeg, image/png, image/webp, application/pdf)',
  },

  // Print Formats Hub & Gateway (QUI-780)
  PRINT_FORMAT_NOT_FOUND_001: {
    code: 'PRINT_FORMAT_NOT_FOUND_001',
    httpStatus: 404,
    devMessage: 'Print format type not found in catalog',
  },
  PRINT_TEMPLATE_NOT_FOUND_001: {
    code: 'PRINT_TEMPLATE_NOT_FOUND_001',
    httpStatus: 404,
    devMessage: 'Print template not found or inaccessible for organization',
  },
  PRINT_TEMPLATE_SYSTEM_PROTECTED_001: {
    code: 'PRINT_TEMPLATE_SYSTEM_PROTECTED_001',
    httpStatus: 403,
    devMessage: 'System master print templates cannot be modified or deleted',
  },
  PRINT_TEMPLATE_ACCESS_DENIED_001: {
    code: 'PRINT_TEMPLATE_ACCESS_DENIED_001',
    httpStatus: 403,
    devMessage: 'Access denied to organization print template',
  },
  PRINT_CONFIG_VALIDATION_001: {
    code: 'PRINT_CONFIG_VALIDATION_001',
    httpStatus: 422,
    devMessage: 'Print format definition or overrides schema validation failed',
  },
  PRINT_TOKEN_SYNTAX_001: {
    code: 'PRINT_TOKEN_SYNTAX_001',
    httpStatus: 422,
    devMessage: 'Custom template syntax error or unclosed token tag',
  },
  PRINT_DOCUMENT_NOT_FOUND_001: {
    code: 'PRINT_DOCUMENT_NOT_FOUND_001',
    httpStatus: 404,
    devMessage: 'Source document to render was not found in domain',
  },
  // 501 y no 404 ni 500 a propósito: el formato SÍ está registrado y el
  // documento SÍ puede existir; lo que falta es el lector real de ese dominio.
  // Un 404 mentiría diciendo que el documento no existe y un 500 haría pensar en
  // una caída. Sustituye a devolver la muestra fabricada, que respondía 200 con
  // datos de un tercero.
  PRINT_DOCUMENT_READER_MISSING_001: {
    code: 'PRINT_DOCUMENT_READER_MISSING_001',
    httpStatus: 501,
    devMessage:
      'Print format is registered but has no real document reader yet; refusing to serve sample data on the real print path',
  },
  PRINT_DATA_PROVIDER_MISSING_001: {
    code: 'PRINT_DATA_PROVIDER_MISSING_001',
    httpStatus: 500,
    devMessage: 'No document data provider registered for the requested format type',
  },
  PRINT_FISCAL_STRUCTURE_VIOLATION_001: {
    code: 'PRINT_FISCAL_STRUCTURE_VIOLATION_001',
    httpStatus: 422,
    devMessage: 'Fiscal electronic invoice template violates DIAN mandatory graphic representation requirements',
  },
  PRINT_GATEWAY_RENDER_FAILED_001: {
    code: 'PRINT_GATEWAY_RENDER_FAILED_001',
    httpStatus: 500,
    devMessage: 'Print gateway document render failed',
  },
  PRINT_PERM_MANAGE_REQUIRED_001: {
    code: 'PRINT_PERM_MANAGE_REQUIRED_001',
    httpStatus: 403,
    devMessage: 'Permission store:settings:manage or store:print_formats:manage required',
  },
  PRINT_LIBRARY_SHARE_FORBIDDEN_001: {
    code: 'PRINT_LIBRARY_SHARE_FORBIDDEN_001',
    httpStatus: 403,
    devMessage: 'Only organization administrators can share templates with other stores',
  },
  PRINT_CLONE_FAILED_001: {
    code: 'PRINT_CLONE_FAILED_001',
    httpStatus: 409,
    devMessage: 'Cannot clone template due to existing configuration conflict',
  },
  PRINT_PREVIEW_TIMEOUT_001: {
    code: 'PRINT_PREVIEW_TIMEOUT_001',
    httpStatus: 504,
    devMessage: 'Print preview compilation timed out',
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
  PAY_RECEIPT_NOT_FOUND_001: {
    code: 'PAY_RECEIPT_NOT_FOUND_001',
    httpStatus: 404,
    devMessage: 'Payment receipt not uploaded',
  },

  // Payment Sources (Card-On-File / Wompi recurrent)
  PAYMENT_SOURCE_NOT_FOUND: {
    code: 'PAYMENT_SOURCE_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Payment source not found in gateway',
  },
  PAYMENT_SOURCE_REVOKED: {
    code: 'PAYMENT_SOURCE_REVOKED',
    httpStatus: 422,
    devMessage: 'Payment source revoked by issuer',
  },
  PAYMENT_SOURCE_NOT_AVAILABLE: {
    code: 'PAYMENT_SOURCE_NOT_AVAILABLE',
    httpStatus: 422,
    devMessage: 'Payment source not available for charges',
  },
  PAYMENT_SOURCE_INVALID_ACCEPTANCE_TOKEN: {
    code: 'PAYMENT_SOURCE_INVALID_ACCEPTANCE_TOKEN',
    httpStatus: 400,
    devMessage: 'Acceptance token rejected by gateway',
  },
  PAYMENT_METHOD_NOT_MIGRATED: {
    code: 'PAYMENT_METHOD_NOT_MIGRATED',
    httpStatus: 412,
    devMessage: 'Payment method requires re-tokenization',
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
  AUTH_ACCOUNT_LOCKED_001: {
    code: 'AUTH_ACCOUNT_LOCKED_001',
    httpStatus: 423,
    devMessage:
      'Account temporarily locked due to repeated failed login attempts',
  },
  AUTH_DUP_001: {
    code: 'AUTH_DUP_001',
    httpStatus: 409,
    devMessage: 'User already exists',
  },
  AUTH_CUSTOMER_CLAIMABLE_001: {
    code: 'AUTH_CUSTOMER_CLAIMABLE_001',
    httpStatus: 409,
    devMessage:
      'Ya existe una cuenta de cliente con este correo — puedes recuperarla restableciendo tu contraseña.',
  },
  AUTH_CUSTOMER_ARCHIVED_001: {
    code: 'AUTH_CUSTOMER_ARCHIVED_001',
    httpStatus: 403,
    devMessage:
      'La cuenta del cliente está archivada. Solo el comerciante puede reactivarla desde el backoffice.',
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
  ECOM_CHECKOUT_004: {
    code: 'ECOM_CHECKOUT_004',
    httpStatus: 403,
    devMessage: 'Store is unavailable for checkout',
  },
  // QUI-467: la billetera es saldo prepago por cliente, así que exige
  // identidad autenticada. Se mantiene en 400 (era un BadRequestException) para
  // no disparar el interceptor de refresh/logout que sí reacciona al 401.
  ECOM_CHECKOUT_005: {
    code: 'ECOM_CHECKOUT_005',
    httpStatus: 400,
    devMessage: 'Wallet payment requires an authenticated customer',
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
  // El comprador mandó una presentación de venta (price_tier_id) pero la tienda
  // no publicó el selector. 422 y no 403: no es un problema de identidad del
  // comprador — ningún comprador puede elegir presentación mientras el comercio
  // tenga la capacidad apagada.
  ECOM_SALE_UNIT_001: {
    code: 'ECOM_SALE_UNIT_001',
    httpStatus: 422,
    devMessage:
      'Esta tienda no permite elegir la presentación de venta del producto',
  },

  // Support
  SUP_TICKET_001: {
    code: 'SUP_TICKET_001',
    httpStatus: 404,
    devMessage:
      'No encontramos esta solicitud. Es posible que haya sido eliminada o que el enlace sea incorrecto.',
  },
  SUP_COMMENT_001: {
    code: 'SUP_COMMENT_001',
    httpStatus: 404,
    devMessage:
      'No encontramos este comentario. Es posible que haya sido eliminado.',
  },
  SUP_COMMENT_002: {
    code: 'SUP_COMMENT_002',
    httpStatus: 403,
    devMessage:
      'Solo el autor del comentario puede editarlo. Si necesitas corregir algo, responde con un nuevo comentario.',
  },
  SUP_COMMENT_003: {
    code: 'SUP_COMMENT_003',
    httpStatus: 403,
    devMessage:
      'Este comentario ya fue enviado al solicitante, así que no se puede editar para mantener la coherencia con el correo original. Responde con un nuevo comentario si necesitas agregar algo.',
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
  SUP_PQR_001: {
    code: 'SUP_PQR_001',
    httpStatus: 500,
    devMessage:
      'Falta la organización plataforma de PQRS en la base de datos. Ejecuta los seeders para configurarla.',
  },
  SUP_PQR_002: {
    code: 'SUP_PQR_002',
    httpStatus: 500,
    devMessage:
      'Falta el usuario anónimo de PQRS en la base de datos. Ejecuta los seeders para configurarlo.',
  },
  SUP_PQR_003: {
    code: 'SUP_PQR_003',
    httpStatus: 404,
    devMessage:
      'No encontramos esta solicitud. Es posible que haya sido eliminada o que el enlace sea incorrecto.',
  },
  SUP_PQR_004: {
    code: 'SUP_PQR_004',
    httpStatus: 403,
    devMessage:
      'No tienes permisos para acceder a esta solicitud. Verifica que pertenezca a tu tienda u organización.',
  },
  SUP_PQR_005: {
    code: 'SUP_PQR_005',
    httpStatus: 429,
    devMessage:
      'Has enviado demasiadas solicitudes en poco tiempo. Espera unos minutos antes de intentar de nuevo.',
  },
  SUP_PQR_006: {
    code: 'SUP_PQR_006',
    httpStatus: 400,
    devMessage:
      'No se puede cambiar al estado solicitado desde el estado actual de la solicitud.',
  },
  SUP_PQR_007: {
    code: 'SUP_PQR_007',
    httpStatus: 422,
    devMessage:
      'No pudimos identificar el correo del solicitante en la solicitud. Pídele que registre la solicitud de nuevo con sus datos completos.',
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
  ORG_CONTEXT_002: {
    code: 'ORG_CONTEXT_002',
    httpStatus: 500,
    devMessage:
      'Failed to resolve inventory_mode from organization_settings. Check DB connectivity and that the organization row exists.',
  },
  ORG_USER_001: {
    code: 'ORG_USER_001',
    httpStatus: 404,
    devMessage: 'Organization user not found',
  },
  ORG_USER_002: {
    code: 'ORG_USER_002',
    httpStatus: 409,
    devMessage: 'User with this email already exists',
  },
  ORG_USER_003: {
    code: 'ORG_USER_003',
    httpStatus: 400,
    devMessage: 'Invalid user state for this operation',
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
  ORG_DOMAIN_003: {
    code: 'ORG_DOMAIN_003',
    httpStatus: 422,
    devMessage: 'Hostname is blocked by policy',
  },
  ORG_DOMAIN_004: {
    code: 'ORG_DOMAIN_004',
    httpStatus: 403,
    devMessage: 'Pending domain registration limit exceeded',
  },
  // `organizations.tax_id` is @unique: two tenants cannot claim the same NIT.
  // Surfaced explicitly so the fiscal identity form says "ese NIT ya está
  // registrado" instead of leaking a Prisma P2002 as a 500.
  ORG_TAX_ID_CONFLICT_001: {
    code: 'ORG_TAX_ID_CONFLICT_001',
    httpStatus: 409,
    devMessage: 'Another organization is already registered with this NIT',
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

  // Marketing
  MKT_AD_STORAGE_001: {
    code: 'MKT_AD_STORAGE_001',
    httpStatus: 503,
    devMessage: 'Marketing ad creatives storage is not available',
  },
  MKT_AD_RATE_LIMIT_001: {
    code: 'MKT_AD_RATE_LIMIT_001',
    httpStatus: 429,
    devMessage: 'Daily marketing ad generation limit reached',
  },
  MKT_AD_RATE_LIMIT_002: {
    code: 'MKT_AD_RATE_LIMIT_002',
    httpStatus: 503,
    devMessage: 'Marketing ad generation rate limit is not available',
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
  PROD_BARCODE_DUP_001: {
    code: 'PROD_BARCODE_DUP_001',
    httpStatus: 409,
    devMessage: 'El código de barras ya está en uso en esta tienda',
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
  PROD_VALIDATE_004: {
    code: 'PROD_VALIDATE_004',
    httpStatus: 400,
    devMessage:
      'Los campos específicos de servicio solo pueden asignarse en variantes de productos tipo SERVICIO',
  },

  // Product/Service & Variants Validation
  PROD_SVC_VARIANTS_001: {
    code: 'PROD_SVC_VARIANTS_001',
    httpStatus: 400,
    devMessage: 'Los productos tipo SERVICIO no pueden tener variantes',
  },
  PROD_SVC_HAS_VARIANTS_001: {
    code: 'PROD_SVC_HAS_VARIANTS_001',
    httpStatus: 409,
    devMessage:
      'No se puede cambiar a SERVICE un producto con variantes existentes',
  },
  PROD_TRACKING_CHANGE_001: {
    code: 'PROD_TRACKING_CHANGE_001',
    httpStatus: 400,
    devMessage:
      'Cambiar track_inventory con variantes requiere stock_transfer_mode',
  },
  PROD_SALE_PRICE_001: {
    code: 'PROD_SALE_PRICE_001',
    httpStatus: 400,
    devMessage:
      'sale_price inválido: debe ser > 0 y < base_price cuando is_on_sale=true',
  },
  PROD_VAR_SALE_PRICE_001: {
    code: 'PROD_VAR_SALE_PRICE_001',
    httpStatus: 400,
    devMessage:
      'sale_price de variante inválido: debe ser > 0 y < precio de referencia',
  },
  PROD_VAR_PRICE_001: {
    code: 'PROD_VAR_PRICE_001',
    httpStatus: 400,
    devMessage: 'price_override de variante debe ser null o mayor que 0',
  },
  PROD_VAR_REMOVE_001: {
    code: 'PROD_VAR_REMOVE_001',
    httpStatus: 400,
    devMessage:
      'Eliminar variantes con stock requiere variant_removal_stock_mode',
  },
  PROD_HAS_RESERVATIONS_001: {
    code: 'PROD_HAS_RESERVATIONS_001',
    httpStatus: 409,
    devMessage: 'Operación bloqueada: existen reservas de stock activas',
  },
  /**
   * Borrar una variante reasigna su histórico al producto base y elimina sus
   * filas de `stock_levels`. Con existencias vivas eso DESTRUYE inventario sin
   * dejar ni ajuste ni movimiento que lo explique. La guarda previa sólo miraba
   * reservas activas —que son un subconjunto—, así que una variante con 40
   * unidades y ninguna reserva se borraba sin fricción.
   */
  PROD_VARIANT_HAS_STOCK_001: {
    code: 'PROD_VARIANT_HAS_STOCK_001',
    httpStatus: 409,
    devMessage:
      'Operación bloqueada: la variante tiene existencias. Ajusta el stock a 0 antes de eliminarla.',
  },
  PROD_SKU_COLLISION_001: {
    code: 'PROD_SKU_COLLISION_001',
    httpStatus: 409,
    devMessage: 'SKU colisiona con SKU de variante en la misma tienda',
  },
  INV_VARIANT_TRACKING_001: {
    code: 'INV_VARIANT_TRACKING_001',
    httpStatus: 400,
    devMessage: 'track_inventory_override inválido',
  },

  /**
   * `products.account_code` / `product_variants.account_code` — subcuenta PUC de
   * ingreso escrita a mano sobre el catálogo.
   *
   * Hasta aquí sólo se validaba la FORMA (`PUC_ACCOUNT_CODE_REGEX`: 4-20
   * dígitos). Un código con forma válida pero que no existe en el
   * `chart_of_accounts` de la organización se guardaba sin queja y, al facturar,
   * `AutoEntryService.resolveInvoiceRevenueLines()` lo descartaba y acreditaba
   * la cuenta de ingreso POR DEFECTO dejando sólo un `logger.warn`. El
   * comerciante creía tener su venta separada en una subcuenta y su contabilidad
   * decía otra cosa, sin ningún síntoma visible.
   *
   * Los tres casos van separados porque exigen acciones distintas del usuario:
   * crear la cuenta, activarla, o bajar a una subcuenta hija. 400 y no 422 para
   * alinear con el resto del bloque `PROD_*`: el frontend discrimina por
   * `error_code`, no por status.
   */
  PROD_ACCOUNT_CODE_NOT_FOUND_001: {
    code: 'PROD_ACCOUNT_CODE_NOT_FOUND_001',
    httpStatus: 400,
    devMessage:
      'La cuenta contable indicada no existe en el plan de cuentas (PUC) de esta organización',
  },
  PROD_ACCOUNT_CODE_INACTIVE_001: {
    code: 'PROD_ACCOUNT_CODE_INACTIVE_001',
    httpStatus: 400,
    devMessage:
      'La cuenta contable indicada está inactiva y no puede recibir movimientos',
  },
  PROD_ACCOUNT_CODE_NOT_POSTABLE_001: {
    code: 'PROD_ACCOUNT_CODE_NOT_POSTABLE_001',
    httpStatus: 400,
    devMessage:
      'La cuenta contable indicada es de agrupación y no admite movimientos; se requiere una subcuenta',
  },

  // Quotations
  QUOTE_CONVERT_STATUS_001: {
    code: 'QUOTE_CONVERT_STATUS_001',
    httpStatus: 400,
    devMessage: 'Quotation must be accepted before conversion',
  },
  QUOTE_CONVERT_CUSTOMER_001: {
    code: 'QUOTE_CONVERT_CUSTOMER_001',
    httpStatus: 400,
    devMessage: 'Quotation must have a customer before conversion',
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
  ORD_SHIP_REQUIRED_001: {
    code: 'ORD_SHIP_REQUIRED_001',
    httpStatus: 400,
    devMessage: 'Shipping method is required to ship this order',
  },
  ORD_SHIP_INVALID_METHOD_001: {
    code: 'ORD_SHIP_INVALID_METHOD_001',
    httpStatus: 400,
    devMessage: 'Invalid or inactive shipping method',
  },
  ORD_SHIP_RATE_MISMATCH_001: {
    code: 'ORD_SHIP_RATE_MISMATCH_001',
    httpStatus: 400,
    devMessage: 'Shipping rate does not belong to the selected method',
  },
  // Impresión masiva (QUI-599). El bulk print es tolerante por diseño: omite
  // las órdenes no imprimibles y sigue con el resto. Este código solo se lanza
  // cuando NO queda ninguna orden imprimible en la selección — devolver un PDF
  // en blanco en ese caso le miente al operador.
  ORD_BULK_PRINT_001: {
    code: 'ORD_BULK_PRINT_001',
    httpStatus: 400,
    devMessage: 'No printable orders in the selection (all skipped)',
  },

  // Purchase Orders
  // QUI-486: comprar/recibir contra la línea base (product_variant_id = NULL)
  // de un producto que TIENE variantes recibe mercancía a un limbo contable.
  // enforceStockLevelsMode borra las filas base de stock_levels en cuanto el
  // producto tiene variantes (invariante base XOR variante), pero
  // getOrCreateStockLevel la vuelve a crear al recibir — y syncProductStock
  // filtra `product_variant_id: { not: null }` cuando hay variantes, así que
  // esas unidades quedan en una fila que NINGÚN agregado lee: no aparecen en
  // products.stock_quantity, no se pueden vender, y el dinero ya se gastó.
  // Se rechaza aguas arriba en vez de recibir stock invisible.
  PO_VARIANT_001: {
    code: 'PO_VARIANT_001',
    httpStatus: 400,
    devMessage:
      'Un producto con variantes debe comprarse por variante, no contra su línea base',
  },

  // Ciclo de vida de la orden de compra.
  // El estado vive en `PurchaseOrdersService.VALID_TRANSITIONS`; estos códigos
  // son la cara HTTP de esa única fuente de la verdad. Son 409 y no 400 porque
  // la petición está bien formada: choca con el estado real del recurso.
  PO_STATUS_001: {
    code: 'PO_STATUS_001',
    httpStatus: 409,
    devMessage:
      'Transición de estado no permitida para esta orden de compra',
  },
  PO_STATUS_002: {
    code: 'PO_STATUS_002',
    httpStatus: 409,
    devMessage:
      'Solo una orden de compra en borrador puede editarse o eliminarse',
  },
  // Cancelar una OC con mercancía ya ingresada exigiría deshacer capas de costeo
  // FIFO, asientos automáticos e IVA descontable ya reconocido. Ese trabajo es
  // del módulo de devoluciones (`return_order_type_enum.purchase_return`), así
  // que aquí se bloquea y se nombra el camino correcto.
  PO_CANCEL_RECEIVED_001: {
    code: 'PO_CANCEL_RECEIVED_001',
    httpStatus: 409,
    devMessage:
      'Una orden con mercancía recibida se revierte con una devolución a proveedor, no cancelándola',
  },
  PO_FIND_001: {
    code: 'PO_FIND_001',
    httpStatus: 404,
    devMessage: 'Orden de compra no encontrada',
  },

  // QUI-647 — plan de pago al crear la OC. Red final del wizard: el frontend
  // valida inline, pero estos códigos son la cara HTTP cuando un request
  // inválido llega por API directa. Reemplazan los BadRequestException de
  // texto suelto que existían antes del ticket.
  PO_PAYMENT_001: {
    code: 'PO_PAYMENT_001',
    httpStatus: 400,
    devMessage: 'Un abono parcial requiere un monto abonado mayor que cero',
  },
  PO_PAYMENT_002: {
    code: 'PO_PAYMENT_002',
    httpStatus: 400,
    devMessage: 'El abono no puede superar el total de la orden',
  },
  PO_PAYMENT_003: {
    code: 'PO_PAYMENT_003',
    httpStatus: 400,
    devMessage: 'Un pago diferido requiere una fecha de pago',
  },
  PO_PAYMENT_004: {
    code: 'PO_PAYMENT_004',
    httpStatus: 400,
    devMessage: 'La fecha de pago no puede ser anterior a hoy',
  },
  PO_PAYMENT_005: {
    code: 'PO_PAYMENT_005',
    httpStatus: 400,
    devMessage: 'Las cuotas programadas deben sumar el saldo de la orden',
  },
  PO_PAYMENT_006: {
    code: 'PO_PAYMENT_006',
    httpStatus: 400,
    devMessage:
      'El calendario de cuotas requiere al menos una cuota con monto mayor que cero',
  },
  // CP-ID-VNDX-2026-08-18-PO-PROD — ADR-001: sort_by cerrado en PO List.
  // Antes el DTO aceptaba cualquier string y el cliente podía inyectar columnas
  // Prisma inexistentes (`?sort_by=next_payment_date`) que reventaban la query
  // como 500 silencioso. El enum cerrado lo bloquea en validación.
  PO_INVALID_SORT_BY: {
    code: 'PO_INVALID_SORT_BY',
    httpStatus: 400,
    devMessage:
      'El parámetro sort_by no es válido. Usa: order_date, next_payment_date, supplier_name, total o status',
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
  INV_STOCK_002: {
    code: 'INV_STOCK_002',
    httpStatus: 409,
    devMessage:
      'Insufficient available stock to deliver order (no reservation and available stock is not enough)',
  },
  POS_STOCK_INSUFFICIENT_001: {
    code: 'POS_STOCK_INSUFFICIENT_001',
    httpStatus: 409,
    devMessage: 'Stock insuficiente para una o más líneas del POS',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — gate obligatorio de cliente en POS.
  // Política canónica: `settings.checkout.require_customer_data=true`. Una orden
  // POS sin cliente queda huérfana y no se puede cobrar, facturar ni atender
  // soporte. Se valida en backend ANTES de abrir la transacción de pago.
  POS_CUSTOMER_REQUIRED_001: {
    code: 'POS_CUSTOMER_REQUIRED_001',
    httpStatus: 422,
    devMessage:
      'POS order requires a valid customer_id when checkout.require_customer_data is enabled',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — invariante draft/payment. `is_draft=true`
  // significa "guardar orden pendiente de cobro"; combinarlo con `requires_payment=true`
  // es contradictorio y debe rechazarse antes de tomar numeración o escribir pagos.
  POS_DRAFT_REQUIRES_PAYMENT_001: {
    code: 'POS_DRAFT_REQUIRES_PAYMENT_001',
    httpStatus: 409,
    devMessage:
      'A draft (is_draft=true) cannot be combined with requires_payment=true; save the order first, then charge it via flow/pay',
  },
  // CP-POS-SVC-PERF-001 / C.4 hardening — atomic booking requires a
  // customer. `bookings.customer_id` is NOT NULL in the schema; an
  // anonymous order carrying a `booking` block would violate FK and
  // surface as a raw 500. We reject explicitly with 422.
  POS_BOOKING_REQUIRES_CUSTOMER: {
    code: 'POS_BOOKING_REQUIRES_CUSTOMER',
    httpStatus: 422,
    devMessage:
      'Booking a service in the editor requires a customer to be assigned to the order; `bookings.customer_id` is NOT NULL.',
  },
  // CP-POS-SVC-PERF-001 / C.4 hardening — booking payload missing
  // required fields (date, start_time, end_time). Silent skip would
  // leave a service line without a reservation, breaking the order
  // detail "Citas agendadas" section.
  POS_BOOKING_INVALID: {
    code: 'POS_BOOKING_INVALID',
    httpStatus: 422,
    devMessage:
      'Service booking block must include `date` (YYYY-MM-DD), `start_time` and `end_time` (HH:mm).',
  },
  // CP-POS-SVC-PERF-001 / C.4 hardening — booking_id from the cashier
  // doesn't belong to this order (or another tenant). Refuse cross-tenant
  // updates at the service boundary.
  POS_BOOKING_NOT_FOUND: {
    code: 'POS_BOOKING_NOT_FOUND',
    httpStatus: 404,
    devMessage:
      'The booking_id provided does not belong to this order / store.',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — race en editor. Otro operador cambió la
  // orden de `created`/`draft` mientras editábamos. 409 porque la petición está
  // bien formada; lo que cambió es el estado del recurso.
  ORD_EDIT_STATE_CHANGED_001: {
    code: 'ORD_EDIT_STATE_CHANGED_001',
    httpStatus: 409,
    devMessage:
      'Order state changed while it was being edited; refresh and retry',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — la orden ya no es editable (pending, finished,
  // cancelled, refunded…). El editor no debe ni siquiera cargarla.
  ORD_EDIT_NOT_ALLOWED_001: {
    code: 'ORD_EDIT_NOT_ALLOWED_001',
    httpStatus: 409,
    devMessage:
      'This order is no longer in an editable state (created/draft required)',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — el customer_id que manda el frontend no
  // pertenece a la tienda del contexto. 403 (no es problema de autenticación, es
  // de scope/tenant).
  ORD_EDIT_CUSTOMER_STORE_MISMATCH_001: {
    code: 'ORD_EDIT_CUSTOMER_STORE_MISMATCH_001',
    httpStatus: 403,
    devMessage: 'The selected customer does not belong to the current store',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — dirección/método/rate de envío inválidos,
  // método inactivo, rate no pertenece al método, o costo negativo.
  ORD_EDIT_INVALID_SHIPPING_001: {
    code: 'ORD_EDIT_INVALID_SHIPPING_001',
    httpStatus: 422,
    devMessage:
      'Shipping address, method, rate or cost is invalid for the current order',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — claim atómico del estado de la orden
  // perdió la carrera. Diferente de ORD_EDIT_STATE_CHANGED_001: aquí no sabemos
  // cuál fue el estado final, sólo que la transición atómica no se aplicó.
  ORD_EDIT_INVALID_STATE_001: {
    code: 'ORD_EDIT_INVALID_STATE_001',
    httpStatus: 409,
    devMessage: 'Order could not be claimed for editing; reload and try again',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — promoción o cupón seleccionado ya no aplica
  // al carrito editado. 422 porque la petición está bien formada; lo que cambió
  // es la elegibilidad del descuento.
  ORD_EDIT_PROMOTION_INVALID_001: {
    code: 'ORD_EDIT_PROMOTION_INVALID_001',
    httpStatus: 422,
    devMessage:
      'Selected promotion or coupon no longer applies to the edited order',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — race al confirmar el cupón en el cobro.
  // El cupón ya fue consumido por otro cargo concurrente y no debe duplicarse.
  ORD_EDIT_COUPON_COMMIT_001: {
    code: 'ORD_EDIT_COUPON_COMMIT_001',
    httpStatus: 409,
    devMessage:
      'Coupon could not be committed; it may have been consumed by a concurrent charge',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — el servicio detectó que la fila persistida
  // difiere de la respuesta autoritativa. Nunca devolver éxito falso.
  ORD_EDIT_RESPONSE_MISMATCH_001: {
    code: 'ORD_EDIT_RESPONSE_MISMATCH_001',
    httpStatus: 500,
    devMessage:
      'Order was persisted but the response payload does not match the stored row; refresh and verify',
  },
  // CP-POS-CREAR-EDITAR-COBRAR-001 — el cobro canónico (flow/pay) falló por
  // estado, monto o condición pendiente. La orden sigue lista para pagar.
  ORD_FLOW_PAYMENT_FAILED_001: {
    code: 'ORD_FLOW_PAYMENT_FAILED_001',
    httpStatus: 409,
    devMessage:
      'Order payment could not be processed; the order remains ready-to-pay',
  },
  // CP-POS-MODAL-SCOPE-001 / Phase C.4 — edit→pay sin cliente cuando el escape
  // hatch está apagado. 409: el cashier debe seleccionar cliente (vía
  // Actualizar) antes de cobrar.
  ORD_EDIT_PAY_NOT_ALLOWED_001: {
    code: 'ORD_EDIT_PAY_NOT_ALLOWED_001',
    httpStatus: 409,
    devMessage:
      'Order cannot be paid: customer is required and pos.allow_anonymous_sales is disabled',
  },
  INV_LOC_001: {
    code: 'INV_LOC_001',
    httpStatus: 404,
    devMessage: 'Location not found',
  },
  INV_MOVEMENT_LOCATION_001: {
    code: 'INV_MOVEMENT_LOCATION_001',
    httpStatus: 400,
    devMessage:
      'Movement is missing the location leg its type requires (stock_in/return need to_location_id; stock_out/damage/expiration/adjustment need from_location_id; transfer needs both)',
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
  INV_LOCATION_NOT_IN_STORE: {
    code: 'INV_LOCATION_NOT_IN_STORE',
    httpStatus: 403,
    devMessage:
      'Inventory location does not belong to the current store (independent inventory_mode)',
  },
  INV_LOCATION_NOT_IN_ORG: {
    code: 'INV_LOCATION_NOT_IN_ORG',
    httpStatus: 403,
    devMessage:
      'Inventory location does not belong to the current organization',
  },
  INV_DEFAULT_LOCATION_DELETE_BLOCKED: {
    code: 'INV_DEFAULT_LOCATION_DELETE_BLOCKED',
    httpStatus: 409,
    devMessage: 'Cannot delete a location that is set as store default',
  },
  INV_NO_DEFAULT_LOCATION: {
    code: 'INV_NO_DEFAULT_LOCATION',
    httpStatus: 409,
    devMessage:
      'Store has no default inventory location configured; cannot infer location_id',
  },
  INV_SESSION_CLOSED: {
    code: 'INV_SESSION_CLOSED',
    httpStatus: 409,
    devMessage:
      'Cash register session is not open; cannot resolve sale location from it',
  },
  INV_SESSION_STORE_MISMATCH: {
    code: 'INV_SESSION_STORE_MISMATCH',
    httpStatus: 403,
    devMessage: 'Cash register session does not belong to the current store',
  },
  INV_CROSS_STORE_TRANSFER_FORBIDDEN: {
    code: 'INV_CROSS_STORE_TRANSFER_FORBIDDEN',
    httpStatus: 403,
    devMessage:
      'Cross-store transfers are not allowed in independent inventory mode',
  },
  INV_CROSS_STORE_TRANSFER_PERMISSION: {
    code: 'INV_CROSS_STORE_TRANSFER_PERMISSION',
    httpStatus: 403,
    devMessage:
      'User lacks permission to create/approve cross-store inventory transfers',
  },
  INV_MODE_CHANGE_BLOCKED_BY_TRANSFERS: {
    code: 'INV_MODE_CHANGE_BLOCKED_BY_TRANSFERS',
    httpStatus: 409,
    devMessage:
      'No se puede cambiar a modo independent con transferencias cross-store abiertas',
  },
  INV_MODE_CHANGE_BLOCKED_BY_ORPHAN_LOCATIONS: {
    code: 'INV_MODE_CHANGE_BLOCKED_BY_ORPHAN_LOCATIONS',
    httpStatus: 409,
    devMessage:
      'No se puede cambiar a modo independent con bodegas org-wide (store_id=null) sin asignar a tienda',
  },
  INV_TRANSFER_VALIDATE_001: {
    code: 'INV_TRANSFER_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Source and destination locations must be different',
  },
  INV_TRANSFER_STOCK_001: {
    code: 'INV_TRANSFER_STOCK_001',
    httpStatus: 400,
    devMessage: 'Insufficient stock at source location for one or more items',
  },
  INV_TRANSFER_STATUS_001: {
    code: 'INV_TRANSFER_STATUS_001',
    httpStatus: 400,
    devMessage: 'Invalid transfer state transition',
  },
  INV_TRANSFER_FIND_001: {
    code: 'INV_TRANSFER_FIND_001',
    httpStatus: 404,
    devMessage: 'Stock transfer not found',
  },

  // Serial number tracking (QUI-431)
  SERIAL_REQUIRED_001: {
    code: 'SERIAL_REQUIRED_001',
    httpStatus: 400,
    devMessage:
      'This product requires serial numbers; the provided serials do not match the requested quantity',
  },
  SERIAL_PARITY_001: {
    code: 'SERIAL_PARITY_001',
    httpStatus: 409,
    devMessage:
      'Serial number parity violation: in-stock serial count does not match stock on hand for this product/location',
  },
  SERIAL_DUP_001: {
    code: 'SERIAL_DUP_001',
    httpStatus: 409,
    devMessage:
      'Serial number already committed to this document type (duplicate sale detected)',
  },
  SERIAL_DELETE_BLOCKED_409: {
    code: 'SERIAL_DELETE_BLOCKED_409',
    httpStatus: 409,
    devMessage:
      'Cannot delete this serial: it is not in_stock or it is already linked to a sales/dispatch document',
  },

  // Cash Registers
  CR_FIND_001: {
    code: 'CR_FIND_001',
    httpStatus: 404,
    devMessage: 'Cash register not found',
  },
  CR_DUP_001: {
    code: 'CR_DUP_001',
    httpStatus: 409,
    devMessage: 'A cash register with this code already exists',
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
  // QUI-728 — DIAN Anexo Técnico 19 customer fiscal data: reason-social,
  // NIT DV, and RUT responsabilidad validation. Surfaced explicitly so the
  // frontend can map these to inline form errors without leaking a Prisma
  // P2002 / generic 400.
  CUSTOMER_LEGAL_NAME_REQUIRED: {
    code: 'CUSTOMER_LEGAL_NAME_REQUIRED',
    httpStatus: 400,
    devMessage:
      'La razón social es obligatoria cuando el tipo de persona es JURIDICA',
  },
  CUSTOMER_NIT_DV_MISMATCH: {
    code: 'CUSTOMER_NIT_DV_MISMATCH',
    httpStatus: 400,
    devMessage: 'El dígito de verificación no corresponde al NIT digitado',
  },
  CUSTOMER_INVALID_FISCAL_RESPONSIBILITY: {
    code: 'CUSTOMER_INVALID_FISCAL_RESPONSIBILITY',
    httpStatus: 400,
    devMessage: 'fiscal_responsibilities contiene códigos fuera del catálogo RUT',
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
  CAT_DELETE_HAS_PRODUCTS: {
    code: 'CAT_DELETE_HAS_PRODUCTS',
    httpStatus: 409,
    devMessage: 'Category has assigned products',
  },
  BRAND_FIND_001: {
    code: 'BRAND_FIND_001',
    httpStatus: 404,
    devMessage: 'Brand not found',
  },
  BRAND_DELETE_HAS_PRODUCTS: {
    code: 'BRAND_DELETE_HAS_PRODUCTS',
    httpStatus: 409,
    devMessage: 'Brand has assigned products',
  },
  SUPPLIER_FIND_001: {
    code: 'SUPPLIER_FIND_001',
    httpStatus: 404,
    devMessage: 'Supplier not found',
  },
  SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS: {
    code: 'SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS',
    httpStatus: 409,
    devMessage:
      'Supplier has open purchase orders, payables or dispatch notes',
  },
  SUPPLIER_STATE_INVALID_TRANSITION: {
    code: 'SUPPLIER_STATE_INVALID_TRANSITION',
    httpStatus: 400,
    devMessage:
      'Supplier state transition not allowed; archiving goes through DELETE',
  },
  CAT_NAME_EXISTS_001: {
    code: 'CAT_NAME_EXISTS_001',
    httpStatus: 409,
    devMessage: 'Category name/slug already exists in this store',
  },
  BRAND_NAME_EXISTS_001: {
    code: 'BRAND_NAME_EXISTS_001',
    httpStatus: 409,
    devMessage: 'Brand name/slug already exists in this store',
  },

  // Media uploads (shared)
  MEDIA_FILE_REQUIRED_001: {
    code: 'MEDIA_FILE_REQUIRED_001',
    httpStatus: 400,
    devMessage: 'File is required',
  },
  MEDIA_FILE_TYPE_001: {
    code: 'MEDIA_FILE_TYPE_001',
    httpStatus: 400,
    devMessage: 'Only image files are allowed',
  },
  MEDIA_UPLOAD_FAILED_001: {
    code: 'MEDIA_UPLOAD_FAILED_001',
    httpStatus: 400,
    devMessage: 'Error uploading file',
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
  AI_CONFIG_003: {
    code: 'AI_CONFIG_003',
    httpStatus: 400,
    devMessage:
      'Only a text configuration can be the default provider: the default is ' +
      'global and does not discriminate by model_type, so every application ' +
      'with no explicit config would resolve to a model that cannot serve it',
  },

  // Vexi pipeline voice mode (STT -> chat agent -> TTS). Kept separate from the
  // document scanners' codes because the surfaces fail for different reasons and
  // the client reacts differently: a rejected audio container is a recording
  // problem the user can retry, a scanner rejection is a file choice.
  VEXI_VOICE_NO_AUDIO: {
    code: 'VEXI_VOICE_NO_AUDIO',
    httpStatus: 400,
    devMessage: 'No audio was received for the voice turn',
  },
  VEXI_VOICE_INVALID_AUDIO: {
    code: 'VEXI_VOICE_INVALID_AUDIO',
    httpStatus: 400,
    devMessage:
      'Unsupported audio container — the transcription endpoint sniffs the ' +
      'filename extension to pick a decoder, so an unrecognized container is ' +
      'refused here rather than forwarded',
  },
  VEXI_VOICE_TOO_LARGE: {
    code: 'VEXI_VOICE_TOO_LARGE',
    httpStatus: 413,
    devMessage: 'The voice turn audio exceeds the allowed size',
  },
  VEXI_VOICE_TRANSCRIBE_FAILED: {
    code: 'VEXI_VOICE_TRANSCRIBE_FAILED',
    httpStatus: 502,
    devMessage: 'The transcription provider did not return text',
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
  // A vision app with a NULL config_id silently falls through to the default
  // text config, which answers without seeing the image. For fiscal scanners a
  // plausible invented value is worse than a failure, so it is refused up front.
  AI_VISION_001: {
    code: 'AI_VISION_001',
    httpStatus: 409,
    devMessage:
      'This scanner has no vision model linked; link one in the AI panel before scanning documents',
  },
  AI_APP_004: {
    code: 'AI_APP_004',
    httpStatus: 429,
    devMessage: 'AI application rate limit exceeded',
  },
  AI_APP_005: {
    code: 'AI_APP_005',
    httpStatus: 400,
    devMessage: 'Config model_type does not match app model_type',
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
  /**
   * El documento de origen YA TIENE una factura viva.
   *
   * 409 y no 400: la petición está bien formada, lo que está mal es el estado
   * del recurso. El cliente no tiene nada que corregir en el cuerpo — tiene que
   * mirar la factura que ya existe.
   *
   * Existe porque `createFromOrder` / `createFromSalesOrder` NO tenían guarda:
   * iban derecho a `generateNextNumber()`, que toma el consecutivo autorizado
   * bajo `pg_advisory_xact_lock` e incrementa `current_number` en el acto. Dos
   * clics en «Emitir factura electrónica» —o un botón que nunca se esconde
   * porque su predicado leía un campo que la proyección no trae— quemaban
   * numeración autorizada de la DIAN por cada intento, y esa numeración no se
   * recupera.
   *
   * `details.invoice_id` / `details.invoice_number` viajan para que la UI pueda
   * enlazar la factura existente en vez de dejar al usuario en un callejón.
   */
  INVOICING_CREATE_002: {
    code: 'INVOICING_CREATE_002',
    httpStatus: 409,
    devMessage: 'Source document already has a live invoice',
  },
  /**
   * El pedido de venta no puede facturarse porque no lleva desglose de
   * impuestos.
   *
   * `sales_order_items` no tiene columna de impuesto ni tabla hermana
   * equivalente a `order_item_taxes`, y `products` no enlaza una `tax_rates`.
   * La ruta emitía todas las líneas con `tax = 0`: una factura con IVA cero,
   * `ValImp1` incorrecto DENTRO del hash CUFE —que la DIAN recomputa desde el
   * XML— y rechazo por la regla aritmética, después de haber quemado el
   * consecutivo.
   *
   * Se rechaza ANTES de tomar numeración. Cuando exista el módulo de pedidos de
   * venta con su desglose tributario, esta guarda se retira.
   */
  INVOICING_CREATE_003: {
    code: 'INVOICING_CREATE_003',
    httpStatus: 422,
    devMessage: 'Sales orders carry no tax breakdown; cannot be invoiced',
  },
  /**
   * El área fiscal «invoicing» está inactiva para el tenant.
   *
   * Las dos compuertas de abajo lanzaban `ForbiddenException` a secas. Un 403
   * sin `error_code` deja a `parseApiError` sin nada que mapear —devuelve
   * `DEFAULT_ERROR_MESSAGE`— y el mensaje en español que el backend ya había
   * escrito no llegaba nunca a la pantalla: el comerciante veía «Ocurrió un
   * error» en lugar de «completa el set de pruebas y activa producción».
   *
   * Es el defecto §C.1 #6 del plan, aplicado a la puerta que MÁS se dispara.
   */
  INVOICING_AREA_001: {
    code: 'INVOICING_AREA_001',
    httpStatus: 403,
    devMessage: 'Fiscal area "invoicing" is inactive for this tenant',
  },
  /**
   * El tenant configuró facturación electrónica pero su habilitación no está
   * viva (ambiente ≠ producción o `enablement_status` ≠ `enabled`).
   *
   * Separado de `INVOICING_AREA_001` porque la acción correctiva es distinta:
   * allá se activa el área fiscal, acá se termina el set de pruebas ante la
   * DIAN. Un solo código obligaría a un mensaje que no sirve para ninguno.
   */
  INVOICING_ENABLEMENT_001: {
    code: 'INVOICING_ENABLEMENT_001',
    httpStatus: 403,
    devMessage: 'DIAN enablement is not live (production + enabled) yet',
  },
  INVOICING_DOCUMENT_TYPE_UNSUPPORTED_V1: {
    code: 'INVOICING_DOCUMENT_TYPE_UNSUPPORTED_V1',
    httpStatus: 501,
    devMessage: 'Document type not supported in V1 of the platform invoicing MVP',
  },
  INVOICING_TRANSITION_001: {
    code: 'INVOICING_TRANSITION_001',
    httpStatus: 409,
    devMessage: 'Cannot cancel a transmission in its current state',
  },
  PDF_NOT_READY: {
    code: 'PDF_NOT_READY',
    httpStatus: 503,
    devMessage: 'PDF generation pipeline not yet wired (phase B.5)',
  },
  INVOICING_PLATFORM_READINESS_001: {
    code: 'INVOICING_PLATFORM_READINESS_001',
    httpStatus: 409,
    devMessage: 'Platform invoice transmission has no fiscal number assigned',
  },
  INVOICING_PLATFORM_READINESS_002: {
    code: 'INVOICING_PLATFORM_READINESS_002',
    httpStatus: 409,
    devMessage: 'Platform invoice not yet emitted to DIAN (no CUFE)',
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
  INVOICING_RESOLUTION_003: {
    code: 'INVOICING_RESOLUTION_003',
    httpStatus: 409,
    devMessage:
      'Resolution has issued documents and cannot be deleted; deactivate it instead',
  },
  INVOICING_RESOLUTION_004: {
    code: 'INVOICING_RESOLUTION_004',
    httpStatus: 409,
    devMessage:
      'Resolution is referenced by the active fiscal configuration; point the configuration elsewhere first',
  },
  INVOICING_RESOLUTION_005: {
    code: 'INVOICING_RESOLUTION_005',
    httpStatus: 400,
    devMessage:
      'Resolution field is immutable once DIAN numbers have been consumed',
  },
  INVOICING_RESOLUTION_006: {
    code: 'INVOICING_RESOLUTION_006',
    httpStatus: 409,
    devMessage:
      'Platform fiscal identity has no active accounting entity; a resolution cannot be scoped without one',
  },
  INVOICING_RESOLUTION_007: {
    code: 'INVOICING_RESOLUTION_007',
    httpStatus: 409,
    devMessage:
      'An active resolution with the same prefix and document type already exists for this accounting entity',
  },
  /**
   * The resolution contradicts what `FISCAL_DOCUMENT_REQUIREMENTS` declares for
   * its `document_type`: a missing DIAN authorization number, a missing ClTec on
   * the sales invoice, or — the dangerous one — a ClTec stored on a document
   * whose key is built with the Software-PIN. That last case is not cosmetic:
   * `invoice-flow.service.ts` injects `resolution.technical_key` for every type
   * and `dian-direct.provider.ts` prefers it over `config.software_pin`, so the
   * CUDS/CUDE gets signed with the wrong 14th field, the DIAN rejects the
   * document and the authorized consecutive it consumed is gone for good.
   * 422 rather than 400: the payload is well-formed, the fiscal combination is not.
   */
  INVOICING_RESOLUTION_008: {
    code: 'INVOICING_RESOLUTION_008',
    httpStatus: 422,
    devMessage:
      'Resolution contradicts the DIAN requirements declared for its fiscal document type',
  },
  INVOICING_RESOLUTION_009: {
    code: 'INVOICING_RESOLUTION_009',
    httpStatus: 400,
    devMessage:
      'Authorized numbering range is incoherent (bounds below 1, inverted, or shrunk under an already consumed number)',
  },
  INVOICING_RESOLUTION_010: {
    code: 'INVOICING_RESOLUTION_010',
    httpStatus: 400,
    devMessage: 'Resolution validity window is inverted or empty',
  },
  /**
   * La clave técnica (ClTec) no tiene la FORMA que emite la DIAN: 40 o 64
   * caracteres hexadecimales, el hex de un SHA-1 o de un SHA-256.
   *
   * Son DOS anchuras exactas, no «lo que diga la DIAN». El servicio de rangos de
   * numeración devuelve la de 64, y darle 40 por única posible rechazaba claves
   * legítimas (FAD06 de HIDRO). Pero la lista sigue cerrada a esas dos: un hash no
   * tiene longitud variable, así que las de 36/38/39 que reportó el mismo
   * contribuyente eran la misma clave con caracteres perdidos al copiarla.
   *
   * No es una validación cosmética — es la que faltaba. En producción se guardó
   * una ClTec de 38 caracteres (todos hex, sin espacios: un par de caracteres
   * perdidos al copiar o al leerla por OCR). Nadie la revisó porque el DTO solo
   * pedía `@IsString() @MaxLength(255)`. El CUFE se calculó con ella, la DIAN lo
   * recomputó con la verdadera, los hashes difirieron y respondió «Valor del CUFE
   * no está calculado correctamente» — con el consecutivo autorizado ya gastado,
   * que es irrecuperable.
   *
   * La ClTec es la única entrada del hash que el XML NO lleva, así que la DIAN es
   * el primer sistema capaz de detectar que está mal. Por eso su forma se valida
   * al ESCRIBIRLA: es la última oportunidad barata.
   *
   * 422 y no 400: el payload está bien formado, el valor fiscal no.
   */
  INVOICING_RESOLUTION_011: {
    code: 'INVOICING_RESOLUTION_011',
    httpStatus: 422,
    devMessage:
      'Technical key (ClTec) must be exactly 40 (SHA-1) or 64 (SHA-256) hexadecimal characters as issued by the DIAN numbering-range web service',
  },
  INVOICING_DUP_001: {
    code: 'INVOICING_DUP_001',
    httpStatus: 409,
    devMessage: 'Duplicate invoice number',
  },
  INVOICING_TENANT_NOT_FOUND: {
    code: 'INVOICING_TENANT_NOT_FOUND',
    httpStatus: 404,
    devMessage:
      'Tenant (store or organization) referenced in the platform invoice request does not exist or does not belong to the platform org',
  },
  INVOICING_TENANT_FISCAL_DATA_INCOMPLETE: {
    code: 'INVOICING_TENANT_FISCAL_DATA_INCOMPLETE',
    httpStatus: 422,
    devMessage:
      'Tenant lacks required fiscal data (legal_name, tax_id, dv, address, regimen, responsabilidades)',
  },
  INVOICING_PROVIDER_001: {
    code: 'INVOICING_PROVIDER_001',
    httpStatus: 502,
    devMessage: 'Invoice provider communication error',
  },
  INVOICING_PROVIDER_002: {
    code: 'INVOICING_PROVIDER_002',
    httpStatus: 412,
    devMessage: 'DIAN own-software fiscal configuration is not enabled',
  },
  INVOICING_PROVIDER_003: {
    code: 'INVOICING_PROVIDER_003',
    httpStatus: 412,
    devMessage: 'DIAN own-software production prerequisites are incomplete',
  },
  INVOICING_PROVIDER_004: {
    code: 'INVOICING_PROVIDER_004',
    httpStatus: 422,
    devMessage: 'Invoice provider rejected the document',
  },
  /**
   * Los campos que se hashearon en el CUFE/CUDE no coinciden con los que quedaron
   * escritos en el XML que se iba a transmitir.
   *
   * La DIAN recomputa la huella LEYENDO EL XML. Si el hash se armó con un valor y
   * el XML declara otro —el NIT del adquiriente con dígito de verificación en un
   * lado y sin él en el otro, el IVA clasificado por nombre acá y por `tax_type`
   * allá, un total que se recalculó después de hashear— el documento se rechaza y
   * el consecutivo autorizado se pierde.
   *
   * Este código existe para que esa divergencia se detecte ANTES de firmar y
   * transmitir, comparando lo hasheado contra el XML ya construido. Es un fallo de
   * coherencia interna, no del contribuyente: `details` nombra el campo divergente
   * y ambos valores para que sea depurable sin leer el XML entero.
   */
  INVOICING_CUFE_001: {
    code: 'INVOICING_CUFE_001',
    httpStatus: 422,
    devMessage:
      'Document key was computed from values that diverge from the built XML; transmission aborted before consuming numbering',
  },
  /**
   * El XML construido no respeta el modelo de contenido de los XSD de la DIAN:
   * un elemento fuera del orden que fija `xsd:sequence`, uno que el tipo no
   * admite, o uno obligatorio que falta.
   *
   * UBL ordena los hijos de cada elemento por secuencia, y ese orden lo sostenían
   * comentarios en los builders, no una compuerta. La consecuencia real fue una
   * familia de defectos silenciosos: `cbc:ID` al final de `cac:Person` en vez de
   * al principio, `cac:Contact` detrás de `cac:Person`, `cbc:DueDate` detrás de
   * `cbc:LineCountNumeric`. Cada uno produce un documento con TODO el contenido
   * correcto que la DIAN rechaza por estructura, con un mensaje que no dice qué
   * elemento sobra ni dónde — y el consecutivo autorizado ya se gastó.
   *
   * Se corta antes de firmar y transmitir: acá no hay nada perdido, el borrador
   * conserva su número y se reemite en cuanto se corrija. `details` nombra la
   * ruta del elemento y qué esperaba el esquema.
   *
   * Es un fallo de coherencia interna del generador, nunca del contribuyente:
   * ningún dato que capture un usuario puede provocarlo.
   */
  INVOICING_XSD_001: {
    code: 'INVOICING_XSD_001',
    httpStatus: 422,
    devMessage:
      'Built XML violates the DIAN UBL content model; transmission aborted before signing',
  },
  /**
   * El XML construido es estructuralmente válido pero su TOTALIZACIÓN no cierra
   * contra las reglas que la DIAN evalúa por XPath.
   *
   * Hermano de `INVOICING_XSD_001` y separado de él a propósito: aquel habla de
   * qué elementos hay y en qué orden; este, de si los importes que declaran se
   * respaldan entre sí. Cubre hoy dos reglas, y las dos se descubrieron con un
   * rechazo real el 17/08/2026 sobre una operación excluida de IVA:
   *
   *  · `FAS01b` — aparece `cac:TaxTotal` sin ningún `cac:TaxSubtotal`. Un ítem
   *    EXCLUIDO (art. 476 ET) no está sujeto y no informa el grupo; un EXENTO
   *    (art. 477 ET) sí lo informa, con `cbc:Percent` en 0,00.
   *  · `FAU04` — `cbc:TaxExclusiveAmount` no iguala la suma de las bases que
   *    declaran las líneas. Una línea que omite su grupo de tributos no aporta
   *    base gravable y no puede sumar en la cabecera.
   *
   * Por qué necesita compuerta propia: el prevalidador de entrada recomputa los
   * importes con las MISMAS funciones que los escriben —deliberadamente, para no
   * aprobar un documento distinto del que viaja—, así que un defecto compartido
   * con el emisor le resulta invisible por construcción. Esta comprobación LEE
   * el XML que se va a transmitir, y por eso sí lo ve.
   *
   * Se corta antes de firmar: la numeración autorizada queda intacta.
   *
   * Es un fallo de coherencia interna del generador, nunca del contribuyente.
   */
  INVOICING_XSD_002: {
    code: 'INVOICING_XSD_002',
    httpStatus: 422,
    devMessage:
      'Built XML fails DIAN totalization rules (FAS01b / FAU04); transmission aborted before signing',
  },
  /**
   * Una línea declara importe de impuesto pero no declara NINGUNA tarifa de la
   * que derivarlo.
   *
   * Desde que el servidor recalcula toda la aritmética (`InvoiceCalculatorService`)
   * el `tax_amount` que manda el cliente es informativo: se contrasta y, si
   * difiere, gana el servidor. Este caso es el único irrecuperable — sin tarifa
   * no hay nada que recalcular, y un importe de impuesto suelto no puede
   * producir un `cac:TaxSubtotal` válido porque la DIAN exige `cbc:Percent` y
   * valida `TaxAmount = TaxableAmount × Percent/100`.
   *
   * Se corta al crear/actualizar, no al emitir: acá todavía no se ha gastado
   * numeración autorizada. `details` nombra la línea y el importe huérfano.
   */
  INVOICING_CALC_001: {
    code: 'INVOICING_CALC_001',
    httpStatus: 422,
    devMessage:
      'Invoice line declares a tax amount without any tax rate to derive it from',
  },
  /**
   * `tax_rate_id` QUE NO EXISTE EN `tax_rates`, O QUE ES DE OTRO TENANT.
   *
   * `invoice_taxes.tax_rate_id` tiene FK a `tax_rates(id)`. Sin esta compuerta,
   * un identificador equivocado sólo se descubría cuando Postgres rechazaba el
   * INSERT — y para entonces `InvoiceNumberGenerator` YA había avanzado
   * `current_number`, así que el error se llevaba por delante un consecutivo
   * autorizado y devolvía un `SYS_INTERNAL_001` sin decir qué campo era.
   *
   * El identificador equivocado no es hipotético: `GET /store/taxes` devuelve
   * `tax_categories` con sus `tax_rates` ANIDADAS, y las dos filas tienen `id`.
   * Mandar el de la categoría en vez del de la tarifa es un error de una línea
   * en cualquier integración, y el que este código nombra.
   *
   * Se verifica ANTES de tomar la numeración, junto con la pertenencia al
   * tenant: una tarifa de otra organización tampoco puede entrar al documento
   * aunque el FK la acepte.
   */
  INVOICING_CALC_002: {
    code: 'INVOICING_CALC_002',
    httpStatus: 422,
    devMessage:
      'Invoice declares a tax_rate_id that does not exist in tax_rates or belongs to another tenant',
  },
  /**
   * `product_id` / `product_variant_id` QUE NO EXISTE, O QUE ES DE OTRA TIENDA.
   *
   * Misma familia y mismo motivo que `INVOICING_CALC_002`, sobre las otras dos
   * llaves foráneas que una línea puede traer. `invoice_items` tiene FK a
   * `products(id)` y a `product_variants(id)`: sin compuerta, un id inexistente
   * sólo se descubría cuando Postgres rechazaba el INSERT (P2003) y salía como
   * `SYS_INTERNAL_001` / 500 — con el consecutivo autorizado ya gastado.
   *
   * Y lo inverso es peor: un id de OTRA tienda SÍ satisface la FK, así que
   * entraba en silencio y quedaba escrito en la factura. Por eso la compuerta
   * no pregunta «¿existe?» sino «¿lo devuelve el catálogo de ESTA tienda?»: el
   * scope de `StorePrismaService` ya filtra, de modo que ausente-del-mapa cubre
   * los dos casos con una sola comprobación.
   */
  INVOICING_CALC_003: {
    code: 'INVOICING_CALC_003',
    httpStatus: 422,
    devMessage:
      'Invoice line references a product or variant that does not exist or belongs to another store',
  },
  /**
   * `customer_id` QUE NO EXISTE, O QUE ES DE OTRA ORGANIZACIÓN.
   *
   * `users` NO está scopeado en `StorePrismaService` —su getter devuelve el
   * `baseClient`—, así que la pertenencia se comprueba a mano. Sin ella,
   * `invoices_customer_id_fkey` producía un 500 para el id inexistente, y el id
   * de otra organización pasaba la FK y quedaba grabado: una factura de la
   * tienda A apuntando al cliente de la organización B.
   */
  INVOICING_CALC_004: {
    code: 'INVOICING_CALC_004',
    httpStatus: 422,
    devMessage:
      'Invoice references a customer that does not exist or belongs to another organization',
  },
  /**
   * PREVALIDACIÓN FISCAL — los cuatro códigos siguientes traducen el veredicto de
   * `FiscalDocumentValidator` (`validators/fiscal-document.validator.ts`), la
   * puerta que rechaza en LOCAL lo que la DIAN rechazaría.
   *
   * POR QUÉ SON CUATRO Y NO UNO. El validador emite ~30 hallazgos distintos, pero
   * quien está frente al formulario solo necesita saber A DÓNDE IR: los totales,
   * la resolución, la clave técnica o el contenido del documento. Cada código es
   * una de esas cuatro pantallas. El hallazgo exacto —qué regla del Anexo, qué
   * línea, qué importe se esperaba— viaja íntegro en `details.blockers[]`, con su
   * `problem` y su `fix` redactados, así que el frontend debe preferirlos sobre
   * el texto genérico del catálogo.
   *
   * POR QUÉ NO ES UN 500 NI UN 400 GENÉRICO. El payload está bien formado; lo que
   * no cuadra es el documento fiscal. Un 500 diría que Vendix se rompió y no
   * dejaría nada que corregir, que es exactamente lo que el operador recibía
   * antes: «error interno» y una factura que la DIAN rechazaba después.
   *
   * LO QUE ESTOS CÓDIGOS AHORRAN. Un rechazo de la DIAN no cuesta un reintento —
   * cuesta un consecutivo autorizado, que es irrecuperable y deja un hueco en la
   * numeración que hay que justificar. Fallar acá no gasta nada.
   */
  INVOICING_PREVALIDATION_001: {
    code: 'INVOICING_PREVALIDATION_001',
    httpStatus: 422,
    devMessage:
      'Document arithmetic does not satisfy the DIAN rules (FAU14 header vs lines, TaxAmount = TaxableAmount x Percent/100, or PayableAmount identity)',
  },
  INVOICING_PREVALIDATION_002: {
    code: 'INVOICING_PREVALIDATION_002',
    httpStatus: 412,
    devMessage:
      'The numbering resolution does not back the document being issued (inactive, out of validity at issue date, exhausted range, or prefix/sequence mismatch)',
  },
  /**
   * El código que cierra el incidente del 14/08/2026: una ClTec de 38 caracteres
   * hizo rechazar una factura real y quemó un consecutivo autorizado.
   *
   * La ClTec es la ÚNICA entrada del CUFE que el XML no transporta, así que la
   * DIAN es el primer sistema capaz de notar que está mal — a menos que se mire
   * antes de firmar. Ni el mensaje, ni los `details`, ni los logs llevan nunca su
   * VALOR: solo su longitud, que es el único dato necesario para corregirla.
   */
  INVOICING_PREVALIDATION_003: {
    code: 'INVOICING_PREVALIDATION_003',
    httpStatus: 422,
    devMessage:
      'Technical key (ClTec) is missing or malformed for a document type whose key is built from it; never log or return its value, only its length',
  },
  INVOICING_PREVALIDATION_004: {
    code: 'INVOICING_PREVALIDATION_004',
    httpStatus: 422,
    devMessage:
      'Document content is not emittable (currency other than COP, unit of measure outside the DIAN list, missing/invalid lines, or CustomizationID incoherent with the AIU lines)',
  },

  /**
   * Retenciones DECLARADAS POR EL CLIENTE al crear la factura.
   *
   * El cliente puede mandar un `withholdings[]` con `concept_id` + `base` + `rate`
   * + `amount` cuando su sistema contable ya calculó las retenciones. La
   * validación es una invariante de NEGOCIO (no de tipo) porque la verificación
   * de que el concepto pertenece al tenant no la hace class-validator: un 400
   * genérico de "id no existe" deja al cliente sin saber si el concepto está
   * borrado, inactivo, o es de otra tienda.
   *
   * El 422 (no 400) sigue la convención del dominio: el cuerpo del request es
   * sintácticamente válido —los campos son del tipo y rango correctos— y el
   * fallo es de coherencia con el estado del tenant, no de forma.
   */
  INVOICING_WITHHOLDING_002: {
    code: 'INVOICING_WITHHOLDING_002',
    httpStatus: 422,
    devMessage:
      'One or more declared withholdings reference concepts that do not exist, are inactive, or belong to another tenant',
  },
  INVOICING_WITHHOLDING_003: {
    code: 'INVOICING_WITHHOLDING_003',
    httpStatus: 422,
    devMessage:
      'Declared withholding amount differs from base x rate by more than 1 centavo: a larger difference is not a rounding artifact, it is a data entry error',
  },
  /**
   * AIU — los tres códigos siguientes cubren el contrato de servicios AIU
   * (`cbc:CustomizationID = '09'`), donde el error NO se manifiesta como un
   * rechazo sino como una factura ACEPTADA que declara menos IVA del debido.
   *
   * Por qué merecen códigos propios y no un `INVOICING_VALIDATE_001` genérico:
   * el AIU tiene dos regímenes de base gravable incompatibles —E.T. art. 462-1
   * (base = A+I+U completo, piso del 10 % del valor del contrato) y Decreto
   * 1372/1992 art. 3 (base = sólo la Utilidad)— y cuál aplica depende del
   * CONTRATO, no del producto. Elegir el equivocado no produce ningún síntoma
   * visible: la DIAN acepta el documento y el faltante sólo se corrige con nota
   * crédito, ya con la sanción corriendo. Por eso la elección es configuración
   * explícita de la tienda (`store_settings.invoicing.aiu`) y por eso estos
   * errores nombran la configuración a tocar, no «el dato».
   */
  INVOICING_AIU_001: {
    code: 'INVOICING_AIU_001',
    httpStatus: 422,
    devMessage:
      'AIU taxable base is below the legal floor (E.T. art. 462-1: the AIU cannot be less than 10% of the contract value); the base is never inflated silently because that would change the amount the customer signed',
  },
  INVOICING_AIU_002: {
    code: 'INVOICING_AIU_002',
    httpStatus: 422,
    devMessage:
      'AIU contract object is missing or out of range; rule CAV03 requires the Administracion line cbc:Note to start with the literal prefix and be 20-5000 characters including it',
  },
  INVOICING_AIU_003: {
    code: 'INVOICING_AIU_003',
    httpStatus: 422,
    devMessage:
      'Line declares an aiu_component on a document whose operation_type is not the AIU one (09); the component would be silently ignored and the line taxed as standard',
  },
  /**
   * Los tres códigos siguientes cierran la vía por la que una factura AIU
   * ACEPTADA declara menos IVA del debido, que es el daño que el bloque de
   * arriba nombra pero no impedía.
   *
   * El hueco no era un descuido de cálculo. Bajo `et_462_1` la base es el AIU
   * completo, así que Imprevistos y Utilidad sin IVA sub-declaran el impuesto;
   * el calculador lo DETECTA (divergencia `aiu_taxable_line_without_tax`) pero
   * no podía imponer el importe porque **no conocía la tarifa**: depende del
   * bien o servicio y ese servicio no lo sabe. Con la divergencia reducida a un
   * `logger.warn`, quien capturaba la factura decidía la base gravable por
   * omisión. Evidencia real: la factura 83 (`QA102`, régimen `et_462_1`)
   * declaró 190.000 donde correspondían 285.000 — 95.000 de IVA faltantes.
   *
   * El perfil de facturación es lo que aporta el dato ausente: su matriz de
   * impuestos declara la tarifa por componente AIU, y con ella el servidor sí
   * puede imponer. De ahí la asimetría deliberada de estos códigos:
   *
   * - con perfil y tarifa declarada ⇒ el servidor IMPONE, no hay error;
   * - sin perfil ⇒ `INVOICING_AIU_004`, porque emitir sub-declarando es peor
   *   que parar: la DIAN acepta el documento y el faltante solo se corrige con
   *   nota crédito, ya con la sanción corriendo;
   * - con perfil pero el cliente declara otra tarifa ⇒ `INVOICING_AIU_005`,
   *   porque contradecir la configuración congelada señala un bug de cliente o
   *   manipulación, y eso debe ser ruidoso y no resolverse en silencio.
   *
   * No bloquean el flujo del panel: el formulario pone IVA en TODAS las líneas,
   * que es el caso simétrico (`aiu_untaxable_line_declares_tax`) y ese sí se
   * resuelve quitando el impuesto sin bloquear.
   */
  INVOICING_AIU_004: {
    code: 'INVOICING_AIU_004',
    httpStatus: 422,
    devMessage:
      'AIU taxable line declares no tax and no billing profile supplies the rate for its component: the server cannot infer the rate and refuses to emit an under-declared document (the DIAN would accept it and the shortfall would only be fixable by credit note)',
  },
  INVOICING_AIU_005: {
    code: 'INVOICING_AIU_005',
    httpStatus: 422,
    devMessage:
      'A per-line tax contradicts the AIU taxable base for that component: the base is determined by the regime, never by what the line declares. Two sites raise it. At CAPTURE, the declared tax disagrees with the tax matrix frozen in the billing profile version (different rate, or a tax on a component the regime does not tax). At EMISSION, a line whose component the regime does not tax carries a tax PERSISTED under a different regime: the XML would drop that line cac:TaxTotal while the amount stays in the header total and cbc:PayableAmount, and FAU04 contrasts one against the sum of the other',
  },
  /**
   * D.4 (ADR-6) — `aiu_component: 'contrato'` (Modelo 1 / `no_sumada`) declara
   * que la línea ES el AIU completo del contrato, en vez de venir partido en
   * tres renglones (Modelo 2 / `'sumada'`). Las dos formas no pueden convivir
   * en el mismo documento, ni puede haber dos líneas `'contrato'`: cualquiera
   * de las dos cosas deja sin definir cuánto vale el AIU que el piso legal del
   * 10 % (E.T. art. 462-1) necesita comparar contra el contrato. No se elige
   * una de las dos declaraciones por precedencia — sería adivinar cuál de las
   * dos miente — se rechaza antes de gastar numeración.
   *
   * No confundir con `INVOICING_AIU_001` (AIU por debajo del piso legal): ese
   * código asume un ÚNICO AIU bien formado y sólo cuestiona si alcanza el 10 %;
   * éste dispara ANTES, cuando el documento ni siquiera declara un AIU único.
   */
  INVOICING_AIU_007: {
    code: 'INVOICING_AIU_007',
    httpStatus: 422,
    devMessage:
      "Document mixes Modelo 1 (aiu_component: 'contrato') with Modelo 2 component lines (administracion/imprevistos/utilidad), or declares more than one 'contrato' line; a 'contrato' line already IS the whole contract AIU, so either combination leaves the AIU value the art. 462-1 floor compares against undefined",
  },

  /**
   * Configuración de un perfil de facturación que no se puede guardar.
   *
   * 422 y no 400: la forma es válida —el DTO ya pasó— y lo que falla es una
   * regla FISCAL. La distinción importa para el editor, que ante un 400 muestra
   * «revisa los datos» y ante esto puede marcar el campo exacto: `details.issues`
   * trae la ruta con puntos dentro del snapshot (`aiu.components.utilidad`).
   *
   * Devuelve TODOS los problemas, no el primero. El editor tiene 7 secciones y
   * uno por vez obligaría al usuario a guardar siete veces para descubrir siete
   * errores.
   *
   * La regla que justifica el código es la última de la lista, y es la que este
   * plan entero existe para hacer cumplir: **la matriz de impuestos no puede
   * contradecir la base gravable del perfil.** La base decide, línea por línea,
   * cuál emite `cac:TaxTotal`; los importes salen de los tributos persistidos.
   * Si las dos mitades salen de bases distintas, el XML declara una
   * gravabilidad que contradice sus propios números y la DIAN lo rechaza por
   * FAU04 con el consecutivo ya gastado. Un perfil guardado con esa
   * contradicción la reproduciría en cada factura que lo use.
   *
   * Se dice la BASE y no el régimen porque son tres y no dos, y porque la
   * tercera —«subtotal»— no tiene régimen legal al que colapsar: declina el
   * tratamiento AIU y grava el contrato completo, costo reembolsable incluido.
   * Un mensaje redactado sobre el régimen imprimía el heredado, o `undefined`,
   * sobre un perfil cuya base era otra.
   *
   * Consecuencia práctica para quien construya el control de base gravable: la
   * base y la matriz son UN SOLO cambio. Escribir sólo `taxable_basis` deja la
   * matriz apuntando a las porciones de la base anterior, y este código salta
   * sobre una casilla que la persona no tocó. Bajo «subtotal» el costo
   * reembolsable ENTRA en la base, así que `costo.taxable = false` —que es el
   * valor por omisión— es una contradicción desde el primer guardado.
   */
  INVOICING_PROFILE_005: {
    code: 'INVOICING_PROFILE_005',
    httpStatus: 422,
    devMessage:
      'Billing profile configuration is fiscally invalid: AIU component percentages must sum to exactly 100, the minimum taxable base cannot fall below the 10% legal floor when the base is aiu (E.T. art. 462-1), and the tax matrix must agree with the declared taxable_basis (aiu taxes A+I+U; utilidad taxes only Utilidad, Decreto 1372/1992; subtotal declines AIU treatment and taxes the whole contract including the reimbursable cost). AIU_TAXABLE_BUCKETS_BY_BASIS is the single table that decides which buckets enter the base per basis, so changing taxable_basis without reprojecting the matrix in the same write raises this on a field the user never touched. All offending fields are returned in details.issues with their dotted path so the editor can mark them',
  },

  /**
   * Perfil de facturación inexistente — o de otro tenant.
   *
   * **Los dos casos devuelven exactamente esto, y es deliberado.** El servicio
   * busca con el cliente scopeado, así que el perfil de otra tienda simplemente
   * no aparece en el resultado: para el llamador es indistinguible de un id que
   * no existe. Distinguirlos —403 para «existe pero no es tuyo»— convertiría el
   * endpoint en un oráculo de enumeración: probando ids se podría inventariar
   * cuántos perfiles tiene la competencia.
   */
  /**
   * Perfil de facturación inexistente — o de otra tienda.
   *
   * Las dos situaciones responden lo mismo A PROPÓSITO. El cliente scopeado no
   * devuelve filas de otra tienda, así que el servicio no puede distinguirlas;
   * y aunque pudiera, responder 403 al id ajeno y 404 al inexistente convertiría
   * el endpoint en un oráculo de enumeración: barriendo ids se aprendería
   * cuáles existen en tiendas ajenas.
   *
   * El texto que ve el usuario NO sale de aquí: lo construye
   * `profileNotFound()` en `profiles/profile-errors.ts`, en español y sin
   * explicar el mecanismo. Este `devMessage` es la red de seguridad para un
   * `throw` que olvide pasarlo — por eso es corto y no revela el razonamiento.
   */
  INVOICING_PROFILE_001: {
    code: 'INVOICING_PROFILE_001',
    httpStatus: 404,
    devMessage: 'Billing profile not found',
  },

  /**
   * Carrera perdida al marcar predeterminado.
   *
   * El invariante «un solo predeterminado por (`store_id`, `operation_type`)» lo
   * sostiene un índice único PARCIAL, no el código. Dos `set-default`
   * simultáneos sobre perfiles del mismo tipo entran los dos, desmarcan los dos
   * y marcan los dos: una de las dos transacciones choca con el índice y
   * Postgres la aborta con `23505` (`P2002` en Prisma).
   *
   * 409 y no 500: el estado final es correcto —hay exactamente un
   * predeterminado— y lo único que ocurrió es que este cliente perdió la
   * carrera. Reintentar en el servidor sería peor: el usuario pidió que ganara
   * SU perfil, y un reintento automático decidiría por él en función de quién
   * llegó último. El frontend refresca y muestra cuál quedó.
   */
  INVOICING_PROFILE_002: {
    code: 'INVOICING_PROFILE_002',
    httpStatus: 409,
    devMessage:
      'Another profile of the same operation type was set as default concurrently: the partial unique index rejected this write',
  },

  /**
   * Marcar predeterminado un perfil INACTIVO.
   *
   * Es un 409 de estado y no un 422 de validación: el `:id` es válido, el
   * permiso es correcto y el cuerpo está vacío — lo que impide la operación es
   * en qué estado está el recurso.
   *
   * Por qué se prohíbe en vez de activar y marcar de una: el predeterminado es
   * lo que el wizard elige SOLO. Activar de rebote convertiría un clic en
   * «Predeterminar» en dos efectos —uno pedido y otro no— y el perfil recién
   * activado entraría al catálogo de facturación sin que nadie lo revisara.
   * Activar es un paso aparte y visible.
   */
  INVOICING_PROFILE_007: {
    code: 'INVOICING_PROFILE_007',
    httpStatus: 409,
    devMessage: 'An inactive billing profile cannot be made the default one',
  },

  /**
   * Se intentó timbrar una factura contra un perfil INACTIVO.
   *
   * ## Por qué 409 y no 422
   *
   * El cuerpo de la petición es válido: el `profile_id` existe, es de este
   * tenant, y su configuración es correcta. Lo que no se puede es usarlo AHORA,
   * porque alguien lo desactivó. Es un conflicto con el estado del recurso, no
   * un error de forma, y la diferencia importa para el frontend: un 422 lo
   * mandaría a resaltar un campo del formulario, cuando lo que hay que hacer es
   * volver a pedir el catálogo y ofrecer los perfiles que sí están activos.
   *
   * ## Por qué se rechaza en vez de caer al flujo manual
   *
   * Caer al flujo manual —ignorar el perfil y leer `store_settings`— es la
   * opción cómoda y es la peligrosa: la factura se emitiría con el régimen AIU
   * de la tienda en vez del del perfil que el usuario eligió, y los dos
   * regímenes gravan bases INCOMPATIBLES (E.T. 462-1 grava A+I+U; Decreto
   * 1372/1992 grava sólo la Utilidad). El usuario vería un 201, la DIAN
   * recibiría un IVA distinto del que quiso declarar, y no quedaría rastro de
   * que hubo una sustitución. Un consecutivo gastado con la base equivocada se
   * corrige sólo con nota crédito y con la sanción ya corriendo.
   *
   * Un perfil desactivado DESPUÉS de emitir no invalida nada: la factura quedó
   * apuntando a `(profile_id, profile_version)` y esa versión es inmutable.
   * Este código sólo gobierna la emisión NUEVA.
   *
   * `details` lleva `profile_id` y `operation_type` para que el frontend pueda
   * repedir el catálogo del tipo correcto sin adivinar.
   */
  INVOICING_PROFILE_006: {
    code: 'INVOICING_PROFILE_006',
    httpStatus: 409,
    devMessage:
      'An inactive billing profile cannot be used to stamp a new invoice: falling back to store settings would silently swap the VAT taxable base, because the two AIU regimes (E.T. 462-1 vs Decreto 1372/1992) are incompatible',
  },

  /**
   * El `operation_type` de la factura y el del perfil no coinciden.
   *
   * ## Qué se rompe si esto no se valida
   *
   * Un perfil pertenece a UN tipo de operación: su configuración AIU, sus reglas
   * de tributo por componente y sus cuentas contables sólo tienen sentido para
   * ese tipo. Congelar un perfil AIU en una factura estándar —o al revés— deja
   * `(profile_id, profile_version)` apuntando a una configuración que NO es la
   * que gobernó el cálculo, y ahí muere la reproducibilidad fiscal que las dos
   * columnas existen para dar: reconstruir el documento desde su versión daría
   * un XML distinto del que la DIAN validó, con el consecutivo ya gastado.
   *
   * Y es silencioso. Con un perfil AIU en una factura estándar,
   * `resolveAiuContext` devuelve `{}` porque el documento no es AIU, así que las
   * tres columnas `aiu_*` quedan NULL y nada falla: la factura sale, parece
   * correcta, y su procedencia declarada es falsa.
   *
   * ## Por qué no se coacciona el tipo de la factura al del perfil
   *
   * Porque `operation_type` es el `cbc:CustomizationID` del UBL y cambia cómo la
   * DIAN calcula la base gravable del documento entero. Cambiarlo por detrás
   * para que cuadre con el perfil es reescribir el hecho fiscal que el usuario
   * declaró. Se rechaza y se le dice cuál de los dos corregir.
   */
  INVOICING_PROFILE_008: {
    code: 'INVOICING_PROFILE_008',
    httpStatus: 409,
    devMessage:
      "The invoice operation_type does not match the profile's: freezing (profile_id, profile_version) from a profile of another type would make the stamped provenance false, and the aiu_* columns would stay NULL with no error",
  },

  /**
   * El perfil existe y está activo, pero no tiene ninguna versión comprometida.
   *
   * ## Por qué esto no puede ser un 500
   *
   * `invoice_profiles.current_version` es `@default(0)`, así que la fila puede
   * existir apuntando a nada. Por la API no debería pasar —la creación
   * compromete la versión 1 en la misma transacción— pero un `INSERT` por SQL o
   * una transacción a medias lo produce. Sin este código, la lectura de la
   * versión devolvería `null` y el `.config` de un `null` saldría como
   * `TypeError` → 500 crudo, sin código sobre el que el frontend pueda ramificar
   * y sin decirle a nadie qué hacer.
   *
   * ## Por qué NO se cae al flujo manual
   *
   * Misma razón que `INVOICING_PROFILE_006`: emitir leyendo `store_settings`
   * cuando el usuario pidió un perfil sustituye el régimen de base gravable sin
   * dejar rastro. Aquí es incluso más claro, porque no hay NINGUNA configuración
   * congelada que respaldar: las dos columnas quedarían NULL en una factura que
   * dice haberse emitido bajo un perfil.
   *
   * La salida es guardar el perfil una vez desde el editor, lo que compromete la
   * versión 1. El mensaje lo dice explícitamente.
   */
  INVOICING_PROFILE_009: {
    code: 'INVOICING_PROFILE_009',
    httpStatus: 409,
    devMessage:
      'The billing profile has no committed version (current_version = 0), so there is no frozen config to stamp: emission is refused instead of silently falling back to live store settings',
  },

  /**
   * Compuerta de cuentas PUC del perfil contra `chart_of_accounts` (F.13, paso
   * dueño de DB-07).
   *
   * ## Qué rechaza
   *
   * Guardar un perfil cuya sección `accounting` trae un código que NO existe en
   * el plan de cuentas que gobierna ese perfil, o que existe pero es de
   * AGRUPACIÓN (`accepts_entries = false`) y por tanto no admite asientos. Son
   * las dos mitades del invariante de DB-07; la segunda es la que faltaba: una
   * cuenta de agrupación guardada produce un asiento imposible en la emisión,
   * cuando el fallo ya es tarde y el documento está emitido.
   *
   * ## Por qué 422 y no aviso
   *
   * Decisión de negocio escrita el 2026-08-25 (rzy): RECHAZAR desde ya. La
   * consecuencia aceptada es que editar por un motivo ajeno uno de los perfiles
   * vivos con códigos inválidos exige corregir primero la cuenta; los perfiles
   * afectados quedan identificables por la consulta de DB-07 y su corrección
   * ocurre por edición normal, que crea versión nueva append-only — nunca un
   * UPDATE sobre versiones existentes, que son inmutables por diseño.
   *
   * ## Por qué su propio código y no INVOICING_PROFILE_005
   *
   * El 005 significa «la forma/fiscalidad interna del snapshot es inválida» y
   * lo calcula un contrato puro espejado al frontend; esta compuerta es de
   * EXISTENCIA contra una tabla de la base, no puede vivir ahí ni debe
   * confundirse con ella. La FORMA de la respuesta sí se copia del editor:
   * `details.issues[]` con `{field, code, message}` y la ruta con puntos
   * (`accounting.revenue_account_by_bucket.costo`,
   * `accounting.vat_payable_account`), para que el mismo pintado de campo del
   * editor sirva sin cambios.
   *
   * ## Alcance del PUC contra el que se valida
   *
   * Lo decide `organizations.fiscal_scope`, con el mismo resolutor que usa el
   * módulo de contabilidad (FiscalScopeService): ORGANIZATION ⇒ PUC de nivel
   * organización; STORE ⇒ PUC de la entidad contable de la tienda del perfil.
   * Validar contra otro PUC aceptaría un código que no existe donde el asiento
   * va a caer, que es exactamente el defecto que esta compuerta adelanta al
   * guardado.
   */
  INVOICING_PROFILE_010: {
    code: 'INVOICING_PROFILE_010',
    httpStatus: 422,
    devMessage:
      'A billing profile account code does not exist in the chart of accounts that governs it, or exists as a grouping account with accepts_entries=false. Resolved by organizations.fiscal_scope via FiscalScopeService (ORGANIZATION => org-level PUC, STORE => the profile store entity PUC); all offending fields are returned in details.issues with their dotted path',
  },

  /**
   * Nombre de perfil ya usado en la misma tienda.
   *
   * ## Por qué esto ES la idempotencia de la creación
   *
   * El requerimiento pedía que un doble submit no creara dos perfiles. La forma
   * barata sería una cabecera `Idempotency-Key` con su tabla de claves y su TTL;
   * la forma correcta es notar que el nombre YA identifica al perfil para la
   * persona que lo elige en el wizard, y hacer que la base lo haga cumplir. Con
   * `(store_id, lower(name))` único, dos POST idénticos en paralelo terminan
   * necesariamente en una sola fila, sin estado extra que expirar.
   *
   * ## Por qué 409 y no 200 con el perfil existente
   *
   * Devolver 200 con el perfil que ya existía es la respuesta cómoda y es
   * peligrosa: quien envía "AIU obras" con una configuración nueva recibiría un
   * 200 y un cuerpo con la configuración VIEJA, y creería que sus tarifas se
   * guardaron. En un módulo cuya salida es un XML con el IVA que se declara a la
   * DIAN, un guardado que no ocurrió y se anuncia como exitoso es peor que un
   * error visible.
   *
   * El 409 lleva `existing_profile_id` en `details` justamente para que el
   * frontend pueda distinguir los dos casos que llegan por la misma puerta: el
   * doble clic accidental —mismo nombre, nada más que informar, se navega al
   * perfil creado— y el choque real de nombres, donde hay que pedir otro.
   *
   * ## Por qué también lo emiten editar y clonar
   *
   * Renombrar un perfil al nombre de otro, o clonar hacia un nombre tomado,
   * violan el mismo índice. Si sólo la creación tradujera el error, las otras
   * dos rutas devolverían 500 por el mismo hecho.
   */
  INVOICING_PROFILE_004: {
    code: 'INVOICING_PROFILE_004',
    httpStatus: 409,
    devMessage:
      'A billing profile with that name already exists in this store (unique index on store_id + lower(name))',
  },

  /**
   * Borrado de un perfil que facturas ya timbradas referencian.
   *
   * 409 y no 400: la petición está bien formada y el permiso es correcto; lo que
   * la impide es el ESTADO del recurso. La FK
   * `invoices.profile_id → invoice_profiles(id) ON DELETE RESTRICT` ya lo
   * bloquearía a nivel de base, pero como error de Prisma sin traducir sería un
   * 500 sin explicación. Este código es la versión legible del mismo NO, con el
   * conteo en `details` para que el diálogo diga cuántas facturas y ofrezca
   * desactivar en su lugar.
   *
   * El historial de versiones NO se puede borrar aunque el perfil sí: es lo que
   * hace reproducible una factura de hace dos años.
   */
  INVOICING_PROFILE_003: {
    code: 'INVOICING_PROFILE_003',
    httpStatus: 409,
    devMessage:
      'Billing profile cannot be deleted because stamped invoices reference it. The FK is ON DELETE RESTRICT, so the database would refuse it anyway — this code is the readable version of the same refusal, with the invoice count in details and deactivation offered as the alternative',
  },

  /**
   * Versión inexistente de un perfil que sí existe.
   *
   * Separado de `INVOICING_PROFILE_001` porque el frontend hace dos cosas
   * distintas: ante el perfil ausente vuelve al listado, ante la versión ausente
   * se queda en el historial y sólo muestra un toast. Un solo código obligaría a
   * adivinar cuál de las dos por el texto del mensaje.
   */
  INVOICING_PROFILE_VERSION_001: {
    code: 'INVOICING_PROFILE_VERSION_001',
    httpStatus: 404,
    devMessage:
      'Requested version of an existing billing profile does not exist. Kept apart from INVOICING_PROFILE_001 because the frontend reacts differently: a missing profile sends the user back to the list, a missing version only raises a toast inside the history view',
  },
  /**
   * La PREVISUALIZACIÓN alcanzó un camino que reserva numeración.
   *
   * ## Qué protege
   *
   * `POST /profiles/:id/preview` proyecta el XML que produciría un perfil sin
   * transmitirlo (ADR-5). No numera, no firma, no persiste: por eso se puede
   * llamar N veces mientras el operador ajusta las tarifas, y por eso funciona
   * en una tienda que todavía no está habilitada ante la DIAN.
   *
   * `InvoiceNumberGenerator.generateNextNumber` mueve
   * `invoice_resolutions.current_number` DENTRO de un `pg_advisory_xact_lock`, y
   * un consecutivo autorizado que se toma y no se usa **no se recupera**: deja un
   * hueco en la numeración que la DIAN no perdona y que nadie nota hasta la
   * auditoría. Una previsualización que llegara a ese camino quemaría un
   * consecutivo por cada clic en «ver factura de muestra».
   *
   * ## Por qué es un error y no una guarda silenciosa
   *
   * `ProfilesModule` sustituye el token `InvoiceNumberGenerator` por
   * `PreviewNumberingGuard`, cuyo `generateNextNumber` lanza ESTE código. Así,
   * si mañana alguien añade al camino de previsualización una llamada que reserve
   * —directamente o a través de un servicio nuevo— el resultado es un 409
   * ruidoso, no un hueco en la numeración. Devolver un número inventado en vez de
   * fallar sería peor: el XML proyectado afirmaría un consecutivo que la
   * resolución no otorgó y quien lo compare contra la base creería que hay
   * corrupción.
   *
   * 409 y no 500: el servidor no falló. El estado del sistema —un camino de
   * lectura conectado a un camino de escritura fiscal— es lo que hace imposible
   * completar la operación, y eso es un conflicto, no un error interno.
   */
  INVOICING_PREVIEW_001: {
    code: 'INVOICING_PREVIEW_001',
    httpStatus: 409,
    devMessage:
      'The profile preview path reached numbering reservation. Preview must never move invoice_resolutions.current_number: an authorized consecutive taken and not used is unrecoverable. ProfilesModule swaps the InvoiceNumberGenerator token for PreviewNumberingGuard so this fails loudly instead of burning a consecutive per preview',
  },

  /**
   * La muestra de la previsualización no es utilizable.
   *
   * Cubre exactamente dos formas de muestra imposible, y las dos son ambigüedad
   * sobre el VALOR DEL CONTRATO —el número del que dependen la base gravable y
   * el piso legal del art. 462-1—, así que ninguna se puede resolver adivinando:
   *
   * · `lines` y `contract_value` a la vez. Los dos definen el contrato y no hay
   *   forma de saber cuál manda. Elegir uno por precedencia produciría un
   *   desglose que cuadra consigo mismo mientras contradice lo que el operador
   *   escribió — que es justo la confianza falsa que la previsualización existe
   *   para no dar.
   * · Ninguno de los dos. No hay nada que proyectar.
   * · La porción AIU declarada excede el valor del contrato. No es ambigüedad
   *   sino imposibilidad aritmética —el AIU es una PARTE del contrato, no un
   *   recargo—, y el resultado sería una línea de costo reembolsable negativa.
   *
   * Es 422 y no 400 porque la petición está bien FORMADA: el DTO valida cada
   * campo por separado sin problema. Lo que falla es la relación entre ellos,
   * que es semántica. La distinción importa en el frontend: un 400 se muestra
   * como «revisa el formulario» y un 422 puede señalar la contradicción concreta.
   *
   * No confundir con `INVOICING_PREVIEW_001`, que es el caso en que la
   * previsualización intentó CONSUMIR numeración fiscal: ése es un defecto del
   * servidor, no de la muestra.
   */
  INVOICING_PREVIEW_002: {
    code: 'INVOICING_PREVIEW_002',
    httpStatus: 422,
    devMessage:
      'The preview sample is unusable: it declares both `lines` and `contract_value` (which both define the contract value, leaving the taxable base and the art. 462-1 floor ambiguous), neither of them, or an aiu_value larger than the contract (which would make the reimbursable-cost line negative). Do not pick one by precedence — the resulting breakdown would be self-consistent and still contradict what the operator typed',
  },

  INVOICING_AIU_006: {
    code: 'INVOICING_AIU_006',
    httpStatus: 422,
    devMessage:
      'The invoice declares an aiu_regime that is none of the THREE known taxable bases: emission is refused rather than coerced to a default, because E.T. 462-1 (taxes A+I+U, 10% legal floor), Decreto 1372/1992 (taxes only Utilidad, no floor) and subtotal (declines AIU treatment and taxes the whole contract including the reimbursable cost, no floor) are incompatible bases, and picking one would change the VAT declared with no trace that it was guessed. A MISSING base is not this error: it falls back to the store setting, and then to the same conservative et_462_1 default the creation path uses, both logged. The column is still named aiu_regime for compatibility; what it holds is the base, and subtotal is a legal value in it with no regime to collapse to',
  },
  /**
   * DIVISA — la factura electrónica colombiana se emite SIEMPRE en pesos
   * (Res. DIAN 000042/2020 art. 73; Oficios 901544 y 903436 de 2020; Concepto
   * 1509 de 2024). La divisa no cambia `cbc:DocumentCurrencyCode`: se DECLARA
   * en `cac:PaymentExchangeRate`. Estos dos códigos cubren los únicos casos en
   * que esa declaración no se puede construir, y ninguno de los dos puede
   * resolverse adivinando una tasa: una tasa inventada es una factura con un
   * valor en pesos que no corresponde a la operación.
   */
  INVOICING_TRM_001: {
    code: 'INVOICING_TRM_001',
    httpStatus: 422,
    devMessage:
      'Could not resolve the official TRM for the exchange rate date and no manual rate was supplied; never guess a rate',
  },
  INVOICING_CURRENCY_001: {
    code: 'INVOICING_CURRENCY_001',
    httpStatus: 422,
    devMessage:
      'Non-USD currency requires either a manual exchange rate or the USD cross rate for the date: the TRM only quotes USD/COP, so any other currency needs a second leg Vendix does not source',
  },
  /**
   * SOLICITUD DE FACTURA NOMINATIVA INEXISTENTE O YA RECLAMADA.
   *
   * `processRequest` era el único controlador de la familia que lanzaba
   * `NotFoundException('INVOICE_DATA_REQUEST_NOT_FOUND_OR_NOT_SUBMITTED')` —un
   * identificador en mayúsculas, no un mensaje—. Sin `error_code` el frontend no
   * tenía catálogo al que ir y le pintaba al comerciante el nombre literal de la
   * constante. Un solo código cubre los dos casos porque la acción del usuario
   * es la misma en ambos: refrescar la lista y mirar en qué estado quedó.
   */
  INVOICING_DATA_REQUEST_001: {
    code: 'INVOICING_DATA_REQUEST_001',
    httpStatus: 404,
    devMessage:
      'Invoice data request not found for this store, or it is no longer in the submitted state',
  },
  /**
   * ENLACE PÚBLICO INVÁLIDO. El token no corresponde a ninguna solicitud.
   *
   * Los tres códigos que siguen viajan al CLIENTE FINAL, no al comerciante: son
   * los del formulario público post-venta donde el comprador escribe sus datos
   * fiscales. Por eso se separan por causa —enlace inválido, enlace vencido,
   * enlace ya usado—: las tres tienen salidas distintas y decirle «error» a las
   * tres deja al comprador sin saber si debe pedir un enlace nuevo o si su
   * factura ya está emitida.
   */
  INVOICING_DATA_REQUEST_002: {
    code: 'INVOICING_DATA_REQUEST_002',
    httpStatus: 404,
    devMessage: 'Invoice data request link is invalid or no longer exists',
  },
  /** Enlace vencido: `expires_at` en el pasado, o estado `expired`. */
  INVOICING_DATA_REQUEST_003: {
    code: 'INVOICING_DATA_REQUEST_003',
    httpStatus: 410,
    devMessage: 'Invoice data request link has expired',
  },
  /** Enlace ya usado: los datos se enviaron o la factura ya se emitió. */
  INVOICING_DATA_REQUEST_004: {
    code: 'INVOICING_DATA_REQUEST_004',
    httpStatus: 409,
    devMessage:
      'Invoice data request has already been submitted or completed; the link accepts data only once',
  },
  /**
   * REENVÍO DE FACTURA (E.6, `POST /store/invoicing/:id/deliver`).
   *
   * Los tres códigos cubren el ciclo del reenvío a un correo distinto del
   * capturado en la factura. Deliberadamente NO se usa `@IsEmail()` en el DTO:
   * eso haría que Nest respondiera 400 `SYS_VALIDATION_001` antes de llegar al
   * servicio, y el contrato de esta feature pide un 422 de dominio con código
   * propio. La validación de formato vive en el servicio con `isEmail()` de
   * `class-validator` en modo standalone.
   */
  INVOICING_DELIVERY_001: {
    code: 'INVOICING_DELIVERY_001',
    httpStatus: 422,
    devMessage: 'Destination email is missing or has an invalid format',
  },
  /** Una factura en `draft` no se puede reenviar: todavía no es un documento emitido. */
  INVOICING_DELIVERY_002: {
    code: 'INVOICING_DELIVERY_002',
    httpStatus: 409,
    devMessage: 'Cannot deliver a draft invoice; it has not been issued yet',
  },
  /**
   * El proveedor de correo (`EmailService`) devolvió `success: false`. La traza
   * en `invoice_delivery_events` ya quedó escrita con `status: 'error'` y
   * `provider_error` ANTES de lanzar esta excepción, para que el fallo del
   * proveedor no borre la evidencia de que se intentó.
   */
  INVOICING_DELIVERY_003: {
    code: 'INVOICING_DELIVERY_003',
    httpStatus: 502,
    devMessage: 'Email provider failed to send the invoice delivery',
  },
  /**
   * IDENTIDAD FISCAL DEL EMISOR INCOMPLETA — lo lanza el resolvedor estricto
   * (`resolveTenantFiscalIdentity`) cuando falta `legal_name`,
   * `municipality_code` o `department`.
   *
   * POR QUÉ UN SOLO CÓDIGO Y NO TRES. Los códigos se dividen por PANTALLA a la
   * que hay que ir, no por campo (mismo criterio que `INVOICING_PREVALIDATION_*`).
   * Los tres campos se llenan en el mismo sitio —la identidad fiscal del
   * tenant—, así que un solo código con `details.missing` nombrando TODOS los
   * huecos manda al operador una sola vez y con la lista completa, en vez de
   * hacerle descubrirlos de a uno por reintento.
   *
   * POR QUÉ 422 Y NO 500. El problema no es que Vendix se rompiera: es que el
   * tenant no ha declarado su municipio DIAN. El resolvedor ya lo diagnostica
   * con precisión —dice el NIT, el campo ausente y dónde llenarlo— y ese
   * diagnóstico se perdía entero al degradarse a `SYS_INTERNAL_001`, dejando al
   * operador con «Error interno del servidor» ante un PDF que nunca iba a salir.
   *
   * `details` lleva `nit`, `missing_field` (el que cortó) y `missing` (todos),
   * más el `cta` al wizard fiscal, igual que `FISCAL_VAT_NOT_RESPONSIBLE_001`.
   */
  FISCAL_IDENTITY_INCOMPLETE: {
    code: 'FISCAL_IDENTITY_INCOMPLETE',
    httpStatus: 422,
    devMessage:
      'Issuer fiscal identity is missing a field required to issue (legal_name, municipality_code or department)',
  },
  FISCAL_CONFIG_INCOMPLETE: {
    code: 'FISCAL_CONFIG_INCOMPLETE',
    httpStatus: 412,
    devMessage: 'Fiscal configuration is incomplete for this accounting entity',
  },
  /**
   * `ModuleFlowGuard` cerró la petición: el área fiscal que gobierna el módulo
   * (`invoicing`, `accounting`, `payroll`…) está inactiva para el tenant.
   *
   * Es la PRIMERA puerta que atraviesa cualquier llamada al módulo, y lanzaba
   * `ForbiddenException` con un texto en inglés dirigido al desarrollador. Sin
   * `error_code`, `parseApiError` caía en `DEFAULT_ERROR_MESSAGE` y el operador
   * leía «Ocurrió un error» ante una situación que tiene una corrección
   * concreta y de un solo clic: activar el área en el wizard fiscal.
   *
   * `details.area` viaja para que el frontend pueda enlazar la sección correcta.
   */
  FISCAL_AREA_INACTIVE: {
    code: 'FISCAL_AREA_INACTIVE',
    httpStatus: 403,
    devMessage: 'Fiscal area is inactive for this tenant',
  },
  FISCAL_SCOPE_INVALID: {
    code: 'FISCAL_SCOPE_INVALID',
    httpStatus: 400,
    devMessage: 'Invalid fiscal scope for this operation',
  },
  FISCAL_RESOLUTION_MISSING: {
    code: 'FISCAL_RESOLUTION_MISSING',
    httpStatus: 412,
    devMessage: 'No active fiscal resolution exists for this document type',
  },
  FISCAL_RESOLUTION_EXHAUSTED: {
    code: 'FISCAL_RESOLUTION_EXHAUSTED',
    httpStatus: 409,
    devMessage: 'Fiscal resolution range is exhausted',
  },
  FISCAL_IDEMPOTENCY_CONFLICT: {
    code: 'FISCAL_IDEMPOTENCY_CONFLICT',
    httpStatus: 409,
    devMessage: 'Fiscal retry is not idempotent',
  },
  FISCAL_ACCOUNTING_BLOCKED: {
    code: 'FISCAL_ACCOUNTING_BLOCKED',
    httpStatus: 412,
    devMessage: 'Fiscal accounting is blocked until DIAN acceptance exists',
  },
  FISCAL_PERIOD_CLOSED: {
    code: 'FISCAL_PERIOD_CLOSED',
    httpStatus: 409,
    devMessage:
      'Fiscal period covering entry_date is closed; auto-entry cannot be posted',
  },
  FISCAL_DOCUMENT_UNSUPPORTED: {
    code: 'FISCAL_DOCUMENT_UNSUPPORTED',
    httpStatus: 501,
    devMessage:
      'This fiscal document type is not implemented for DIAN own software',
  },
  // F4 — Gate "no responsable de IVA". El comercio NO es responsable de IVA
  // ante la DIAN (fiscal_data: O-49 sin O-48, o régimen SIMPLIFICADO): no
  // puede asignar IVA a un producto ni cobrarlo en una venta. `details`
  // incluye `context: 'product' | 'sale'` y `cta: '/admin/fiscal/wizard'`.
  FISCAL_VAT_NOT_RESPONSIBLE_001: {
    code: 'FISCAL_VAT_NOT_RESPONSIBLE_001',
    httpStatus: 412,
    devMessage:
      'Commerce is not VAT responsible (DIAN): cannot assign or charge IVA',
  },
  /**
   * Art. 616-1 ET / Res. 000165 de 2023: the POS electronic equivalent document
   * only supports sales up to 5 UVT. Above that the electronic sales invoice is
   * mandatory, which requires an identified buyer — so an anonymous sale over the
   * limit must be stopped BEFORE it commits, not corrected afterwards with a
   * credit note.
   *
   * `details` carries `uvt_value`, `limit_cop`, `total_amount` and `channel` so
   * the UI can tell the cashier exactly how far over the limit the sale is.
   */
  FISCAL_UVT_INVOICE_REQUIRED: {
    code: 'FISCAL_UVT_INVOICE_REQUIRED',
    httpStatus: 412,
    devMessage:
      'Anonymous sale exceeds the 5 UVT limit for a POS equivalent document; an identified buyer is required to issue the electronic invoice',
  },

  /**
   * Raised by `EncryptionService.encrypt()` when running with NODE_ENV=production
   * and no `DIAN_ENCRYPTION_KEY`. Without it the service would derive its key
   * from a source checked into the repository, so the DIAN Software-PIN and the
   * certificate password would be stored recoverable by anyone with the repo.
   *
   * Reads are deliberately NOT blocked: an environment that already ran without
   * the variable must keep opening its old ciphertext. Only NEW secrets are
   * refused, which is the narrowest control that still prevents the leak.
   */
  FISCAL_ENCRYPTION_KEY_MISSING: {
    code: 'FISCAL_ENCRYPTION_KEY_MISSING',
    httpStatus: 500,
    devMessage:
      'DIAN_ENCRYPTION_KEY is not set: refusing to encrypt a new secret with the repository-visible fallback key in production',
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
  PAYROLL_CROSS_STORE_FISCAL_001: {
    code: 'PAYROLL_CROSS_STORE_FISCAL_001',
    httpStatus: 409,
    devMessage:
      'Employee belongs to another store with a different fiscal entity (NIT). Cross-store association blocked under STORE fiscal_scope.',
  },
  PAYROLL_ASSOCIATE_CONFIRM_001: {
    code: 'PAYROLL_ASSOCIATE_CONFIRM_001',
    httpStatus: 409,
    devMessage:
      'Employee already exists in the organization. Confirmation required to associate to the current store.',
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
  PAYROLL_PROVIDER_002: {
    code: 'PAYROLL_PROVIDER_002',
    httpStatus: 412,
    devMessage: 'DIAN own-software payroll configuration is not enabled',
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
  PAYROLL_FISCAL_PROFILE_001: {
    code: 'PAYROLL_FISCAL_PROFILE_001',
    httpStatus: 400,
    devMessage:
      'fixed_retention_rate is required when retention_procedure is proc2',
  },
  PAYROLL_FISCAL_PROFILE_002: {
    code: 'PAYROLL_FISCAL_PROFILE_002',
    httpStatus: 404,
    devMessage: 'Employee fiscal profile not found',
  },
  PAYROLL_FISCAL_PROFILE_003: {
    code: 'PAYROLL_FISCAL_PROFILE_003',
    httpStatus: 400,
    devMessage:
      'No payroll income history found in the lookback window to calculate the fixed semester rate (art. 386 ET)',
  },

  // Payroll novelties
  NOV_FIND_001: {
    code: 'NOV_FIND_001',
    httpStatus: 404,
    devMessage: 'Payroll novelty not found',
  },
  NOV_VALIDATE_001: {
    code: 'NOV_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Employee not found or inactive for payroll novelty',
  },
  NOV_VALIDATE_002: {
    code: 'NOV_VALIDATE_002',
    httpStatus: 400,
    devMessage:
      'Payroll novelty is missing the required quantity (hours/days/amount) for its type',
  },
  NOV_STATUS_001: {
    code: 'NOV_STATUS_001',
    httpStatus: 409,
    devMessage: 'Only pending payroll novelties can be modified or deleted',
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
  CHART_ALREADY_SEEDED: {
    code: 'CHART_ALREADY_SEEDED',
    httpStatus: 409,
    devMessage:
      'Chart of accounts already exists for this tenant. Use force=true to reseed.',
  },
  MISSING_ACCOUNTING_ENTITY: {
    code: 'MISSING_ACCOUNTING_ENTITY',
    httpStatus: 409,
    devMessage:
      'Crea primero las entidades fiscales por tienda antes de sembrar el plan de cuentas.',
  },
  TAXES_ALREADY_SEEDED: {
    code: 'TAXES_ALREADY_SEEDED',
    httpStatus: 409,
    devMessage:
      'Default taxes already exist for this tenant. Use force=true to reseed.',
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
  DIAN_CERT_004: {
    code: 'DIAN_CERT_004',
    httpStatus: 400,
    devMessage: 'Certificate tax identifier does not match the fiscal entity',
  },
  DIAN_TEST_SET_001: {
    code: 'DIAN_TEST_SET_001',
    httpStatus: 412,
    devMessage:
      'DIAN test set evidence is required before production enablement',
  },
  /**
   * A previously submitted test set is still awaiting DIAN's verdict. Re-sending
   * would burn a second block of resolution numbers and DIAN would reject the
   * batch as duplicated, so the caller must poll `:id/test-set-status` instead.
   */
  DIAN_TEST_SET_002: {
    code: 'DIAN_TEST_SET_002',
    httpStatus: 409,
    devMessage:
      'A DIAN test set is already in progress for this configuration; poll its status instead of re-sending',
  },
  /** The resolution range has fewer numbers left than the test set requires. */
  DIAN_TEST_SET_003: {
    code: 'DIAN_TEST_SET_003',
    httpStatus: 412,
    devMessage:
      'The numbering resolution does not have enough remaining numbers for the test set required by this operation mode',
  },
  /**
   * There is no submitted batch to act upon: no ZipKey was ever persisted for
   * this configuration, so there is nothing to re-poll, diagnose or abandon.
   */
  DIAN_TEST_SET_004: {
    code: 'DIAN_TEST_SET_004',
    httpStatus: 412,
    devMessage:
      'This configuration has no submitted DIAN test set to inspect or abandon',
  },
  /**
   * Per-document diagnosis needs the document keys persisted with the batch.
   * Batches submitted before `documents[]` existed cannot be interrogated by
   * CUFE because the emission timestamp they were derived from was discarded.
   */
  DIAN_TEST_SET_005: {
    code: 'DIAN_TEST_SET_005',
    httpStatus: 412,
    devMessage:
      'The stored test set predates per-document evidence; re-send it to obtain diagnosable document keys',
  },
  /**
   * The test set must be emitted against a HABILITACIÓN resolution. Running it
   * against a production resolution burns real fiscal consecutives that can never
   * be reused, and stamps `TipoAmbiente=2` documents onto production numbering.
   */
  DIAN_TEST_SET_006: {
    code: 'DIAN_TEST_SET_006',
    httpStatus: 409,
    devMessage:
      'The test set requires a habilitación numbering resolution; the one provided belongs to production',
  },
  /**
   * The polled test-set job does not exist, was evicted, or belongs to another
   * fiscal configuration.
   *
   * Deliberately ONE code for all three: BullMQ job ids are global sequential
   * integers on a queue shared by every tenant, so distinguishing "no existe" from
   * "no es tuyo" would let a caller enumerate ids and learn that another tenant is
   * running a habilitación batch.
   */
  DIAN_TEST_SET_007: {
    code: 'DIAN_TEST_SET_007',
    httpStatus: 404,
    devMessage: 'DIAN test set job not found',
  },
  /**
   * Two active resolutions declare the SAME number and range, so which one a
   * caller gets depends on row order rather than on configuration.
   *
   * Why this is fatal rather than a warning: a consecutive already delivered to
   * DIAN can never be reused — DIAN rejects duplicated numbering permanently. Two
   * active twins advance `current_number` independently, so the one left behind
   * will re-issue numbers the other already sent, and every document it emits
   * from then on is dead on arrival. Failing to emit costs a legible error;
   * emitting costs the remainder of the range.
   */
  DIAN_TEST_SET_008: {
    code: 'DIAN_TEST_SET_008',
    httpStatus: 409,
    devMessage:
      'More than one active numbering resolution declares the same number and range; deactivate the duplicate before emitting',
  },
  /**
   * A RADIAN event references a document that DIAN never accepted. Events attach
   * to an existing electronic document by CUFE, so registering one against a
   * draft, rejected or not-yet-transmitted invoice would reference a key that does
   * not exist in the DIAN catalogue.
   */
  DIAN_EVENT_001: {
    code: 'DIAN_EVENT_001',
    httpStatus: 409,
    devMessage:
      'The referenced document is not accepted by DIAN or has no CUFE; a RADIAN event cannot reference it',
  },
  /**
   * Only the 030–034 event family is implemented. The endorsement/factoring range
   * (035–051) lives in the external `Tablas Referenciadas.xlsx`, so accepting an
   * arbitrary code would transmit an invented value that RADIAN rejects.
   */
  DIAN_EVENT_002: {
    code: 'DIAN_EVENT_002',
    httpStatus: 400,
    devMessage:
      'Unsupported RADIAN event code; only the 030-034 family is implemented',
  },
  /**
   * The event was already accepted by RADIAN for this document and code. Sending
   * it twice is a duplicate registration, not an update.
   */
  DIAN_EVENT_003: {
    code: 'DIAN_EVENT_003',
    httpStatus: 409,
    devMessage:
      'This RADIAN event code was already accepted for the referenced document',
  },
  /**
   * Events are only transmissible through the direct DIAN integration (software
   * propio). A third-party or mock provider has no `SendEventUpdateStatus`.
   */
  DIAN_EVENT_004: {
    code: 'DIAN_EVENT_004',
    httpStatus: 412,
    devMessage:
      'RADIAN events require the direct DIAN provider (software propio) to be active for this store',
  },
  /**
   * The negotiable-instrument events (035–051) carry data the reception family
   * does not: the operation type of numeral 14.1.2, the endorsement's `@listID`,
   * and the amounts of `InformacionNegociacion`.
   *
   * Raised BEFORE transmitting, on purpose. An incomplete event is rejected by
   * RADIAN against a consecutive already spent, and the DIAN's message names an
   * XPath rather than the field a merchant can fill. Refusing here with the
   * missing field named is both cheaper and recoverable.
   */
  DIAN_EVENT_005: {
    code: 'DIAN_EVENT_005',
    httpStatus: 422,
    devMessage:
      'RADIAN event is missing data the annex requires for its code (operation type, endorsement listID or negotiation amounts)',
  },
  DIAN_ENABLEMENT_001: {
    code: 'DIAN_ENABLEMENT_001',
    httpStatus: 412,
    devMessage: 'DIAN production enablement prerequisites are incomplete',
  },
  DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED: {
    code: 'DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED',
    httpStatus: 412,
    devMessage: 'DIAN production requires own-software mode for this tenant',
  },
  DIAN_CONN_001: {
    code: 'DIAN_CONN_001',
    httpStatus: 502,
    devMessage: 'DIAN connection test failed',
  },
  /**
   * `GetNumberingRange` no contestó: caída de red, timeout, o SOAP Fault (por
   * ejemplo `InvalidSecurity` cuando el certificado no firma el sobre).
   *
   * 502 y no 422: la consulta es READ-ONLY —no emite documentos ni reserva
   * numeración—, así que un fallo aquí nunca es culpa del payload del tenant;
   * es el servicio de la DIAN el que no respondió. Distinguirlo importa porque
   * esta consulta es la fuente autoritativa de la ClTec ligada a cada
   * resolución, y confundir «la DIAN no contestó» con «la DIAN dice que no
   * tienes ese rango» llevaría a teclear la clave a mano otra vez — que es
   * exactamente el defecto que produce el rechazo FAD06.
   */
  DIAN_NUMBERING_RANGE_001: {
    code: 'DIAN_NUMBERING_RANGE_001',
    httpStatus: 502,
    devMessage:
      'No se pudo consultar los rangos de numeración ante la DIAN (GetNumberingRange)',
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
  /**
   * `cbc:InvoicedQuantity/@unitCode` — la unidad de medida de una línea no se
   * pudo resolver contra el catálogo, y NO se inventa.
   *
   * La DIAN valida `@unitCode` contra su lista de códigos UN/ECE y valida además
   * la coherencia entre la cantidad y su unidad. Rellenar con `'EA'` una línea
   * cuya unidad real es kilos o metros produce un documento que declara piezas
   * donde hubo kilos: aceptado por el validador, falso ante la DIAN, e
   * irreversible una vez emitido. Se rechaza ANTES de gastar el consecutivo.
   *
   * `'EA'` sigue siendo legítimo —y se sigue emitiendo sin error— en los dos
   * casos donde SIGNIFICA algo: la línea libre sin producto, y el producto sin
   * unidad de stock declarada (se cuenta por unidades). Este código sólo aparece
   * cuando la unidad EXISTE pero no se pudo traducir: producto ilegible desde el
   * documento, o unidad del catálogo sin equivalencia UN/ECE en
   * `uom-uncefact.util.ts`.
   */
  DIAN_UNIT_CODE_001: {
    code: 'DIAN_UNIT_CODE_001',
    httpStatus: 422,
    devMessage:
      'No se pudo resolver la unidad de medida (unitCode) de una o más líneas del documento',
  },
  /**
   * La lectura del catálogo de unidades falló (base de datos). Es infraestructura
   * transitoria, no un dato mal capturado: 503 para que el cliente reintente en
   * vez de mandar al comerciante a corregir algo que está bien.
   *
   * Antes esto era un `catch {}` MUDO que devolvía el mapa a medias y hacía que
   * toda la factura se emitiera con `'EA'`. Tragarse el error no sólo emitía un
   * documento falso: impedía siquiera diagnosticarlo.
   */
  DIAN_UNIT_CODE_002: {
    code: 'DIAN_UNIT_CODE_002',
    httpStatus: 503,
    devMessage:
      'Fallo al leer el catálogo de unidades de medida para resolver los unitCode del documento',
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
  LAY_INSTALLMENT_003: {
    code: 'LAY_INSTALLMENT_003',
    httpStatus: 404,
    devMessage: 'Installment does not belong to this layaway plan',
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
  REV_DISABLED_001: {
    code: 'REV_DISABLED_001',
    httpStatus: 403,
    devMessage: 'Las reseñas están desactivadas para esta tienda',
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
  /**
   * 409 and not 500: the turn expiring, the panel closing, or a `stream_id` that
   * belongs to somebody else are all conditions of the CALLER's state, not server
   * faults. Reported as 500 they would page whoever watches the error rate every time
   * a person closed the panel mid-turn.
   */
  AI_AGENT_006: {
    code: 'AI_AGENT_006',
    httpStatus: 409,
    devMessage: 'No agent turn is awaiting this UI result',
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
  DSP_ORDER_FIND_001: {
    code: 'DSP_ORDER_FIND_001',
    httpStatus: 404,
    devMessage: 'Order not found for dispatch note creation',
  },
  DSP_ORDER_STATE_001: {
    code: 'DSP_ORDER_STATE_001',
    httpStatus: 400,
    devMessage:
      'Order is not in a state that allows generating a dispatch note',
  },
  DSP_ORDER_DELIVERY_001: {
    code: 'DSP_ORDER_DELIVERY_001',
    httpStatus: 400,
    devMessage:
      'Direct-delivery orders do not require a dispatch note (remisión)',
  },
  DSP_ORDER_ITEM_001: {
    code: 'DSP_ORDER_ITEM_001',
    httpStatus: 400,
    devMessage: 'Order item not found for dispatch note creation',
  },
  DSP_ORDER_TARGET_STATUS_001: {
    code: 'DSP_ORDER_TARGET_STATUS_001',
    httpStatus: 400,
    devMessage: 'Invalid dispatch note target_status',
  },
  DSP_ROUTE_ASSIGN_001: {
    code: 'DSP_ROUTE_ASSIGN_001',
    httpStatus: 400,
    devMessage:
      'Inconsistent route assignment configuration (e.g. mode=existing without route_id)',
  },
  DSP_ROUTE_NOT_EDITABLE_001: {
    code: 'DSP_ROUTE_NOT_EDITABLE_001',
    httpStatus: 409,
    devMessage: 'Route does not allow adding stops in its current state',
  },
  DSP_ROUTE_STOP_CONFLICT_001: {
    code: 'DSP_ROUTE_STOP_CONFLICT_001',
    httpStatus: 409,
    devMessage: 'Dispatch note is already assigned to this route',
  },
  DSP_NOTE_NOT_ELIGIBLE_001: {
    code: 'DSP_NOTE_NOT_ELIGIBLE_001',
    httpStatus: 409,
    devMessage:
      'La remisión no puede planillarse porque ya fue entregada, recibida, facturada o anulada.',
  },
  DISPATCH_NOTE_NO_SHIPPING_ADDRESS: {
    code: 'DISPATCH_NOTE_NO_SHIPPING_ADDRESS',
    httpStatus: 400,
    devMessage:
      'The order has no shipping address; a dispatch note (remisión) cannot be generated without a delivery address',
  },
  DISPATCH_NOTE_INSUFFICIENT_STOCK: {
    code: 'DISPATCH_NOTE_INSUFFICIENT_STOCK',
    httpStatus: 400,
    devMessage:
      'Insufficient stock at the resolved location for one or more dispatch note items',
  },
  DISPATCH_ROUTE_STOP_NO_ADDRESS: {
    code: 'DISPATCH_ROUTE_STOP_NO_ADDRESS',
    httpStatus: 400,
    devMessage:
      'One or more route stops have no delivery address; the route cannot be dispatched',
  },
  DISPATCH_ROUTE_PARTIAL_DISABLED: {
    code: 'DISPATCH_ROUTE_PARTIAL_DISABLED',
    httpStatus: 400,
    devMessage:
      'Partial deliveries are not enabled on dispatch routes; payment must be total (delivered) or the stop must be rejected/released',
  },
  DISPATCH_NOTE_INVALID_SUBTYPE_FOR_DIRECTION: {
    code: 'DISPATCH_NOTE_INVALID_SUBTYPE_FOR_DIRECTION',
    httpStatus: 400,
    devMessage:
      'The dispatch note subtype is not valid for the given direction (e.g. transfer_in requires inbound)',
  },
  DISPATCH_NOTE_CROSS_STORE_TRANSFER_BLOCKED: {
    code: 'DISPATCH_NOTE_CROSS_STORE_TRANSFER_BLOCKED',
    httpStatus: 403,
    devMessage:
      'Cross-store transfers are not allowed in STORE operating scope; switch to ORGANIZATION scope or use stock_transfers',
  },
  DISPATCH_NOTE_RETURN_REQUIRES_RELATED: {
    code: 'DISPATCH_NOTE_RETURN_REQUIRES_RELATED',
    httpStatus: 400,
    devMessage:
      'A customer return dispatch note requires related_dispatch_id pointing to the original outbound dispatch',
  },
  DISPATCH_NOTE_RECEIPT_REQUIRES_SUPPLIER: {
    code: 'DISPATCH_NOTE_RECEIPT_REQUIRES_SUPPLIER',
    httpStatus: 400,
    devMessage:
      'A purchase receipt dispatch note requires supplier_id',
  },
  DISPATCH_NOTE_VOID_INVOICED_REQUIRES_CREDIT_NOTE: {
    code: 'DISPATCH_NOTE_VOID_INVOICED_REQUIRES_CREDIT_NOTE',
    httpStatus: 409,
    devMessage:
      'Cannot void an invoiced dispatch note directly; issue a credit note via return_orders instead',
  },
  DISPATCH_NOTE_PO_LINE_UNRESOLVED: {
    code: 'DISPATCH_NOTE_PO_LINE_UNRESOLVED',
    httpStatus: 400,
    devMessage:
      'A dispatch note item pins a purchase_order_item_id that does not belong to the linked purchase order; the receipt cannot be delegated without a valid line reference',
  },
  DISPATCH_NOTE_NOTHING_RECEIVABLE: {
    code: 'DISPATCH_NOTE_NOTHING_RECEIVABLE',
    httpStatus: 400,
    devMessage:
      'No purchase order line could be resolved for this purchase_receipt dispatch note, so there is nothing to receive against the purchase order',
  },

  // Carrier / Repartos (Fase B6) — namespace /store/carrier/*
  CARRIER_CLAIM_TAKEN: {
    code: 'CARRIER_CLAIM_TAKEN',
    httpStatus: 409,
    devMessage:
      'This order was already claimed by another carrier (first-wins claim lost the race)',
  },
  CARRIER_NO_ACTIVE_ROUTE: {
    code: 'CARRIER_NO_ACTIVE_ROUTE',
    httpStatus: 404,
    devMessage: 'The carrier has no active route (draft/dispatched/in_transit)',
  },

  // Dispatch Note Receipt Scanner (purchase-receipt OCR via AI — R4c)
  DISPATCH_RECEIPT_SCAN_NO_FILE: {
    code: 'DISPATCH_RECEIPT_SCAN_NO_FILE',
    httpStatus: 400,
    devMessage: 'No receipt file provided',
  },
  DISPATCH_RECEIPT_SCAN_INVALID_FILE: {
    code: 'DISPATCH_RECEIPT_SCAN_INVALID_FILE',
    httpStatus: 400,
    devMessage: 'Invalid file type — only images and PDFs are accepted',
  },
  DISPATCH_RECEIPT_SCAN_AI_FAIL: {
    code: 'DISPATCH_RECEIPT_SCAN_AI_FAIL',
    httpStatus: 502,
    devMessage: 'AI purchase-receipt OCR processing failed',
  },
  DISPATCH_RECEIPT_SCAN_PARSE_FAIL: {
    code: 'DISPATCH_RECEIPT_SCAN_PARSE_FAIL',
    httpStatus: 422,
    devMessage: 'Failed to parse AI purchase-receipt response as valid JSON',
  },
  DISPATCH_RECEIPT_SCAN_NO_ITEMS: {
    code: 'DISPATCH_RECEIPT_SCAN_NO_ITEMS',
    httpStatus: 400,
    devMessage: 'No line items detected in the receipt document',
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
  BULK_PROD_UPLOAD_FAILED: {
    code: 'BULK_PROD_UPLOAD_FAILED',
    httpStatus: 500,
    devMessage: 'Bulk product upload failed unexpectedly',
  },
  BULK_PROD_REF_001: {
    code: 'BULK_PROD_REF_001',
    httpStatus: 404,
    devMessage: 'Referenced record not found during bulk product operation',
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
  /**
   * The model returned syntactically valid JSON but omitted a field the
   * scanner requires (supplier or a non-empty line_items). Kept distinct from
   * INV_SCAN_PARSE_FAIL: both used to surface as "no se pudo parsear el
   * JSON", which sent debugging down the wrong path — a POS receipt with no
   * printed invoice number or subtotal is an EXTRACTION gap, not a parser bug.
   *
   * `total` NO entra en esta lista: una factura multipágina devuelve todas sus
   * líneas con `total: null` porque el pie quedó fuera de la vista del modelo,
   * y exigirlo tiraba un escaneo íntegro. Se deriva sumando las líneas y se
   * avisa en `scan_warnings` (ver normalizeOcrResponse).
   */
  INV_SCAN_INCOMPLETE: {
    code: 'INV_SCAN_INCOMPLETE',
    httpStatus: 422,
    devMessage: 'AI OCR response parsed but is missing required fields',
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

  // Member Roster Scanner (bulk member import via AI)
  MEMBER_SCAN_NO_FILE: {
    code: 'MEMBER_SCAN_NO_FILE',
    httpStatus: 400,
    devMessage: 'No roster file provided',
  },
  MEMBER_SCAN_INVALID_FILE: {
    code: 'MEMBER_SCAN_INVALID_FILE',
    httpStatus: 400,
    devMessage: 'Invalid file type — only images and PDFs are accepted',
  },
  MEMBER_SCAN_AI_FAIL: {
    code: 'MEMBER_SCAN_AI_FAIL',
    httpStatus: 502,
    devMessage: 'AI member roster processing failed',
  },
  MEMBER_SCAN_PARSE_FAIL: {
    code: 'MEMBER_SCAN_PARSE_FAIL',
    httpStatus: 422,
    devMessage: 'Failed to parse AI member roster response as valid JSON',
  },
  MEMBER_BULK_EMPTY: {
    code: 'MEMBER_BULK_EMPTY',
    httpStatus: 400,
    devMessage: 'No members detected in the roster document',
  },
  MEMBER_BULK_TOO_MANY: {
    code: 'MEMBER_BULK_TOO_MANY',
    httpStatus: 400,
    devMessage: 'Too many members; maximum 200 per upload',
  },

  // Route Sheet Scanner (planilla de ruta extraction)
  RTSCAN_AI_FAIL: {
    code: 'RTSCAN_AI_FAIL',
    httpStatus: 502,
    devMessage: 'AI route sheet processing failed',
  },
  RTSCAN_PARSE_FAIL: {
    code: 'RTSCAN_PARSE_FAIL',
    httpStatus: 422,
    devMessage: 'Failed to parse AI route sheet response',
  },
  RTSCAN_NO_FILE: {
    code: 'RTSCAN_NO_FILE',
    httpStatus: 400,
    devMessage: 'No route sheet file provided',
  },
  RTSCAN_INVALID_FILE: {
    code: 'RTSCAN_INVALID_FILE',
    httpStatus: 400,
    devMessage: 'Invalid file type — only PDFs and images are accepted',
  },
  RTSCAN_MATCH_001: {
    code: 'RTSCAN_MATCH_001',
    httpStatus: 400,
    devMessage: 'Could not match a scanned row to a route stop',
  },

  // RUT Scanner (fiscal identity extraction)
  RUT_SCAN_AI_FAIL: {
    code: 'RUT_SCAN_AI_FAIL',
    httpStatus: 502,
    devMessage: 'AI RUT document extraction failed',
  },
  RUT_SCAN_PARSE_FAIL: {
    code: 'RUT_SCAN_PARSE_FAIL',
    httpStatus: 422,
    devMessage: 'Failed to parse AI RUT response as valid JSON',
  },
  RUT_SCAN_NO_FILE: {
    code: 'RUT_SCAN_NO_FILE',
    httpStatus: 400,
    devMessage: 'No RUT file provided',
  },
  RUT_SCAN_INVALID_FILE: {
    code: 'RUT_SCAN_INVALID_FILE',
    httpStatus: 400,
    devMessage: 'Invalid file type — only images and PDFs are accepted',
  },

  // DIAN Resolution Scanner (numbering resolution extraction)
  RESOLUTION_SCAN_AI_FAIL: {
    code: 'RESOLUTION_SCAN_AI_FAIL',
    httpStatus: 502,
    devMessage: 'AI DIAN resolution extraction failed',
  },
  RESOLUTION_SCAN_PARSE_FAIL: {
    code: 'RESOLUTION_SCAN_PARSE_FAIL',
    httpStatus: 422,
    devMessage: 'Failed to parse AI DIAN resolution response as valid JSON',
  },
  RESOLUTION_SCAN_NO_FILE: {
    code: 'RESOLUTION_SCAN_NO_FILE',
    httpStatus: 400,
    devMessage: 'No DIAN resolution file provided',
  },
  RESOLUTION_SCAN_INVALID_FILE: {
    code: 'RESOLUTION_SCAN_INVALID_FILE',
    httpStatus: 400,
    devMessage: 'Invalid file type — only images and PDFs are accepted',
  },

  // DIAN Habilitación Scanner (software + test set + test resolution)
  HABILITATION_SCAN_AI_FAIL: {
    code: 'HABILITATION_SCAN_AI_FAIL',
    httpStatus: 502,
    devMessage: 'AI DIAN habilitation extraction failed',
  },
  HABILITATION_SCAN_PARSE_FAIL: {
    code: 'HABILITATION_SCAN_PARSE_FAIL',
    httpStatus: 422,
    devMessage: 'Failed to parse AI DIAN habilitation response as valid JSON',
  },
  HABILITATION_SCAN_NO_FILE: {
    code: 'HABILITATION_SCAN_NO_FILE',
    httpStatus: 400,
    devMessage: 'No DIAN habilitation file provided',
  },
  HABILITATION_SCAN_INVALID_FILE: {
    code: 'HABILITATION_SCAN_INVALID_FILE',
    httpStatus: 400,
    devMessage: 'Invalid file type — only images and PDFs are accepted',
  },
  HABILITATION_SCAN_TOO_MANY_FILES: {
    code: 'HABILITATION_SCAN_TOO_MANY_FILES',
    httpStatus: 400,
    devMessage: 'Too many files — the habilitation scanner accepts up to 3',
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

  // Metadata Fields
  META_FIND_001: {
    code: 'META_FIND_001',
    httpStatus: 404,
    devMessage: 'Metadata field not found',
  },
  META_CREATE_001: {
    code: 'META_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating metadata field',
  },
  META_DUP_001: {
    code: 'META_DUP_001',
    httpStatus: 409,
    devMessage: 'Duplicate metadata field key',
  },
  META_VALIDATE_001: {
    code: 'META_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Invalid metadata value',
  },
  META_DEL_001: {
    code: 'META_DEL_001',
    httpStatus: 409,
    devMessage: 'Metadata field is used in a template',
  },

  // Data Collection
  DCOL_FIND_001: {
    code: 'DCOL_FIND_001',
    httpStatus: 404,
    devMessage: 'Data collection template not found',
  },
  DCOL_FIND_002: {
    code: 'DCOL_FIND_002',
    httpStatus: 404,
    devMessage: 'Submission not found',
  },
  DCOL_TOKEN_001: {
    code: 'DCOL_TOKEN_001',
    httpStatus: 404,
    devMessage: 'Invalid or expired token',
  },
  DCOL_TOKEN_002: {
    code: 'DCOL_TOKEN_002',
    httpStatus: 400,
    devMessage: 'Submission already completed',
  },
  DCOL_CREATE_001: {
    code: 'DCOL_CREATE_001',
    httpStatus: 400,
    devMessage: 'Error creating submission',
  },
  DCOL_DELETE_001: {
    code: 'DCOL_DELETE_001',
    httpStatus: 400,
    devMessage: 'Cannot delete template with existing submissions',
  },

  // Customer History
  CUST_HISTORY_001: {
    code: 'CUST_HISTORY_001',
    httpStatus: 404,
    devMessage: 'Customer history not found',
  },
  CUST_HISTORY_002: {
    code: 'CUST_HISTORY_002',
    httpStatus: 404,
    devMessage: 'Booking not found in history',
  },
  CUST_HISTORY_003: {
    code: 'CUST_HISTORY_003',
    httpStatus: 404,
    devMessage: 'Note not found',
  },

  // Booking Confirmation
  BOOK_CONFIRM_001: {
    code: 'BOOK_CONFIRM_001',
    httpStatus: 404,
    devMessage: 'Invalid or expired confirmation token',
  },
  BOOK_CONFIRM_002: {
    code: 'BOOK_CONFIRM_002',
    httpStatus: 400,
    devMessage: 'Token already used',
  },
  BOOK_CHECKIN_001: {
    code: 'BOOK_CHECKIN_001',
    httpStatus: 400,
    devMessage: 'Booking not in confirmed state',
  },
  BOOK_CHECKIN_002: {
    code: 'BOOK_CHECKIN_002',
    httpStatus: 400,
    devMessage: 'Already checked in',
  },

  // Email Templates
  EMAIL_TPL_001: {
    code: 'EMAIL_TPL_001',
    httpStatus: 404,
    devMessage: 'Email template not found',
  },

  // Shipping Assignment
  ORD_SHIP_LOCKED_001: {
    code: 'ORD_SHIP_LOCKED_001',
    httpStatus: 409,
    devMessage: 'Cannot change shipping method after order has been shipped',
  },

  // Order Fast-Track & Shipping Flow
  ORD_SHIP_REQUIRED_FOR_FLOW_001: {
    code: 'ORD_SHIP_REQUIRED_FOR_FLOW_001',
    httpStatus: 400,
    devMessage: 'Esta orden requiere un metodo de envio antes de continuar.',
  },
  ORD_SHIP_NO_RATE_FOR_ADDRESS_001: {
    code: 'ORD_SHIP_NO_RATE_FOR_ADDRESS_001',
    httpStatus: 422,
    devMessage:
      'No hay tarifas configuradas para la direccion del cliente en este metodo.',
  },
  ORD_FAST_TRACK_INVALID_STATE_001: {
    code: 'ORD_FAST_TRACK_INVALID_STATE_001',
    httpStatus: 400,
    devMessage: 'La orden ya esta finalizada, cancelada o reembolsada.',
  },
  ORD_FAST_TRACK_PAYMENT_REQUIRED_001: {
    code: 'ORD_FAST_TRACK_PAYMENT_REQUIRED_001',
    httpStatus: 400,
    devMessage:
      'Se requiere informacion de pago para procesar la orden completa.',
  },

  // ===== SaaS Subscriptions =====
  SUBSCRIPTION_001: {
    code: 'SUBSCRIPTION_001',
    httpStatus: 404,
    devMessage: 'No subscription found for this store',
  },
  SUBSCRIPTION_002: {
    code: 'SUBSCRIPTION_002',
    httpStatus: 402,
    devMessage: 'Subscription is in draft state; activation required',
  },
  SUBSCRIPTION_003: {
    code: 'SUBSCRIPTION_003',
    httpStatus: 403,
    devMessage: 'Subscription is cancelled/expired',
  },
  SUBSCRIPTION_004: {
    code: 'SUBSCRIPTION_004',
    httpStatus: 403,
    devMessage: 'Store has no active subscription for AI features',
  },
  SUBSCRIPTION_005: {
    code: 'SUBSCRIPTION_005',
    httpStatus: 403,
    devMessage: 'Feature not included in your current plan',
  },
  SUBSCRIPTION_006: {
    code: 'SUBSCRIPTION_006',
    httpStatus: 429,
    devMessage: 'AI quota exceeded for this billing period',
  },
  SUBSCRIPTION_007: {
    code: 'SUBSCRIPTION_007',
    httpStatus: 200,
    devMessage: 'Subscription past due — degraded mode',
  },
  SUBSCRIPTION_008: {
    code: 'SUBSCRIPTION_008',
    httpStatus: 402,
    devMessage: 'Subscription suspended due to unpaid balance',
  },
  SUBSCRIPTION_009: {
    code: 'SUBSCRIPTION_009',
    httpStatus: 402,
    devMessage: 'Subscription blocked — resolve billing to continue',
  },
  SUBSCRIPTION_010: {
    code: 'SUBSCRIPTION_010',
    httpStatus: 409,
    devMessage: 'Invalid subscription state transition',
  },
  SUBSCRIPTION_011: {
    code: 'SUBSCRIPTION_011',
    httpStatus: 402,
    devMessage: 'Plan retired — choose an active plan to continue',
  },
  /**
   * The client organization lacks the fiscal identity DIAN requires from the
   * adquiriente (NIT, DV, document type, legal name, or billing address).
   *
   * This is checked BEFORE the fiscal consecutive is allocated: a rejected
   * document still burns its number, and a numbering resolution has a finite
   * range, so emitting a knowingly-incomplete document trades a permanent hole
   * in the sequence for a rejection that was predictable.
   */
  SUBSCRIPTION_FISCAL_001: {
    code: 'SUBSCRIPTION_FISCAL_001',
    httpStatus: 412,
    devMessage:
      'The organization is missing fiscal data required by DIAN for the acquirer party',
  },
  /**
   * La identidad fiscal del adquiriente ESTÁ completa —todos los campos
   * presentes— pero no es emitible: el DV no corresponde al NIT, el municipio
   * no pertenece al departamento, el correo no tiene forma de correo, o el tipo
   * de documento contradice al tipo de persona.
   *
   * Es un código distinto de `SUBSCRIPTION_FISCAL_001` a propósito. «Falta un
   * dato» y «el dato que diste no cuadra» se arreglan en pantallas distintas y
   * con instrucciones distintas, y colapsarlos en un 412 obligaba a la UI a
   * adivinar cuál de los dos estaba viendo.
   *
   * 422, no 412: la petición llegó bien formada y con todo lo exigido; lo que
   * no se puede procesar es su CONTENIDO. `details.blockers[]` trae un
   * `{ code, field, problem, fix }` por defecto, tal como lo devuelve
   * `CustomerFiscalIdentityValidator`, para que la pantalla nombre el clic
   * exacto en vez de decir «datos inválidos».
   *
   * Se emite ANTES de crear la factura y de abrir el widget de pago. Ese orden
   * es el punto entero: cobrarle a un cliente y descubrir después que su
   * documento no emite deja el dinero adentro y la factura afuera, que fue
   * exactamente lo que pasó el 17/08/2026.
   */
  SUBSCRIPTION_FISCAL_002: {
    code: 'SUBSCRIPTION_FISCAL_002',
    httpStatus: 422,
    devMessage:
      'The acquirer fiscal identity is complete but not emittable — see details.blockers',
  },
  SUBSCRIPTION_INTERNAL_ERROR: {
    code: 'SUBSCRIPTION_INTERNAL_ERROR',
    httpStatus: 500,
    devMessage: 'Internal error while resolving subscription access',
  },
  SUBSCRIPTION_VALIDATION: {
    code: 'SUBSCRIPTION_VALIDATION',
    httpStatus: 400,
    devMessage: 'Subscription checkout validation failed',
  },
  SUBSCRIPTION_PAY_001: {
    code: 'SUBSCRIPTION_PAY_001',
    httpStatus: 400,
    devMessage: 'Subscription payment method missing or disabled',
  },
  SUBSCRIPTION_PRORATION_001: {
    code: 'SUBSCRIPTION_PRORATION_001',
    httpStatus: 400,
    devMessage: 'Invalid proration parameters',
  },
  SUBSCRIPTION_PROMO_002: {
    code: 'SUBSCRIPTION_PROMO_002',
    httpStatus: 409,
    devMessage: 'Store does not meet promotional plan eligibility rules',
  },

  SUBSCRIPTION_TOKEN_INVALID: {
    code: 'SUBSCRIPTION_TOKEN_INVALID',
    httpStatus: 400,
    devMessage: 'Wompi provider token is invalid or expired',
  },
  SUBSCRIPTION_CARD_DECLINED: {
    code: 'SUBSCRIPTION_CARD_DECLINED',
    httpStatus: 402,
    devMessage: 'Card was declined or blocked by the payment provider',
  },
  SUBSCRIPTION_PROVIDER_UNAVAILABLE: {
    code: 'SUBSCRIPTION_PROVIDER_UNAVAILABLE',
    httpStatus: 503,
    devMessage: 'Payment provider is unavailable or timed out',
  },

  // Platform-level payment gateway (superadmin/subscriptions/gateway)
  SUBSCRIPTION_GATEWAY_001: {
    code: 'SUBSCRIPTION_GATEWAY_001',
    httpStatus: 400,
    devMessage: 'Credenciales inválidas para entorno de producción',
  },
  SUBSCRIPTION_GATEWAY_002: {
    code: 'SUBSCRIPTION_GATEWAY_002',
    httpStatus: 400,
    devMessage: 'Test de conexión requerido antes de activar producción',
  },
  SUBSCRIPTION_GATEWAY_003: {
    code: 'SUBSCRIPTION_GATEWAY_003',
    httpStatus: 404,
    devMessage: 'Credenciales no configuradas',
  },

  // Partner / reseller
  PARTNER_001: {
    code: 'PARTNER_001',
    httpStatus: 403,
    devMessage: 'Organization is not a partner reseller',
  },
  PARTNER_002: {
    code: 'PARTNER_002',
    httpStatus: 422,
    devMessage: 'Margin exceeds base plan maximum',
  },
  PARTNER_003: {
    code: 'PARTNER_003',
    httpStatus: 422,
    devMessage: 'Partner cannot enable features beyond base plan',
  },
  PARTNER_004: {
    code: 'PARTNER_004',
    httpStatus: 409,
    devMessage: 'Commission payout already processed',
  },

  // Promotional plans
  PROMO_001: {
    code: 'PROMO_001',
    httpStatus: 409,
    devMessage: 'Promotional plan no longer eligible',
  },
  PROMO_NOT_ELIGIBLE: {
    code: 'PROMO_NOT_ELIGIBLE',
    httpStatus: 400,
    devMessage: 'Store does not meet promotional plan eligibility rules',
  },

  // Plans
  PLAN_001: {
    code: 'PLAN_001',
    httpStatus: 409,
    devMessage: 'Plan is archived and cannot be subscribed to',
  },
  PLAN_002: {
    code: 'PLAN_002',
    httpStatus: 403,
    devMessage: 'Plan is not marked resellable',
  },

  // Trial
  TRIAL_001: {
    code: 'TRIAL_001',
    httpStatus: 402,
    devMessage: 'Trial ended; choose a plan to continue',
  },
  SUBSCRIPTION_TRIAL_001: {
    code: 'SUBSCRIPTION_TRIAL_001',
    httpStatus: 409,
    devMessage: 'Trial ya consumido',
  },

  // Dunning
  DUNNING_001: {
    code: 'DUNNING_001',
    httpStatus: 400,
    devMessage: 'No payable invoice available for retry',
  },

  // Fiscal scope
  FISCAL_SCOPE_INVALID_VALUE: {
    code: 'FISCAL_SCOPE_INVALID_VALUE',
    httpStatus: 400,
    devMessage: 'Invalid fiscal scope value',
  },
  FISCAL_SCOPE_INVALID_COMBINATION: {
    code: 'FISCAL_SCOPE_INVALID_COMBINATION',
    httpStatus: 409,
    devMessage: 'Invalid operating/fiscal scope combination',
  },
  FISCAL_SCOPE_CHANGE_BLOCKED: {
    code: 'FISCAL_SCOPE_CHANGE_BLOCKED',
    httpStatus: 409,
    devMessage: 'Fiscal scope change blocked by pre-conditions',
  },
  FISCAL_SCOPE_FORCE_REASON_REQUIRED: {
    code: 'FISCAL_SCOPE_FORCE_REASON_REQUIRED',
    httpStatus: 400,
    devMessage: 'Force fiscal scope change requires a reason',
  },
  FISCAL_SCOPE_ACCOUNTING_ENTITY_NOT_FOUND: {
    code: 'FISCAL_SCOPE_ACCOUNTING_ENTITY_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Accounting entity does not belong to this organization',
  },

  // Fiscal status
  FISCAL_STATUS_LOCKED: {
    code: 'FISCAL_STATUS_LOCKED',
    httpStatus: 409,
    devMessage: 'Fiscal status is locked by existing fiscal records',
  },
  FISCAL_STATUS_INVALID_TRANSITION: {
    code: 'FISCAL_STATUS_INVALID_TRANSITION',
    httpStatus: 409,
    devMessage: 'Invalid fiscal status transition',
  },
  FISCAL_STATUS_WIZARD_STEP_INVALID: {
    code: 'FISCAL_STATUS_WIZARD_STEP_INVALID',
    httpStatus: 400,
    devMessage: 'Invalid fiscal status wizard step',
  },
  FISCAL_STATUS_DEACTIVATION_BLOCKED: {
    code: 'FISCAL_STATUS_DEACTIVATION_BLOCKED',
    httpStatus: 409,
    devMessage: 'Fiscal status deactivation is blocked',
  },
  FISCAL_STATUS_CONCURRENT_UPDATE: {
    code: 'FISCAL_STATUS_CONCURRENT_UPDATE',
    httpStatus: 409,
    devMessage: 'Fiscal status was updated concurrently',
  },
  FISCAL_STATUS_PERMISSION_DENIED: {
    code: 'FISCAL_STATUS_PERMISSION_DENIED',
    httpStatus: 403,
    devMessage: 'Fiscal status permission denied',
  },
  FISCAL_STATUS_INCOMPLETE: {
    code: 'FISCAL_STATUS_INCOMPLETE',
    httpStatus: 409,
    devMessage: 'Fiscal area cannot be activated with incomplete required steps',
  },

  // Multi-tarifa (Price Tiers)
  PRICE_TIER_FIND_001: {
    code: 'PRICE_TIER_FIND_001',
    httpStatus: 404,
    devMessage: 'Tarifa de precios no encontrada',
  },
  PRICE_TIER_DUP_001: {
    code: 'PRICE_TIER_DUP_001',
    httpStatus: 409,
    devMessage: 'Ya existe una tarifa con ese nombre en la tienda',
  },
  PRICE_TIER_VALIDATE_001: {
    code: 'PRICE_TIER_VALIDATE_001',
    httpStatus: 400,
    devMessage: 'Datos inválidos para la tarifa de precios',
  },
  PRICE_TIER_NOT_ALLOWED: {
    code: 'PRICE_TIER_NOT_ALLOWED',
    httpStatus: 422,
    devMessage: 'La tarifa seleccionada no está habilitada para este producto',
  },
  PRICING_TIER_PERMISSION_DENIED: {
    code: 'PRICING_TIER_PERMISSION_DENIED',
    httpStatus: 403,
    devMessage:
      'No tiene permiso para aplicar tarifas de precios (multi-tarifa)',
  },
  PRICE_TIER_OVERRIDE_PRODUCT_001: {
    code: 'PRICE_TIER_OVERRIDE_PRODUCT_001',
    httpStatus: 404,
    devMessage: 'Producto no encontrado para asignar override de tarifa',
  },
  PROD_UOM_NOT_STOCK_ELIGIBLE: {
    code: 'PROD_UOM_NOT_STOCK_ELIGIBLE',
    httpStatus: 400,
    devMessage:
      'Esta unidad no puede ser la unidad de stock: su factor de conversión no es entero y el inventario se lleva en enteros de la unidad base. Úsala como unidad de compra o de presentación.',
  },
  PROD_UOM_CONVERSION_REQUIRED: {
    code: 'PROD_UOM_CONVERSION_REQUIRED',
    httpStatus: 400,
    devMessage:
      'El producto tiene existencias, capas de costo, lotes o recetas expresados en su unidad de stock actual. Cambiar la unidad exige el flag explícito `stock_uom_conversion: "convert"`, que convierte todo en la misma transacción.',
  },
  PRODUCT_TIERS_VARIANTS_EXCLUSIVE: {
    code: 'PRODUCT_TIERS_VARIANTS_EXCLUSIVE',
    httpStatus: 409,
    devMessage:
      'Multi-tarifa y variantes son excluyentes: un producto que se vende en varias presentaciones no puede tener variantes. Elimina las variantes o desactiva multi-tarifa.',
  },
  PRICE_TIER_KIND_LOCKED: {
    code: 'PRICE_TIER_KIND_LOCKED',
    httpStatus: 409,
    devMessage:
      'La presentación ya tiene ventas con descuento de stock por empaque: no puede convertirse en tarifa de cliente',
  },
  PRICE_TIER_DEFAULT_NOT_SALE_UNIT: {
    code: 'PRICE_TIER_DEFAULT_NOT_SALE_UNIT',
    httpStatus: 422,
    devMessage:
      'Solo una unidad de venta puede marcarse como presentación por defecto del producto',
  },

  // notification sounds
  NOTIFICATION_SOUND_INVALID: {
    code: 'NOTIFICATION_SOUND_INVALID',
    httpStatus: 400,
    devMessage:
      'Archivo de sonido inválido (debe ser audio/mpeg y pesar como máximo 300 KB).',
  },
  NOTIFICATION_SOUND_IN_USE: {
    code: 'NOTIFICATION_SOUND_IN_USE',
    httpStatus: 409,
    devMessage:
      'El sonido está siendo usado por una o más tiendas y no puede eliminarse.',
  },

  // Help Center
  HELP_ARTICLE_NOT_FOUND: {
    code: 'HELP_ARTICLE_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Help article not found',
  },
  HELP_CATEGORY_NOT_FOUND: {
    code: 'HELP_CATEGORY_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Help category not found',
  },
  HELP_CATEGORY_HAS_ARTICLES: {
    code: 'HELP_CATEGORY_HAS_ARTICLES',
    httpStatus: 409,
    devMessage: 'Cannot delete category with associated articles',
  },
  HELP_IMAGE_REQUIRED: {
    code: 'HELP_IMAGE_REQUIRED',
    httpStatus: 400,
    devMessage: 'Image file is required',
  },
  HELP_IMAGE_TYPE_INVALID: {
    code: 'HELP_IMAGE_TYPE_INVALID',
    httpStatus: 400,
    devMessage:
      'Only image files are allowed (JPEG, PNG, WebP, GIF, BMP, TIFF, SVG, HEIC, AVIF)',
  },
  HELP_IMAGE_TOO_LARGE: {
    code: 'HELP_IMAGE_TOO_LARGE',
    httpStatus: 400,
    devMessage: 'Image file must be smaller than 10MB',
  },

  // Legal (public)
  LEGAL_DOCUMENT_TYPE_INVALID: {
    code: 'LEGAL_DOCUMENT_TYPE_INVALID',
    httpStatus: 400,
    devMessage: 'Unsupported legal document type',
  },

  // Recipes (BOM) — Restaurant Suite Fase B
  RECIPE_NOT_FOUND: {
    code: 'RECIPE_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Receta no encontrada',
  },
  RECIPE_DUP_PRODUCT: {
    code: 'RECIPE_DUP_PRODUCT',
    httpStatus: 409,
    devMessage: 'Ya existe una receta para este producto en la tienda',
  },
  RECIPE_YIELD_PRODUCT_NOT_FOUND: {
    code: 'RECIPE_YIELD_PRODUCT_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'El producto de rendimiento no existe o no pertenece a la tienda',
  },
  RECIPE_COMPONENT_NOT_FOUND: {
    code: 'RECIPE_COMPONENT_NOT_FOUND',
    httpStatus: 404,
    devMessage:
      'El producto componente no existe o no pertenece a la tienda',
  },
  RECIPE_SELF_REFERENCE: {
    code: 'RECIPE_SELF_REFERENCE',
    httpStatus: 422,
    devMessage: 'Una receta no puede ser su propio componente',
  },
  RECIPE_CYCLE_DETECTED: {
    code: 'RECIPE_CYCLE_DETECTED',
    httpStatus: 422,
    devMessage:
      'La asignación generaría un ciclo en la jerarquía de sub-recetas',
  },
  RECIPE_ITEM_DUP: {
    code: 'RECIPE_ITEM_DUP',
    httpStatus: 409,
    devMessage:
      'Ya existe un componente con este producto en la receta',
  },
  RECIPE_ITEM_NOT_FOUND: {
    code: 'RECIPE_ITEM_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Componente de receta no encontrado',
  },
  RECIPE_ITEM_INVALID_QUANTITY: {
    code: 'RECIPE_ITEM_INVALID_QUANTITY',
    httpStatus: 422,
    devMessage:
      'La cantidad del sub-componente debe ser mayor a 0 (no se permite 0 ni nula)',
  },
  RECIPE_ACTIVATION_BLOCKED_INVALID_ITEMS: {
    code: 'RECIPE_ACTIVATION_BLOCKED_INVALID_ITEMS',
    httpStatus: 409,
    devMessage:
      'La receta no puede activarse porque tiene sub-componentes con cantidad invalida (0 o nula). Corregir antes de activar.',
  },
  /**
   * `recipe_items` sólo tiene `component_product_id`: no hay columna de
   * variante. Un insumo con variantes hace que el consumo vaya a la fila BASE
   * del stock —la que en un producto con variantes está vacía—, así que la
   * producción descontaría de un saldo que no existe y el inventario real
   * quedaría intacto. En vez de agregar la columna (funcionalidad nueva), la
   * decisión de producto es que un insumo NO tiene variantes.
   */
  RECIPE_COMPONENT_HAS_VARIANTS: {
    code: 'RECIPE_COMPONENT_HAS_VARIANTS',
    httpStatus: 422,
    devMessage:
      'Un producto con variantes no puede usarse como insumo de una receta. Crea un producto simple por cada presentación que la receta consuma.',
  },
  /**
   * Cara opuesta del mismo invariante: bloquear sólo al agregar el insumo
   * dejaría abierta la puerta de crear la variante DESPUÉS, y el resultado
   * sería idéntico (consumo contra la fila base vacía) pero sin error visible.
   */
  PRODUCT_VARIANT_BLOCKED_IS_RECIPE_COMPONENT: {
    code: 'PRODUCT_VARIANT_BLOCKED_IS_RECIPE_COMPONENT',
    httpStatus: 422,
    devMessage:
      'Este producto se usa como insumo en una receta, así que no admite variantes. Quítalo de las recetas que lo consumen antes de variantizarlo.',
  },

  // Production Orders (sub-recipe batch stock) — Restaurant Suite Fase C
  PRODUCTION_ORDER_NOT_FOUND: {
    code: 'PRODUCTION_ORDER_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Orden de producción no encontrada',
  },
  PRODUCTION_ORDER_INVALID_STATE: {
    code: 'PRODUCTION_ORDER_INVALID_STATE',
    httpStatus: 409,
    devMessage: 'Transición de estado inválida para la orden de producción',
  },
  PRODUCTION_ORDER_NOT_BATCH: {
    code: 'PRODUCTION_ORDER_NOT_BATCH',
    httpStatus: 422,
    devMessage:
      'El producto no admite producción en lote (no es `prepared` o no tiene `is_batch_produced=true`)',
  },
  PRODUCTION_RECIPE_MISMATCH: {
    code: 'PRODUCTION_RECIPE_MISMATCH',
    httpStatus: 422,
    devMessage: 'La receta no pertenece al producto seleccionado',
  },
  PRODUCTION_RECIPE_INACTIVE: {
    code: 'PRODUCTION_RECIPE_INACTIVE',
    httpStatus: 422,
    devMessage: 'La receta está inactiva',
  },
  PRODUCTION_RECIPE_EMPTY: {
    code: 'PRODUCTION_RECIPE_EMPTY',
    httpStatus: 422,
    devMessage: 'La receta no tiene componentes para consumir',
  },
  PRODUCTION_INVALID_QTY: {
    code: 'PRODUCTION_INVALID_QTY',
    httpStatus: 422,
    devMessage: 'La cantidad producida debe ser mayor a 0',
  },
  // ── Kitchen Fire (Restaurant Suite Fase D) ─────────────────────────
  KITCHEN_FIRE_ORDER_NOT_FOUND: {
    code: 'KITCHEN_FIRE_ORDER_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Orden no encontrada para enviar a cocina',
  },
  KITCHEN_FIRE_ITEM_NOT_FOUND: {
    code: 'KITCHEN_FIRE_ITEM_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Item de orden no encontrado o no pertenece a la orden',
  },
  KITCHEN_FIRE_NO_ITEMS: {
    code: 'KITCHEN_FIRE_NO_ITEMS',
    httpStatus: 422,
    devMessage: 'Debe proporcionar al menos un order_item_id para enviar a cocina',
  },
  KITCHEN_FIRE_ALL_ALREADY_CONSUMED: {
    code: 'KITCHEN_FIRE_ALL_ALREADY_CONSUMED',
    httpStatus: 409,
    devMessage: 'Todos los items ya fueron enviados a cocina (idempotente)',
  },
  // QUI-651 — el fire rutea cada item a su estacion y cae en el KDS por defecto
  // cuando el plato no declara uno. Sin KDS por defecto no hay a donde rutear:
  // se falla fuerte en vez de mandar el ticket a un tablero que nadie mira.
  KITCHEN_FIRE_NO_DEFAULT_KDS: {
    code: 'KITCHEN_FIRE_NO_DEFAULT_KDS',
    httpStatus: 422,
    devMessage:
      'La tienda no tiene un KDS por defecto activo al cual rutear el ticket',
  },
  // QUI-655 — el cliente no puede excluir un producto arbitrario del consumo:
  // el componente tiene que pertenecer al BOM explotado de ESE plato, o el
  // consumo dejaría de reflejar la receta y el costeo se volvería inauditable.
  KITCHEN_FIRE_EXCLUSION_NOT_IN_BOM: {
    code: 'KITCHEN_FIRE_EXCLUSION_NOT_IN_BOM',
    httpStatus: 422,
    devMessage:
      'El componente excluido no pertenece a la receta explotada de ese plato',
  },
  // ── KDS: estaciones de preparación (QUI-651) ────────────────────────
  KDS_NOT_FOUND: {
    code: 'KDS_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Estación de cocina no encontrada',
  },
  KDS_DUP_CODE: {
    code: 'KDS_DUP_CODE',
    httpStatus: 409,
    devMessage: 'Ya existe una estación de cocina con ese código',
  },
  // El fire rutea con `products.kds_id ?? <default>`, así que degradar o
  // desactivar el default dejaría a la tienda sin destino para sus tickets.
  KDS_DEFAULT_PROTECTED: {
    code: 'KDS_DEFAULT_PROTECTED',
    httpStatus: 409,
    devMessage:
      'No se puede desactivar ni degradar la estación por defecto sin promover otra antes',
  },
  KDS_DEFAULT_MUST_BE_ACTIVE: {
    code: 'KDS_DEFAULT_MUST_BE_ACTIVE',
    httpStatus: 422,
    devMessage:
      'La estación por defecto debe estar activa: el fire filtra por is_active',
  },
  KDS_HAS_OPEN_SESSION: {
    code: 'KDS_HAS_OPEN_SESSION',
    httpStatus: 409,
    devMessage:
      'La estación tiene una sesión abierta: ciérrala antes de desactivarla',
  },
  KDS_SESSION_NOT_FOUND: {
    code: 'KDS_SESSION_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Sesión de estación no encontrada',
  },
  // La sesión RECLAMA la estación. El índice único parcial
  // `kds_sessions_one_open_per_kds` es la garantía real; este código traduce su
  // P2002 para que dos operadores concurrentes reciban un mensaje legible.
  KDS_SESSION_ALREADY_OPEN: {
    code: 'KDS_SESSION_ALREADY_OPEN',
    httpStatus: 409,
    devMessage: 'La estación ya tiene una sesión abierta',
  },
  KDS_SESSION_ALREADY_CLOSED: {
    code: 'KDS_SESSION_ALREADY_CLOSED',
    httpStatus: 409,
    devMessage: 'La sesión de estación ya está cerrada',
  },
  // QUI-652 — la entrega es un hecho de servicio y aplica a todo item, pero un
  // plato preparado sigue exigiendo estado 'ready' en cocina: dejar que el
  // mesero marque entregado un plato sin cocinar haria mentir al KDS.
  TABLE_SESSION_ITEM_NOT_DELIVERABLE: {
    code: 'TABLE_SESSION_ITEM_NOT_DELIVERABLE',
    httpStatus: 409,
    devMessage:
      'El plato preparado debe estar listo en cocina antes de marcarse entregado',
  },
  KITCHEN_FIRE_NO_RECIPE: {
    code: 'KITCHEN_FIRE_NO_RECIPE',
    httpStatus: 422,
    devMessage: 'El producto preparado no tiene una receta activa asociada',
  },
  KITCHEN_FIRE_RECIPE_INACTIVE: {
    code: 'KITCHEN_FIRE_RECIPE_INACTIVE',
    httpStatus: 422,
    devMessage: 'La receta asociada al producto está inactiva',
  },
  // Plan KDS fire-flows: el endpoint de fire selectivo (POST /store/kitchen-fire)
  // se gatea a tiendas con industria 'restaurant'. Esta tienda no la tiene.
  RESTAURANT_NOT_ENABLED: {
    code: 'RESTAURANT_NOT_ENABLED',
    httpStatus: 422,
    devMessage:
      'Esta tienda no tiene habilitada la industria restaurant; el envio a cocina (KDS) no esta disponible',
  },
  // ── Tables & Table Sessions (Restaurant Suite Fase E) ─────────
  TABLE_NOT_FOUND: {
    code: 'TABLE_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Mesa no encontrada',
  },
  TABLE_DUP_NAME: {
    code: 'TABLE_DUP_NAME',
    httpStatus: 409,
    devMessage: 'Ya existe una mesa con ese nombre en la tienda',
  },
  TABLE_INVALID_STATUS: {
    code: 'TABLE_INVALID_STATUS',
    httpStatus: 409,
    devMessage:
      'Estado de mesa no válido para la operación solicitada',
  },
  TABLE_SESSION_NOT_FOUND: {
    code: 'TABLE_SESSION_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Sesión de mesa no encontrada',
  },
  TABLE_SESSION_ALREADY_OPEN: {
    code: 'TABLE_SESSION_ALREADY_OPEN',
    httpStatus: 409,
    devMessage: 'La mesa ya tiene una sesión abierta',
  },
  TABLE_SESSION_CLOSED: {
    code: 'TABLE_SESSION_CLOSED',
    httpStatus: 409,
    devMessage:
      'La sesión de mesa está cerrada; no se pueden agregar más items',
  },
  TABLE_SESSION_ORDER_NOT_DRAFT: {
    code: 'TABLE_SESSION_ORDER_NOT_DRAFT',
    httpStatus: 409,
    devMessage:
      'La orden asociada a la sesión no está en estado draft',
  },
  TABLE_SESSION_ADD_ITEMS_INVALID: {
    code: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    httpStatus: 422,
    devMessage:
      'Items inválidos para agregar a la sesión de mesa',
  },
  TABLE_SESSION_CUSTOMER_REQUIRED: {
    code: 'TABLE_SESSION_CUSTOMER_REQUIRED',
    httpStatus: 409,
    devMessage:
      'Customer is required to open a table when anonymous sales are disabled',
  },
  TABLE_SESSION_ITEM_NOT_REMOVABLE: {
    code: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    httpStatus: 409,
    devMessage:
      'Cannot remove an item already being prepared in the kitchen',
  },
  TABLE_GUEST_COUNT_EXCEEDS_CAPACITY: {
    code: 'TABLE_GUEST_COUNT_EXCEEDS_CAPACITY',
    httpStatus: 422,
    devMessage:
      'El número de comensales excede la capacidad de la mesa',
  },
  // ── Split Order (Restaurant Suite Fase E) ────────────────────
  SPLIT_ORDER_NOT_FOUND: {
    code: 'SPLIT_ORDER_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Orden a dividir no encontrada',
  },
  SPLIT_ORDER_NOT_DRAFT: {
    code: 'SPLIT_ORDER_NOT_DRAFT',
    httpStatus: 409,
    devMessage:
      'Solo se pueden dividir órdenes en estado draft (cuenta abierta)',
  },
  SPLIT_ORDER_EMPTY: {
    code: 'SPLIT_ORDER_EMPTY',
    httpStatus: 422,
    devMessage: 'La orden no tiene items para dividir',
  },
  SPLIT_ORDER_ITEMS_MISSING: {
    code: 'SPLIT_ORDER_ITEMS_MISSING',
    httpStatus: 422,
    devMessage:
      'Los grupos de items para dividir deben cubrir todos los items de la orden (sin solapamientos)',
  },
  SPLIT_ORDER_INVALID_NSPLITS: {
    code: 'SPLIT_ORDER_INVALID_NSPLITS',
    httpStatus: 422,
    devMessage: 'El número de partes para dividir debe ser >= 2',
  },
  // ── KDS (Restaurant Suite Fase F) ──────────────────────────────
  KITCHEN_TICKET_NOT_FOUND: {
    code: 'KITCHEN_TICKET_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Ticket de cocina no encontrado',
  },
  KITCHEN_TICKET_INVALID_STATE: {
    code: 'KITCHEN_TICKET_INVALID_STATE',
    httpStatus: 409,
    devMessage: 'Transición de estado del ticket no permitida',
  },
  // Restaurant Suite — Fase K audit jun-2026: explicit operator-friendly
  // codes for the common invalid transitions surfaced by the table-session
  // panel ("Marcar entregado" cuando el plato aún está pendiente) and the
  // KDS board (cualquier click sobre un ticket terminal). Each carries the
  // current state in `details.from` and the attempted transition in
  // `details.to`, plus a Spanish `hint` for UX. Frontend maps the codes to
  // specific toasts via error-messages.ts.
  KITCHEN_TICKET_NOT_READY: {
    code: 'KITCHEN_TICKET_NOT_READY',
    httpStatus: 409,
    devMessage:
      'No se puede marcar como entregado: el plato aún está pendiente o en preparación en cocina',
  },
  KITCHEN_TICKET_ALREADY_DELIVERED: {
    code: 'KITCHEN_TICKET_ALREADY_DELIVERED',
    httpStatus: 409,
    devMessage: 'Este plato ya fue marcado como entregado',
  },
  KITCHEN_TICKET_ALREADY_CANCELLED: {
    code: 'KITCHEN_TICKET_ALREADY_CANCELLED',
    httpStatus: 409,
    devMessage: 'Este plato ya fue cancelado en cocina',
  },
  KITCHEN_TICKET_ALREADY_IN_PREPARATION: {
    code: 'KITCHEN_TICKET_ALREADY_IN_PREPARATION',
    httpStatus: 409,
    devMessage: 'El ticket ya está en preparación',
  },
  KITCHEN_TICKET_ALREADY_READY: {
    code: 'KITCHEN_TICKET_ALREADY_READY',
    httpStatus: 409,
    devMessage: 'El ticket ya está listo para entregar',
  },
  // Restaurant Suite — Fase K Gap 3: the ticket contains a `prepared`
  // product with no active recipe; advancing to in_preparation is
  // blocked because the kitchen would have no BOM to deduct stock
  // from. The ticket must remain in `pending` until the operator
  // attaches a recipe (or the operator cooks it manually and marks
  // it delivered directly).
  KITCHEN_TICKET_NO_RECIPE: {
    code: 'KITCHEN_TICKET_NO_RECIPE',
    httpStatus: 422,
    devMessage: 'El ticket contiene un plato sin receta activa; no se puede iniciar la preparación',
  },
  // Restaurant Suite — reversa de estado del ticket (KDS "un paso atrás"):
  // el ticket ya está en su estado inicial (`pending`) y no existe un
  // estado previo al que retroceder.
  KITCHEN_TICKET_CANNOT_REVERT: {
    code: 'KITCHEN_TICKET_CANNOT_REVERT',
    httpStatus: 409,
    devMessage: 'El ticket está en su estado inicial y no se puede revertir.',
  },
  // Restaurant Suite — reversa de estado del ticket: revertir un ticket
  // terminal (delivered/cancelled) implicaría revertir la entrega de la
  // orden asociada, pero la orden ya está finalizada/reembolsada y no
  // admite esa reversa.
  KITCHEN_TICKET_REVERT_ORDER_FINISHED: {
    code: 'KITCHEN_TICKET_REVERT_ORDER_FINISHED',
    httpStatus: 409,
    devMessage: 'La orden ya está finalizada; no se puede revertir la entrega del ticket.',
  },
  KITCHEN_TICKET_STREAM_NO_CONTEXT: {
    code: 'KITCHEN_TICKET_STREAM_NO_CONTEXT',
    httpStatus: 400,
    devMessage: 'No hay contexto de tienda para abrir el stream KDS',
  },
  // Restaurant Suite — F2-guard: una orden NUNCA puede pasar a `finished`
  // si tiene `kitchen_ticket_items` sin entregar (status NOT IN
  // ('delivered','cancelled')). Se lanza solo en el cierre MANUAL
  // (`confirmDelivery`); los flujos automáticos (pago a crédito, perdón de
  // cuota, pago POS, job de auto-finish) NO lanzan: simplemente no
  // finalizan la orden y la dejan para cuando la cocina entregue.
  ORDER_HAS_PENDING_KITCHEN_ITEMS: {
    code: 'ORDER_HAS_PENDING_KITCHEN_ITEMS',
    httpStatus: 422,
    devMessage:
      'No se puede finalizar la orden: tiene platos en cocina sin entregar.',
  },
  // ── Menus / Carta (Restaurant Suite Fase G) ────────────────────────────
  MENU_NOT_FOUND: {
    code: 'MENU_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Menú no encontrado en la tienda',
  },
  MENU_DUP_NAME: {
    code: 'MENU_DUP_NAME',
    httpStatus: 409,
    devMessage: 'Ya existe un menú con ese nombre en la tienda',
  },
  MENU_SECTION_NOT_FOUND: {
    code: 'MENU_SECTION_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Sección de menú no encontrada',
  },
  MENU_SECTION_DUP_NAME: {
    code: 'MENU_SECTION_DUP_NAME',
    httpStatus: 409,
    devMessage: 'Ya existe una sección con ese nombre en el menú',
  },
  MENU_SECTION_ITEM_NOT_FOUND: {
    code: 'MENU_SECTION_ITEM_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Producto de la sección de menú no encontrado',
  },
  MENU_SECTION_ITEM_DUP: {
    code: 'MENU_SECTION_ITEM_DUP',
    httpStatus: 409,
    devMessage: 'El producto ya está agregado a la sección',
  },
  MENU_AVAILABILITY_NOT_FOUND: {
    code: 'MENU_AVAILABILITY_NOT_FOUND',
    httpStatus: 404,
    devMessage: 'Ventana de disponibilidad no encontrada',
  },
  MENU_AVAILABILITY_INVALID_TIME: {
    code: 'MENU_AVAILABILITY_INVALID_TIME',
    httpStatus: 422,
    devMessage:
      'Ventana de disponibilidad con horas inválidas (formato HH:mm, fin > inicio)',
  },
  MENU_AVAILABILITY_INVALID_TARGET: {
    code: 'MENU_AVAILABILITY_INVALID_TARGET',
    httpStatus: 422,
    devMessage:
      'La ventana de disponibilidad debe estar asociada a un menú o a una sección, pero no a ambos ni a ninguno',
  },
  MENU_PRODUCT_NOT_SELLABLE: {
    code: 'MENU_PRODUCT_NOT_SELLABLE',
    httpStatus: 422,
    devMessage:
      'El producto no es vendible (is_sellable=false) y no puede agregarse a la carta',
  },
  MENU_ITEM_NOT_AVAILABLE_NOW: {
    code: 'MENU_ITEM_NOT_AVAILABLE_NOW',
    httpStatus: 422,
    devMessage:
      'El producto pertenece a una carta con horario y no está disponible en este momento',
  },

  // Caja registradora — transiciones de configuración (QUI-560).
  // 409 y no 403: el usuario SÍ tiene permiso para configurar su tienda; lo que
  // falta es que el sistema esté en un estado que admita la acción. No es "no
  // puedes", es "no ahora".
  CASH_REGISTER_DISABLE_001: {
    code: 'CASH_REGISTER_DISABLE_001',
    httpStatus: 409,
    devMessage:
      'Cannot disable the cash register module while the store has open cash register sessions',
  },

  // Caja registradora — cierre contra un esperado rancio (QUI-572).
  // 409 y no 422: el payload es válido; lo que cambió es el estado del
  // servidor entre que el operario leyó la cifra y pulsó cerrar.
  CASH_SESSION_EXPECTED_STALE_001: {
    code: 'CASH_SESSION_EXPECTED_STALE_001',
    httpStatus: 409,
    devMessage:
      'The expected cash amount changed after the client read it; refresh the summary before closing',
  },

  // Reporte "Stock Bajo por Proveedor" (CP-low-stock-by-supplier).
  // 400 y no 404: el proveedor no existe o pertenece a otra tienda; la
  // petición nunca llegó a ser una búsqueda real contra el row del
  // proveedor, así que devolver 404 afirmaría que se buscó y no se
  // encontró cuando lo cierto es que el identificador no es legal para
  // el contexto del usuario. ERR-01 en el plan.
  LOW_STOCK_BY_SUPPLIER_001: {
    code: 'LOW_STOCK_BY_SUPPLIER_001',
    httpStatus: 400,
    devMessage:
      'The supplier_id filter does not match any active supplier of the current store',
  },

  // Reporte "Stock Bajo por Proveedor" — estado inválido.
  // 400: el DTO acepta `low_stock | out_of_stock | all`; cualquier otro
  // valor cae al class-validator genérico (SYS_VALIDATION_001) si el
  // cliente lo manda por query. Este código se emite cuando el servicio
  // lo construye internamente y se topa con un valor que no debería
  // existir. ERR-02 en el plan.
  LOW_STOCK_BY_SUPPLIER_002: {
    code: 'LOW_STOCK_BY_SUPPLIER_002',
    httpStatus: 400,
    devMessage:
      'The status filter must be one of: low_stock, out_of_stock, all',
  },

  // Genérico para endpoints de analytics: rango de fechas con `from > to`.
  // 400: el DTO acepta strings ISO; la invariante de orden es responsabilidad
  // del servicio. ERR-05 en el plan (low-stock-by-supplier analytics).
  ANALYTICS_DATE_RANGE_001: {
    code: 'ANALYTICS_DATE_RANGE_001',
    httpStatus: 400,
    devMessage:
      'Invalid date range: history_from must be less than or equal to history_to',
  },

  /**
   * `platform_settings.platform_organization_id` ausente al operar perfiles
   * (u otra operación fiscal del riel plataforma).
   *
   * ## Por qué 500 con código y no fallback silencioso
   *
   * El resto del módulo superadmin cae a `PLATFORM_ORGANIZATION_ID_FALLBACK = 1`
   * cuando el setting falta, para no romper pantallas de UI no-fiscales
   * (chart-of-accounts, journal-entries). Eso es razonable para esas
   * superficies: leer o listar sin settings no corrompe estado fiscal.
   *
   * Acá NO: emitir un perfil contra una organización equivocada es el modo
   * silencioso de firmar documentos bajo el NIT equivocado. La ausencia del
   * setting debe gritar con código para que un operador lo arregle antes de
   * continuar. 500 con `code` es lo correcto: el filtro global degrada
   * `Error` pelado a 500 sin código, pero un `VendixHttpException` con
   * `httpStatus: 500` viaja tal cual.
   */
  PLATFORM_FISCAL_SCOPE_MISSING: {
    code: 'PLATFORM_FISCAL_SCOPE_MISSING',
    httpStatus: 500,
    devMessage:
      'platform_settings.platform_organization_id is missing: refusing to operate billing profiles against an implicit organization, since emission with the wrong NIT is unrecoverable',
  },

  /**
   * `operation_type` del documento y del perfil plataforma no coinciden.
   *
   * Mismo invariante que `INVOICING_PROFILE_008` (riel tienda), expuesto con
   * prefijo PLATFORM para que el frontend pueda distinguir el origen del
   * rechazo y enrutar el mensaje al banner de la tarjeta de perfil del
   * wizard plataforma sin tener que mapear códigos.
   */
  PLATFORM_PROFILE_008: {
    code: 'PLATFORM_PROFILE_008',
    httpStatus: 409,
    devMessage:
      "Platform invoice operation_type does not match the profile's: freezing (profile_id, profile_version) from a profile of another type would make the stamped provenance false, and the aiu_* columns would stay NULL with no error",
  },

  /**
   * Generación de PDF plataforma no configurada. Stub honesto para C.5.5 del
   * CP-platform-invoicing-parity: el pipeline PDF del riel tienda tiene tres
   * acoplamientos al store (llave S3 `stores/${store_id}`, formato desde
   * `store_settings.receipts`, emisor desde `invoice.store`) que requieren
   * wrapper org-scoped. Hasta que C.5.5 exista, el endpoint responde 503 con
   * este código — el mismo patrón de honestidad que `PLATFORM_PROFILE_PREVIEW_PENDING`.
   */
  PLATFORM_PDF_NOT_CONFIGURED: {
    code: 'PLATFORM_PDF_NOT_CONFIGURED',
    httpStatus: 503,
    devMessage:
      'Platform PDF pipeline not yet configured: the store PDF service is store-scoped (S3 key prefix, format from store_settings, issuer from invoice.store). The C.5.5 wrapper must run those three steps org-scoped.',
  },
} as const satisfies Record<string, ErrorCodeEntry>;

export const FiscalScopeBlockerCodes = {
  INVALID_COMBINATION: 'FISCAL_SCOPE_INVALID_COMBINATION',
  PENDING_INVOICES: 'FISCAL_SCOPE_PENDING_INVOICES',
  PENDING_DIAN_RESPONSE: 'FISCAL_SCOPE_PENDING_DIAN_RESPONSE',
  OPEN_PERIODS: 'FISCAL_SCOPE_OPEN_PERIODS',
  NO_ACTIVE_STORES: 'FISCAL_SCOPE_NO_ACTIVE_STORES',
  MISSING_DIAN_CONFIG: 'FISCAL_SCOPE_MISSING_DIAN_CONFIG',
  MISSING_TAX_ID: 'FISCAL_SCOPE_MISSING_TAX_ID',
  OPEN_INTERCOMPANY: 'FISCAL_SCOPE_OPEN_INTERCOMPANY',
  PENDING_PAYROLL_RUNS: 'FISCAL_SCOPE_PENDING_PAYROLL_RUNS',
  PENDING_PAYROLL_SETTLEMENTS: 'FISCAL_SCOPE_PENDING_PAYROLL_SETTLEMENTS',
  PENDING_WITHHOLDINGS: 'FISCAL_SCOPE_PENDING_WITHHOLDINGS',
} as const;

export type FiscalScopeBlockerCode =
  (typeof FiscalScopeBlockerCodes)[keyof typeof FiscalScopeBlockerCodes];

export type ErrorCodeKey = keyof typeof ErrorCodes;
