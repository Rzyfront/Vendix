/**
 * Mapa de mensajes UX por error_code.
 * Estos mensajes son seguros para mostrar al usuario final (en espanol).
 * El devMessage del backend NUNCA se muestra al usuario.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // System
  SYS_INTERNAL_001: 'Ocurrio un error inesperado. Intente de nuevo.',
  SYS_VALIDATION_001: 'Los datos ingresados no son validos.',
  SYS_NOT_FOUND_001: 'El recurso solicitado no fue encontrado.',
  SYS_FORBIDDEN_001: 'No tiene permisos para realizar esta accion.',
  SYS_UNAUTHORIZED_001: 'Debe iniciar sesion para continuar.',
  SYS_CONFLICT_001: 'El recurso ya existe o esta en conflicto.',

  // Payments
  PAY_INVALID_ORDER_001: 'La orden no es valida o no existe.',
  PAY_INVALID_AMOUNT_001: 'El monto del pago no es valido.',
  PAY_METHOD_DISABLED_001: 'El metodo de pago esta deshabilitado.',
  PAY_PROCESSOR_001: 'Error en el procesador de pago. Intente mas tarde.',
  PAY_DUPLICATE_001: 'Ya se registro un pago para esta orden.',
  PAY_FIND_001: 'Pago no encontrado.',
  PAY_VALIDATE_001: 'La validacion de los datos de pago fallo.',
  PAY_PERM_001: 'No tiene permisos para acceder a este recurso de pago.',

  // Authentication
  AUTH_FIND_001: 'Usuario no encontrado.',
  AUTH_CREATE_001: 'Error al crear el usuario.',
  AUTH_VALIDATE_001: 'La validacion de autenticacion fallo.',
  AUTH_DUP_001: 'Ya existe un usuario con este email.',
  AUTH_PERM_001: 'No tiene permisos para realizar esta accion.',
  AUTH_TOKEN_001: 'Token invalido o expirado.',
  AUTH_CREDENTIALS_001: 'Email o contrasena incorrectos.',
  AUTH_PASSWORD_001: 'La contrasena es incorrecta.',
  AUTH_ROLE_001: 'Rol no encontrado.',
  AUTH_STORE_001: 'Tienda no encontrada.',
  AUTH_VERIFY_001: 'Error al verificar el email.',
  AUTH_CONTEXT_001: 'Contexto requerido para esta operacion.',

  // Ecommerce
  ECOM_CART_001: 'El carrito esta vacio.',
  ECOM_CART_002: 'Item del carrito invalido.',
  ECOM_CART_003: 'Stock insuficiente disponible.',
  ECOM_CART_004: 'Carrito no encontrado.',
  ECOM_PRODUCT_001: 'Producto no encontrado.',
  ECOM_PRODUCT_002: 'Producto no disponible.',
  ECOM_CHECKOUT_001: 'Error en el proceso de compra.',
  ECOM_CHECKOUT_002: 'Metodo de pago invalido.',
  ECOM_CHECKOUT_003: 'Metodo de envio invalido.',
  ECOM_ACCOUNT_001: 'Cuenta no encontrada.',
  ECOM_ACCOUNT_002: 'Contrasena actual incorrecta.',
  ECOM_WISHLIST_001: 'Lista de deseos no encontrada.',
  ECOM_WISHLIST_002: 'El producto no esta en la lista de deseos.',

  // Support
  SUP_TICKET_001: 'Ticket de soporte no encontrado.',
  SUP_COMMENT_001: 'Comentario no encontrado.',
  SUP_ORG_001: 'Organizacion no encontrada.',
  SUP_USER_001: 'Usuario no encontrado.',

  // Organization
  ORG_FIND_001: 'Organizacion no encontrada.',
  ORG_CREATE_001: 'Error al crear la organizacion.',
  ORG_VALIDATE_001: 'La validacion de la organizacion fallo.',
  ORG_PERM_001: 'No tiene permisos para acceder a esta organizacion.',
  ORG_CONTEXT_001: 'Debe seleccionar una organizacion.',
  ORG_USER_001: 'Usuario de la organizacion no encontrado.',
  ORG_USER_002: 'Ya existe un usuario con este email en la organizacion.',
  ORG_USER_003: 'Estado de usuario no válido para esta operación.',
  ORG_STORE_001: 'Tienda no encontrada.',
  ORG_ROLE_001: 'Rol no encontrado.',
  ORG_DOMAIN_001: 'Dominio no encontrado.',
  ORG_DOMAIN_002: 'Dominio invalido.',

  // Store
  STORE_FIND_001: 'Tienda no encontrada.',
  STORE_CREATE_001: 'Error al crear la tienda.',
  STORE_VALIDATE_001: 'La validacion de la tienda fallo.',
  STORE_PERM_001: 'No tiene permisos para acceder a esta tienda.',
  STORE_CONTEXT_001: 'Debe seleccionar una tienda.',

  // Products
  PROD_FIND_001: 'Producto no encontrado.',
  PROD_CREATE_001: 'Error al crear el producto.',
  PROD_VALIDATE_001: 'La validacion del producto fallo.',
  PROD_PERM_001: 'No tiene permisos para acceder a este producto.',
  PROD_DUP_001: 'Ya existe un producto con estas caracteristicas.',
  PROD_IMAGE_001: 'Imagen no encontrada.',
  PROD_CAT_001: 'Categoria o marca invalida.',
  PROD_SVC_001:
    'Los servicios no pueden tener peso, dimensiones ni inventario fisico.',
  PROD_SVC_002: 'No se puede cambiar el tipo de un producto existente.',
  PROD_VALIDATE_002:
    'Debes configurar un SKU para el producto antes de activar las variantes.',
  PROD_VALIDATE_003: 'El SKU de la variante no puede estar vacío.',

  // Product/Service & Variants Validation
  PROD_SVC_VARIANTS_001: 'Los productos tipo SERVICIO no pueden tener variantes.',
  PROD_SVC_HAS_VARIANTS_001: 'No se puede cambiar a SERVICE un producto con variantes existentes.',
  PROD_TRACKING_CHANGE_001: 'Para cambiar el seguimiento de inventario con variantes activas, selecciona un modo de transferencia de stock.',
  PROD_SALE_PRICE_001: 'El precio de oferta debe ser mayor que 0 y menor que el precio base.',
  PROD_VAR_SALE_PRICE_001: 'El precio de oferta de la variante debe ser mayor que 0 y menor que su precio de referencia.',
  PROD_VAR_PRICE_001: 'El precio personalizado de la variante debe ser nulo o mayor que 0.',
  PROD_VAR_REMOVE_001: 'Para eliminar variantes con stock, selecciona un modo de eliminación de stock.',
  PROD_HAS_RESERVATIONS_001: 'Esta operación está bloqueada porque existen reservas de stock activas.',
  PROD_SKU_COLLISION_001: 'El SKU especificado ya existe en una variante de esta tienda.',
  INV_VARIANT_TRACKING_001: 'El valor de override de seguimiento de inventario no es válido.',


  // Bulk Products
  BULK_PROD_FILE_INVALID: 'El archivo subido no es valido o esta corrupto.',
  BULK_PROD_EMPTY_FILE: 'El archivo no contiene filas de datos.',
  BULK_PROD_LIMIT_EXCEEDED:
    'Se excedio el limite maximo de productos por carga.',
  BULK_PROD_SESSION_EXPIRED:
    'La sesion de analisis expiro. Suba el archivo nuevamente.',
  BULK_PROD_VALIDATE_001:
    'Uno de los valores tiene un formato invalido. Verifique campos como marca o categoria.',

  // Orders
  ORD_FIND_001: 'Orden no encontrada.',
  ORD_CREATE_001: 'Error al crear la orden.',
  ORD_VALIDATE_001: 'La validacion de la orden fallo.',
  ORD_PERM_001: 'No tiene permisos para acceder a esta orden.',
  ORD_STATUS_001: 'Estado de orden invalido.',
  ORD_SHIP_001: 'Metodo de envio no encontrado.',
  ORD_SHIP_REQUIRED_001: 'Debes asignar un método de envío antes de continuar.',
  ORD_SHIP_INVALID_METHOD_001: 'El método de envío no pertenece a esta tienda.',
  ORD_SHIP_RATE_MISMATCH_001: 'La tarifa seleccionada no corresponde al método de envío.',
  ORD_SHIP_LOCKED_001: 'No es posible cambiar el método: la orden ya fue enviada.',

  // Inventory
  INV_FIND_001: 'Inventario no encontrado.',
  INV_CREATE_001: 'Error al crear el registro de inventario.',
  INV_VALIDATE_001: 'La validacion del inventario fallo.',
  INV_PERM_001: 'No tiene permisos para acceder al inventario.',
  INV_CONTEXT_001: 'Debe seleccionar una organizacion.',
  INV_STOCK_001: 'Stock insuficiente.',
  INV_LOC_001: 'Ubicacion no encontrada.',
  INV_ADJ_001: 'Ajuste no encontrado.',
  INV_BULK_001: 'El archivo esta vacio o no contiene datos validos.',
  INV_BULK_002: 'Se excedio el limite maximo de 1000 items por carga.',

  // Customers
  CUST_FIND_001: 'Cliente no encontrado.',
  CUST_CREATE_001: 'Error al crear el cliente.',
  CUST_VALIDATE_001: 'La validacion del cliente fallo.',
  CUST_PERM_001: 'No tiene permisos para acceder a este cliente.',
  CUST_BULK_001: 'El archivo excede el limite de 1000 clientes.',
  CUST_BULK_002: 'Error de validacion en los datos del cliente.',
  CUST_BULK_003: 'Email duplicado en el archivo.',
  CUST_BULK_004: 'No se pudo determinar la tienda actual.',

  // Shipping
  SHIP_FIND_001: 'Metodo de envio no encontrado.',
  SHIP_CREATE_001: 'Error al crear el metodo de envio.',
  SHIP_VALIDATE_001: 'La validacion del envio fallo.',
  SHIP_PERM_001: 'No tiene permisos para acceder a este envio.',

  // Categories & Brands
  CAT_FIND_001: 'Categoria no encontrada.',
  BRAND_FIND_001: 'Marca no encontrada.',

  // Refunds
  REF_FIND_001: 'Reembolso no encontrado.',
  REF_CREATE_001: 'Error al crear el reembolso.',
  REF_VALIDATE_001: 'La validacion del reembolso fallo.',

  // Superadmin
  SUP_ADMIN_USER_001: 'Usuario de superadministrador no encontrado.',
  SUP_ADMIN_ORG_001: 'Organizacion no encontrada.',
  SUP_ADMIN_ROLE_001: 'Rol de superadministrador no encontrado.',
  SUP_ADMIN_PERM_001: 'Permiso de superadministrador denegado.',

  // Payroll
  PAYROLL_FIND_001: 'Empleado no encontrado.',
  PAYROLL_FIND_002: 'Liquidacion de nomina no encontrada.',
  PAYROLL_FIND_003: 'Item de nomina no encontrado.',
  PAYROLL_CREATE_001: 'Error al crear el empleado.',
  PAYROLL_CREATE_002: 'Error al crear la liquidacion de nomina.',
  PAYROLL_DUP_001: 'Ya existe un empleado con ese codigo.',
  PAYROLL_DUP_002: 'Ya existe un empleado con ese documento.',
  PAYROLL_DUP_003: 'Ya existe una liquidacion con ese numero.',
  PAYROLL_VALIDATE_001: 'La validacion de nomina fallo.',
  PAYROLL_STATUS_001: 'No se puede cambiar el estado de la liquidacion.',
  PAYROLL_CALC_001: 'No se encontraron empleados activos para calcular.',
  PAYROLL_PROVIDER_001: 'Error en el proveedor de nomina.',
  PAYROLL_PERM_001: 'No tiene permisos para acceder a nomina.',
  PAYROLL_BULK_001: 'El archivo excede el limite de 1000 empleados.',
  PAYROLL_BULK_002: 'Error de validacion en los datos del empleado.',
  PAYROLL_BULK_003: 'Documento duplicado en el archivo.',
  PAYROLL_BULK_004: 'El email es obligatorio cuando se marca como usuario.',
  PAYROLL_BULK_005: 'El usuario ya esta vinculado a otro empleado.',
  PAYROLL_BULK_006:
    'Ya existe un usuario con ese nombre de usuario en la organizacion.',
  PAYROLL_BULK_007:
    'Ya existe un usuario con ese correo electronico en la organizacion.',
  PAYROLL_BULK_008:
    'Error inesperado al procesar el empleado. Verifique los datos e intente de nuevo.',
  PAYROLL_VALIDATE_002:
    'Los usuarios con rol Cliente no pueden ser vinculados como empleados.',

  // Employee Advances - Installments
  ADV_INSTALLMENT_001: 'Cuota no encontrada',
  ADV_INSTALLMENT_002: 'Esta cuota ya fue pagada',

  // AI Engine
  AI_CONFIG_001: 'Configuracion de IA no encontrada.',
  AI_PROVIDER_001: 'No se pudo conectar con el proveedor de IA.',
  AI_PROVIDER_002: 'No hay un proveedor de IA configurado por defecto.',
  AI_REQUEST_001: 'La solicitud al proveedor de IA fallo.',
  AI_CONFIG_002: 'Ya existe una configuracion con ese proveedor y modelo.',
  AI_APP_001: 'Aplicacion de IA no encontrada.',
  AI_APP_002: 'Ya existe una aplicacion con esa clave.',
  AI_APP_003: 'La aplicacion de IA esta deshabilitada.',
  AI_APP_004: 'Se excedio el limite de solicitudes de esta aplicacion.',
  AI_QUEUE_001: 'Error processing AI request. Please try again.',
  AI_QUEUE_002: 'AI task not found.',
  AI_CACHE_001: 'Temporary error. Please try again.',
  AI_LOG_001: 'Error logging AI operation.',
  AI_STREAM_001: 'This AI provider does not support streaming.',
  AI_STREAM_002: 'AI streaming failed. Please try again.',
  AI_CHAT_001: 'Conversation not found.',
  AI_CHAT_002: 'This conversation has been archived.',
  AI_CHAT_003: 'You do not have access to this conversation.',
  AI_CHAT_004: 'Please enter a message.',

  // AI Agent
  AI_AGENT_001:
    'The AI assistant reached its processing limit. Please try a simpler request.',
  AI_AGENT_002: 'The AI assistant took too long to respond. Please try again.',
  AI_AGENT_003: 'An error occurred while processing your request.',
  AI_AGENT_004: 'You do not have permission to perform this action.',
  AI_AGENT_005: 'This action requires your confirmation before proceeding.',

  // AI Embeddings
  AI_EMBED_001: 'Error generating content analysis. Please try again.',
  AI_EMBED_002: 'No relevant information found.',
  AI_EMBED_003: 'Search failed. Please try again.',

  // Layaway (Plan Separe)
  LAY_FIND_001: 'El plan separe no fue encontrado.',
  LAY_STATE_001:
    'No se puede realizar esta accion en el estado actual del plan.',
  LAY_PAYMENT_001: 'El monto del pago excede el saldo pendiente.',
  LAY_INSTALLMENT_001:
    'La suma de las cuotas no coincide con el saldo pendiente.',
  LAY_INSTALLMENT_002: 'La cuota seleccionada ya fue pagada.',

  // Withholding Tax (Retención en la Fuente)
  WHT_CONCEPT_NOT_FOUND: 'No se encontro el concepto de retencion.',
  WHT_UVT_NOT_FOUND: 'No se encontro el valor UVT para el año especificado.',
  WHT_CONCEPT_DUPLICATE: 'Ya existe un concepto con ese codigo.',
  WHT_CALCULATION_ERROR: 'Error al calcular la retencion.',

  // Exogenous Reports (Informacion Exogena)
  EXO_REPORT_NOT_FOUND: 'No se encontro el reporte exogeno.',
  EXO_INVALID_FORMAT: 'Codigo de formato exogeno invalido.',
  EXO_GENERATION_FAILED: 'Error al generar el reporte exogeno.',
  EXO_VALIDATION_ERRORS: 'Se encontraron errores de completitud en los datos.',

  // AI MCP
  AI_MCP_001: 'La autenticacion fallo. Verifique sus credenciales.',
  AI_MCP_002: 'No tiene permisos para realizar esta accion.',
  AI_MCP_003:
    'Limite de solicitudes excedido. Espere antes de intentar de nuevo.',
  AI_MCP_004: 'Formato de solicitud invalido.',

  // Dispatch Notes (Remisiones)
  DSP_FIND_001: 'Remisión no encontrada',
  DSP_VALIDATE_001: 'Transición de estado no válida para esta remisión',
  DSP_VALIDATE_002: 'Stock insuficiente para confirmar la remisión',
  DSP_VALIDATE_003: 'El cliente no está activo',
  DSP_VALIDATE_004: 'La remisión solo puede modificarse en estado borrador',
  DSP_VALIDATE_005:
    'La cantidad a despachar excede la cantidad pendiente del pedido',

  // ICA Municipal Tax
  ICA_RATE_NOT_FOUND: 'No se encontro tarifa ICA para el municipio.',
  ICA_STORE_NO_ADDRESS: 'La tienda no tiene direccion con codigo de municipio.',
  ICA_INVALID_PERIOD: 'Formato de periodo invalido. Use AAAA-TN o AAAA-MM.',

  // Metadata Fields
  META_FIND_001: 'Campo de metadata no encontrado.',
  META_CREATE_001: 'Error al crear el campo de metadata.',
  META_DUP_001: 'Ya existe un campo con esa clave para este tipo de entidad.',
  META_VALIDATE_001: 'El valor de metadata no es valido.',
  META_DEL_001: 'Este campo está siendo usado en una plantilla. Elimínalo de la plantilla primero.',

  // Data Collection
  DCOL_FIND_001: 'Plantilla de recoleccion no encontrada.',
  DCOL_FIND_002: 'Formulario no encontrado.',
  DCOL_TOKEN_001: 'El enlace del formulario es invalido o ha expirado.',
  DCOL_TOKEN_002: 'Este formulario ya fue completado.',
  DCOL_CREATE_001: 'Error al crear el formulario.',
  DCOL_DELETE_001: 'No se puede eliminar una plantilla que tiene formularios enviados.',

  // Customer History
  CUST_HISTORY_001: 'Historial del cliente no encontrado.',
  CUST_HISTORY_002: 'Reserva no encontrada en el historial.',
  CUST_HISTORY_003: 'Nota no encontrada.',

  // Booking Confirmation
  BOOK_CONFIRM_001: 'El enlace de confirmacion es invalido o ha expirado.',
  BOOK_CONFIRM_002: 'Este enlace ya fue utilizado.',
  BOOK_CHECKIN_001: 'La reserva debe estar confirmada para hacer check-in.',
  BOOK_CHECKIN_002: 'Ya se realizo el check-in para esta reserva.',

  // Email Templates
  EMAIL_TPL_001: 'Plantilla de email no encontrada.',

  // SaaS Subscriptions
  SUBSCRIPTION_001: 'Esta tienda no tiene una suscripcion activa.',
  SUBSCRIPTION_002: 'La suscripcion esta en borrador; debe activarse.',
  SUBSCRIPTION_003: 'La suscripcion fue cancelada o expiro.',
  SUBSCRIPTION_004: 'La tienda no tiene una suscripcion activa para funciones de IA.',
  SUBSCRIPTION_005: 'Esta funcion no esta incluida en tu plan actual.',
  SUBSCRIPTION_006: 'Se agoto la cuota de IA para este periodo de facturacion.',
  SUBSCRIPTION_007: 'Tu suscripcion esta vencida; algunas funciones de IA estan limitadas.',
  SUBSCRIPTION_008: 'Suscripcion suspendida por falta de pago.',
  SUBSCRIPTION_009: 'Suscripcion bloqueada. Regulariza tu pago para continuar.',
  SUBSCRIPTION_010: 'El plan seleccionado no es valido.',
  SUBSCRIPTION_INTERNAL_ERROR: 'Ocurrio un error al procesar tu suscripcion. Intenta de nuevo.',
  SUBSCRIPTION_PAY_001: 'No se pudo procesar el pago de la suscripcion. Verifica tu metodo de pago.',
  SUBSCRIPTION_PRORATION_001: 'No se pudo calcular el ajuste prorrateado del cambio de plan.',
  SUBSCRIPTION_PROMO_002: 'Este plan promocional ya no es elegible para tu tienda.',

  // Partner / Reseller
  PARTNER_001: 'Esta organizacion no es un partner revendedor.',
  PARTNER_002: 'El margen supera el maximo permitido por el plan base.',
  PARTNER_003: 'No puedes habilitar funciones que no estan incluidas en el plan base.',
  PARTNER_004: 'Este pago de comisiones ya fue procesado.',

  // Promotional plans
  PROMO_001: 'El plan promocional ya no es elegible.',

  // Plans (catalog)
  PLAN_001: 'Este plan esta archivado y no acepta nuevas suscripciones.',
  PLAN_002: 'Este plan no esta disponible para reventa.',

  // Trial
  TRIAL_001: 'Tu periodo de prueba termino. Elige un plan para continuar.',

  // DIAN Electronic Invoicing
  DIAN_CONFIG_001: 'No se encontro la configuracion DIAN para esta tienda.',
  DIAN_CONFIG_002: 'Ya existe una configuracion DIAN para esta tienda.',
  DIAN_CERT_001: 'El archivo de certificado es invalido.',
  DIAN_CERT_002: 'La contrasena del certificado es incorrecta.',
  DIAN_CERT_003: 'El certificado digital esta vencido. Debes renovarlo.',
  DIAN_CONN_001: 'No se pudo conectar con la DIAN. Intenta de nuevo.',
  DIAN_SEND_001: 'La DIAN rechazo el documento.',
  DIAN_SEND_002: 'La solicitud a la DIAN agoto el tiempo de espera.',

  // Invoicing
  INVOICING_FIND_001: 'No se encontro la factura.',
  INVOICING_FIND_002: 'No se encontro la resolucion de facturacion.',
  INVOICING_FIND_003: 'No se encontro la orden asociada.',
  INVOICING_FIND_004: 'No se encontro la orden de venta asociada.',
  INVOICING_CREATE_001: 'No se pudo crear la factura. Revisa los datos e intenta de nuevo.',
  INVOICING_VALIDATE_001: 'La factura no cumple las validaciones. Revisa los datos.',
  INVOICING_STATUS_001: 'No puedes pasar la factura a ese estado desde el actual.',
  INVOICING_STATUS_002: 'No puedes modificar la factura en su estado actual.',
  INVOICING_RESOLUTION_001: 'No hay una resolucion activa para numerar facturas. Configura una en Resoluciones.',
  INVOICING_RESOLUTION_002: 'La resolucion se agoto. Crea una nueva resolucion para seguir facturando.',
  INVOICING_DUP_001: 'Ya existe una factura con ese numero.',
  INVOICING_PROVIDER_001: 'Fallo la comunicacion con el proveedor de facturacion electronica.',
};

export const DEFAULT_ERROR_MESSAGE = 'Ocurrio un error. Intente de nuevo.';
