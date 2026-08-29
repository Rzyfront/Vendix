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
  // Red de seguridad del filtro global: la peticion llego mal formada y el
  // backend lo detecto en la capa de datos. Antes salian como 500, asi que el
  // usuario leia «error inesperado» ante algo que si puede corregir.
  SYS_VALUE_OUT_OF_RANGE_001:
    'El identificador solicitado no es válido. Vuelve a la lista y abre el registro desde ahí.',
  SYS_INVALID_FIELD_VALUE_001:
    'Uno de los datos enviados no tiene el formato esperado. Revisa los campos numéricos y vuelve a intentarlo.',

  // Alcance y asignación de roles (QUI-72). Compartidos por los tres niveles
  // (super-admin, organización y tienda): el mismo código debe leerse igual en
  // las tres pantallas, por eso viven en el catálogo global y no en un mapa
  // local de cada módulo.
  ROLE_SCOPE_001:
    'Este rol es de solo lectura en este nivel. Se administra desde el nivel al que pertenece.',
  ROLE_SCOPE_002:
    'No hay una organizacion en contexto para resolver el alcance del rol.',
  ROLE_SCOPE_003: 'Selecciona una tienda para administrar roles de tienda.',
  ROLE_SCOPE_004: 'El rol no existe o no es visible en este nivel.',
  ROLE_ASSIGN_001:
    'Este rol no se puede asignar a ese usuario: pertenecen a alcances distintos.',
  ROLE_ASSIGN_002:
    'Este rol no se puede asignar ni quitar desde esta pantalla.',
  ROLE_ASSIGN_003:
    'Solo el administrador de la plataforma puede asignar roles de sistema.',
  ROLE_ASSIGN_004: 'Esa asignacion de rol ya no existe.',
  ROLE_ASSIGN_005: 'El usuario ya tiene este rol en este alcance.',
  ROLE_ASSIGN_006: 'El usuario no existe o no pertenece a este alcance.',
  ROLE_ASSIGN_007: 'La tienda indicada no corresponde a la organizacion del rol.',

  // Categories & Brands extra codes
  CAT_DELETE_HAS_PRODUCTS:
    'Esta categoría tiene productos asignados. Elimínala con la opción de desligar para conservar los productos sin esta categoría.',
  BRAND_DELETE_HAS_PRODUCTS:
    'Esta marca tiene productos asignados. Elimínala con la opción de desligar para conservar los productos sin esta marca.',
  CAT_NAME_EXISTS_001: 'Ya existe una categoría con ese nombre.',
  BRAND_NAME_EXISTS_001: 'Ya existe una marca con ese nombre.',

  // Suppliers lifecycle
  SUPPLIER_FIND_001: 'El proveedor no existe.',
  SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS:
    'Este proveedor tiene documentos abiertos (órdenes de compra sin recibir, cuentas por pagar con saldo o remisiones en curso). Inactívalo en su lugar: seguirá visible pero nadie podrá seleccionarlo en documentos nuevos.',
  SUPPLIER_STATE_INVALID_TRANSITION:
    'Para archivar un proveedor usa la opción Eliminar, que valida sus documentos abiertos.',

  // Media uploads (shared)
  MEDIA_FILE_REQUIRED_001: 'Debes seleccionar un archivo.',
  MEDIA_FILE_TYPE_001:
    'Tipo de archivo no permitido. Usa una imagen válida (JPEG, PNG o WebP).',
  MEDIA_UPLOAD_FAILED_001: 'No pudimos subir el archivo. Intenta de nuevo.',

  // Help Center
  HELP_ARTICLE_NOT_FOUND: 'El artículo no fue encontrado.',
  HELP_CATEGORY_NOT_FOUND: 'La categoría no fue encontrada.',
  HELP_CATEGORY_HAS_ARTICLES:
    'No se puede eliminar la categoría porque tiene artículos asociados. Reasigna o elimina los artículos primero.',
  HELP_IMAGE_REQUIRED: 'Debes seleccionar una imagen.',
  HELP_IMAGE_TYPE_INVALID:
    'Tipo de imagen no soportado. Usa JPEG, PNG, WebP, GIF, BMP, TIFF, SVG, HEIC o AVIF.',
  HELP_IMAGE_TOO_LARGE: 'La imagen supera el tamaño máximo permitido (10 MB).',

  // Uploads
  UPLOAD_FILE_001: 'Seleccione un archivo para subir.',
  UPLOAD_CONTEXT_001: 'Debe seleccionar una organizacion para subir archivos.',
  UPLOAD_STORE_CONTEXT_001:
    'Debe seleccionar una tienda para subir este archivo.',
  UPLOAD_ORG_001: 'No se encontro la organizacion para subir el archivo.',
  UPLOAD_STORE_001: 'No se encontro la tienda para subir el archivo.',
  UPLOAD_TYPE_001: 'El tipo de archivo no esta soportado en esta seccion.',
  UPLOAD_FORBIDDEN_001: 'No tiene permisos para acceder a este archivo.',
  UPLOAD_FAILED_001: 'No se pudo subir el archivo. Intente de nuevo.',
  UPLOAD_REMOTE_URL_001: 'La URL de la imagen no es valida.',
  UPLOAD_REMOTE_FORBIDDEN_001:
    'No se puede usar esa imagen remota por seguridad.',
  UPLOAD_REMOTE_TYPE_001: 'La URL no devolvio una imagen compatible.',
  UPLOAD_REMOTE_SIZE_001: 'La imagen remota supera el tamano permitido.',
  UPLOAD_REMOTE_FETCH_001:
    'No pudimos descargar la imagen remota. Intenta de nuevo.',

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
  BANK_ACCOUNT_NOT_FOUND: 'No se encontro la cuenta bancaria.',
  PAYMENT_NOT_OWNED: 'No puedes operar este pago: pertenece a otra persona.',
  PRODUCT_VARIANT_MISMATCH: 'La variante seleccionada no corresponde al producto.',
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
  // Ecommerce checkout — validación cliente de dirección de envío
  ECOM_CHECKOUT_ADDR_REQUIRED_001:
    'Completa la dirección de envío para continuar.',
  ECOM_CHECKOUT_ADDR_LINE1_001:
    'Ingresa una dirección válida (entre 5 y 150 caracteres).',
  ECOM_CHECKOUT_ADDR_LINE2_001:
    'El complemento de la dirección no puede superar 100 caracteres.',
  ECOM_CHECKOUT_ADDR_STATE_001: 'Selecciona o ingresa el departamento/estado.',
  ECOM_CHECKOUT_ADDR_CITY_001: 'Selecciona o ingresa la ciudad de envío.',
  ECOM_CHECKOUT_ADDR_COUNTRY_001: 'Selecciona el país de envío.',
  ECOM_CHECKOUT_ADDR_POSTAL_001: 'El código postal no es válido.',
  ECOM_CHECKOUT_ADDR_PHONE_001:
    'Ingresa un teléfono de contacto válido (7 a 15 dígitos).',
  ECOM_CHECKOUT_ADDR_SAVED_001:
    'Selecciona una dirección guardada para continuar.',
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

  // Marketing
  MKT_AD_STORAGE_001:
    'El modulo de Anuncios se esta preparando. Intenta de nuevo en unos minutos.',
  MKT_AD_RATE_LIMIT_001:
    'Alcanzaste el limite diario de 3 anuncios generados para esta tienda. Intenta de nuevo manana.',
  MKT_AD_RATE_LIMIT_002:
    'No pudimos verificar el limite diario de generacion. Intenta de nuevo en unos minutos.',

  // Reviews
  REV_FIND_001: 'Reseña no encontrada.',
  REV_DUP_001: 'Ya dejaste una reseña para este producto.',
  REV_PURCHASE_001: 'Compra este producto para poder dejar una reseña.',
  REV_RATE_LIMIT_001: 'Alcanzaste el límite diario de reseñas.',
  REV_PERM_001: 'No tienes permiso para modificar esta reseña.',
  REV_STATE_001: 'Esta reseña ya no se puede editar.',
  REV_VOTE_DUP_001: 'Ya votaste esta reseña.',
  REV_REPORT_DUP_001: 'Ya reportaste esta reseña.',
  REV_DISABLED_001: 'Las reseñas están desactivadas en esta tienda.',

  // Products
  PROD_FIND_001: 'Producto no encontrado.',
  PROD_CREATE_001: 'Error al crear el producto.',
  PROD_VALIDATE_001: 'La validacion del producto fallo.',
  PROD_PERM_001: 'No tiene permisos para acceder a este producto.',
  PROD_DUP_001: 'Ya existe un producto con estas caracteristicas.',
  // Fallback generico. El backend redacta un mensaje mas preciso (distingue si
  // el choque fue con un producto, una variante o una presentacion de venta),
  // asi que las superficies que puedan anclarlo a un campo deben mostrar
  // `message` tal cual en vez de este texto.
  PROD_BARCODE_DUP_001: 'El codigo de barras ya esta en uso en esta tienda.',
  PROD_IMAGE_001: 'Imagen no encontrada.',
  PROD_CAT_001: 'Categoria o marca invalida.',
  PROD_SVC_001:
    'Los servicios no pueden tener peso, dimensiones ni inventario fisico.',
  PROD_SVC_002: 'No se puede cambiar el tipo de un producto existente.',
  PROD_VALIDATE_002:
    'Debes configurar un SKU para el producto antes de activar las variantes.',
  PROD_VALIDATE_003: 'El SKU de la variante no puede estar vacío.',
  // Cuenta contable propia del producto (override del PUC). Los tres mensajes
  // del backend nombran la cuenta concreta y la pantalla donde se corrige, así
  // que las superficies que puedan anclarlo al campo deben mostrar `message`
  // tal cual; estos textos son el respaldo genérico.
  PROD_ACCOUNT_CODE_NOT_FOUND_001:
    'La cuenta contable indicada no existe en el plan de cuentas (PUC) de esta organización. Créala en Contabilidad → Plan de Cuentas, elige una existente, o deja el campo vacío para usar la cuenta de ingreso por defecto.',
  PROD_ACCOUNT_CODE_INACTIVE_001:
    'La cuenta contable indicada está inactiva y no admite movimientos nuevos. Actívala en Contabilidad → Plan de Cuentas o elige otra.',
  // Distinguir "no existe" de "es de agrupación" importa: la segunda SÍ aparece
  // en el plan de cuentas, así que sin este matiz el usuario la vuelve a elegir.
  PROD_ACCOUNT_CODE_NOT_POSTABLE_001:
    'La cuenta contable indicada es de agrupación y no admite movimientos: un asiento no se puede registrar sobre ella. Elige una de sus subcuentas en Contabilidad → Plan de Cuentas.',

  // Product/Service & Variants Validation
  PROD_SVC_VARIANTS_001:
    'Los productos tipo SERVICIO no pueden tener variantes.',
  PROD_SVC_HAS_VARIANTS_001:
    'No se puede cambiar a SERVICE un producto con variantes existentes.',
  PROD_TRACKING_CHANGE_001:
    'Para cambiar el seguimiento de inventario con variantes activas, selecciona un modo de transferencia de stock.',
  PROD_SALE_PRICE_001:
    'El precio de oferta debe ser mayor que 0 y menor que el precio base.',
  PROD_VAR_SALE_PRICE_001:
    'El precio de oferta de la variante debe ser mayor que 0 y menor que su precio de referencia.',
  PROD_VAR_PRICE_001:
    'El precio personalizado de la variante debe ser nulo o mayor que 0.',
  PROD_VAR_REMOVE_001:
    'Para eliminar variantes con stock, selecciona un modo de eliminación de stock.',
  PROD_HAS_RESERVATIONS_001:
    'Esta operación está bloqueada porque existen reservas de stock activas.',
  PROD_SKU_COLLISION_001:
    'El SKU especificado ya existe en una variante de esta tienda.',
  INV_VARIANT_TRACKING_001:
    'El valor de override de seguimiento de inventario no es válido.',

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
  ORD_SHIP_RATE_MISMATCH_001:
    'La tarifa seleccionada no corresponde al método de envío.',
  // Respaldo estático: la impresión masiva ya muestra el mensaje dinámico del
  // backend ("Ninguna de las 20 órdenes … 12 canceladas, 8 no encontradas"),
  // que es más útil. Este texto solo aparece si ese detalle no llega.
  ORD_BULK_PRINT_001:
    'Ninguna de las órdenes seleccionadas se puede imprimir: están canceladas, reembolsadas o no están disponibles.',
  ORD_SHIP_LOCKED_001:
    'No es posible cambiar el método: la orden ya fue enviada.',
  ORD_SHIP_NO_ZONE_001:
    'La tienda todavía no tiene cobertura de envío para esta dirección. Cambia la dirección o comunícate con la tienda.',
  ORD_SHIP_PICKUP_ONLY_001:
    'No hay despacho a esta dirección, pero puedes retirar tu pedido en la tienda.',
  ORD_SHIP_CITY_UNRESOLVED_001:
    'No pudimos identificar tu ciudad. Vuelve a seleccionar departamento y ciudad e intenta de nuevo.',

  // Quotations
  QUOTE_CONVERT_STATUS_001:
    'Para convertir esta cotización en orden, primero debes marcarla como aceptada.',
  QUOTE_CONVERT_CUSTOMER_001:
    'Asigna un cliente a esta cotización antes de convertirla en orden.',

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
  PAYROLL_CROSS_STORE_FISCAL_001:
    'El empleado ya pertenece a otra tienda con NIT distinto. No se puede asociar a esta tienda.',
  PAYROLL_ASSOCIATE_CONFIRM_001:
    'El empleado ya existe en la organizacion. Confirma la asociacion a esta tienda.',
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
  LAY_INSTALLMENT_003: 'La cuota indicada no pertenece a este plan separe.',

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
  META_DEL_001:
    'Este campo está siendo usado en una plantilla. Elimínalo de la plantilla primero.',

  // Data Collection
  DCOL_FIND_001: 'Plantilla de recoleccion no encontrada.',
  DCOL_FIND_002: 'Formulario no encontrado.',
  DCOL_TOKEN_001: 'El enlace del formulario es invalido o ha expirado.',
  DCOL_TOKEN_002: 'Este formulario ya fue completado.',
  DCOL_CREATE_001: 'Error al crear el formulario.',
  DCOL_DELETE_001:
    'No se puede eliminar una plantilla que tiene formularios enviados.',

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
  SUBSCRIPTION_004:
    'La tienda no tiene una suscripcion activa para funciones de IA.',
  SUBSCRIPTION_005: 'Esta funcion no esta incluida en tu plan actual.',
  SUBSCRIPTION_006: 'Se agoto la cuota de IA para este periodo de facturacion.',
  SUBSCRIPTION_007:
    'Tu suscripcion esta vencida; algunas funciones de IA estan limitadas.',
  SUBSCRIPTION_008: 'Suscripcion suspendida por falta de pago.',
  SUBSCRIPTION_009: 'Suscripcion bloqueada. Regulariza tu pago para continuar.',
  SUBSCRIPTION_010: 'El plan seleccionado no es valido.',
  // REGLA DE NEGOCIO (no reescribir con lenguaje de cobranza): esta tienda NO
  // debe dinero. Su plan salio del catalogo y por eso la renovacion no pudo
  // ejecutarse. Decirle "falta de pago" a quien no debe nada genera tickets de
  // soporte y destruye la confianza; el codigo veraz manda. El copy de este
  // codigo jamas debe mencionar deuda, mora, cobro fallido ni saldo por pagar.
  SUBSCRIPTION_011:
    'El plan de tu tienda fue retirado del catalogo. Elige un plan vigente para continuar operando.',
  SUBSCRIPTION_INTERNAL_ERROR:
    'Ocurrio un error al procesar tu suscripcion. Intenta de nuevo.',
  SUBSCRIPTION_VALIDATION:
    'Hay datos faltantes o invalidos. Revisa los campos del formulario.',
  SUBSCRIPTION_PAY_001:
    'No se pudo procesar el pago de la suscripcion. Verifica tu metodo de pago.',
  SUBSCRIPTION_PRORATION_001:
    'No se pudo calcular el ajuste prorrateado del cambio de plan.',
  SUBSCRIPTION_PROMO_002:
    'Este plan promocional ya no es elegible para tu tienda.',
  SUBSCRIPTION_TOKEN_INVALID:
    'El metodo de pago caduco o no es valido. Reemplaza la tarjeta para continuar.',
  SUBSCRIPTION_CARD_DECLINED:
    'Tu tarjeta fue rechazada. Verifica los datos o usa otro medio de pago.',
  SUBSCRIPTION_PROVIDER_UNAVAILABLE:
    'La pasarela de pago no responde. Intentalo nuevamente en unos minutos.',
  SUBSCRIPTION_GATEWAY_001:
    'Las credenciales de la pasarela no son validas. Contacta al administrador.',
  SUBSCRIPTION_GATEWAY_002:
    'La pasarela aun no fue probada. Pidele al administrador que ejecute una prueba de conexion.',
  SUBSCRIPTION_GATEWAY_003:
    'Pagos no disponibles temporalmente. La pasarela de Vendix no esta activa; contacta al soporte.',
  SUBSCRIPTION_FISCAL_001:
    'Por favor ingresa los datos de facturación de tu empresa para continuar con la suscripción.',
  SUBSCRIPTION_FISCAL_002:
    'Los datos de facturación ingresados presentan inconsistencias. Por favor revísalos antes de continuar con el pago.',
  VERIFICATION_DIGIT_NOT_APPLICABLE:
    'El tipo de documento seleccionado no requiere dígito de verificación.',
  VERIFICATION_DIGIT_MISMATCH:
    'El dígito de verificación no coincide con el número de NIT ingresado.',
  PROMO_NOT_ELIGIBLE:
    'El cupon no aplica para esta tienda. Verifica el codigo o las condiciones del cupon.',

  // Partner / Reseller
  PARTNER_001: 'Esta organizacion no es un partner revendedor.',
  PARTNER_002: 'El margen supera el maximo permitido por el plan base.',
  PARTNER_003:
    'No puedes habilitar funciones que no estan incluidas en el plan base.',
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
  DIAN_CONFIG_002:
    'Ya existe una configuración DIAN con ese NIT y tipo de documento en este alcance. Edita la existente en lugar de crear otra.',
  DIAN_CERT_001: 'El archivo de certificado es invalido.',
  DIAN_CERT_002: 'La contrasena del certificado es incorrecta.',
  DIAN_CERT_003: 'El certificado digital esta vencido. Debes renovarlo.',
  DIAN_CONN_001: 'No se pudo conectar con la DIAN. Intenta de nuevo.',
  // Consulta de rangos de numeración (GetNumberingRange). Es una LECTURA: no
  // gasta consecutivos, así que reintentar es gratis y el mensaje lo dice —
  // sin eso el comerciante teme repetirla y vuelve a teclear la clave a mano,
  // que es justo el camino que produjo el rechazo por CUFE del 14/08/2026.
  DIAN_NUMBERING_RANGE_001:
    'No se pudo consultar los rangos de numeración ante la DIAN. La consulta no gasta numeración, puedes reintentarla.',
  DIAN_SEND_001: 'La DIAN rechazo el documento.',
  DIAN_SEND_002: 'La solicitud a la DIAN agoto el tiempo de espera.',
  DIAN_CERT_004: 'El certificado no coincide con el NIT de la entidad fiscal.',
  DIAN_ENABLEMENT_001: 'Faltan requisitos para habilitar DIAN en produccion.',
  // En modo proveedor tecnológico la transmisión no la firma Vendix, así que no
  // hay nada que habilitar: el mensaje nombra el modo y dónde se cambia.
  DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED:
    'Para emitir en producción, la configuración DIAN de esta tienda debe estar en modo "software propio". Cámbialo en Facturación → Configuración DIAN antes de pasar a producción.',

  // Set de pruebas de habilitación. Los mensajes distinguen "espera" de "error":
  // reenviar un lote que la DIAN aún está validando quema un segundo bloque de
  // consecutivos que nunca se recupera.
  DIAN_TEST_SET_001:
    'Necesitas la evidencia del set de pruebas aprobado antes de pasar a producción.',
  DIAN_TEST_SET_002:
    'Ya hay un set de pruebas en curso ante la DIAN. Consulta su estado en lugar de reenviarlo: un reenvío consume otro bloque de números.',
  DIAN_TEST_SET_003:
    'A la resolución de numeración no le quedan suficientes números para el set de pruebas de tu modo de operación.',
  DIAN_TEST_SET_004:
    'Esta configuración no tiene ningún set de pruebas enviado que se pueda revisar o descartar.',
  DIAN_TEST_SET_005:
    'El set guardado es anterior al registro de claves por documento. Reenvíalo para poder diagnosticarlo factura por factura.',
  DIAN_TEST_SET_006:
    'El set de pruebas debe emitirse contra una resolución de habilitación. La resolución seleccionada es de producción y sus consecutivos son reales.',
  // 404 deliberadamente ambiguo en el backend (no existe / expiró / es de otra
  // config): distinguirlos permitiría enumerar los lotes de otros tenants. El
  // copy no promete cuál de los tres es, solo qué hacer.
  DIAN_TEST_SET_007:
    'Ese envío del set de pruebas ya no está disponible: pudo expirar o pertenecer a otra configuración fiscal. Vuelve a consultar el estado desde Facturación → Configuración DIAN.',
  // Dos resoluciones gemelas activas avanzan su consecutivo por separado, así que
  // la que quede atrás repetirá números ya entregados a la DIAN — y un
  // consecutivo duplicado se rechaza para siempre. Por eso el texto dice qué
  // cuesta ignorarlo, no solo que hay un duplicado.
  DIAN_TEST_SET_008:
    'Hay dos resoluciones activas con el mismo número y rango, y no se puede saber cuál numera. Desactiva la duplicada en Facturación → Resoluciones antes de emitir: si ambas siguen activas, la que quede atrás repetirá consecutivos ya enviados y la DIAN rechazará todo lo que emita con ellos.',

  // Eventos RADIAN (Res. 000085/2022)
  DIAN_EVENT_001:
    'La factura no está aceptada por la DIAN o no tiene CUFE: no se puede registrar un evento RADIAN sobre ella.',
  DIAN_EVENT_002:
    'Ese código de evento RADIAN no está soportado. Solo están disponibles los eventos 030 a 034.',
  DIAN_EVENT_003:
    'Ese evento ya fue aceptado por la DIAN para esta factura. Registrarlo otra vez sería un duplicado.',
  DIAN_EVENT_004:
    'Los eventos RADIAN requieren la integración directa con la DIAN (software propio) activa en esta tienda.',
  // El backend NOMBRA el campo que falta en `details` (missing / allowed) porque
  // varía por código de evento; este texto es el encabezado de esa familia. Se
  // corta antes de transmitir: registrar el evento incompleto gastaría el
  // consecutivo del evento y RADIAN lo rechazaría igual.
  DIAN_EVENT_005:
    'Al evento RADIAN le faltan datos que el anexo exige para su código: el tipo de operación, si el endoso es completo o en blanco, o los montos de la negociación. Complétalos antes de registrarlo: enviarlo incompleto gasta el consecutivo del evento y RADIAN lo rechaza igual.',

  // Umbral 5 UVT (Art. 616-1 ET / Res. 000165 de 2023)
  FISCAL_UVT_INVOICE_REQUIRED:
    'Esta venta supera 5 UVT y requiere factura electrónica: identifica al comprador (documento y nombre) antes de cerrarla. El tiquete POS solo cubre ventas por debajo del tope.',
  FISCAL_CONFIG_INCOMPLETE:
    'La configuracion fiscal de esta entidad esta incompleta.',
  // Sin nombrar el area: `parseApiError` mapea por codigo y no lee el `message`
  // del backend, que si la nombra. Quien quiera decir cual —y enlazar la
  // seccion del asistente— la toma de `details.area`.
  FISCAL_AREA_INACTIVE:
    'Este modulo fiscal no esta activo para tu tienda. Activalo en el asistente fiscal antes de usarlo.',
  // Identidad fiscal del EMISOR: razon social, municipio DIAN o departamento.
  // El backend manda en `details.missing` la lista completa de huecos y el
  // `cta` al wizard, asi que este texto no enumera campos — la superficie que
  // lo muestre debe leer `details` y pedirlos todos de una vez, en vez de
  // hacer que el operador los descubra de a uno por reintento.
  FISCAL_IDENTITY_INCOMPLETE:
    'Falta completar la identidad fiscal de tu empresa antes de emitir. Ve al manejo fiscal y llena los datos que aparecen pendientes.',
  FISCAL_STATUS_INCOMPLETE:
    'No se puede activar: faltan pasos por completar. Revisa los datos marcados como pendientes.',
  FISCAL_SCOPE_INVALID:
    'La operacion no corresponde a la entidad fiscal actual.',
  FISCAL_IDEMPOTENCY_CONFLICT:
    'El reintento fiscal no coincide con el envio original.',
  FISCAL_ACCOUNTING_BLOCKED:
    'La contabilidad fiscal esta bloqueada hasta que exista aceptacion DIAN.',
  FISCAL_RESOLUTION_MISSING:
    'Este documento se numera contra una Autorizacion de Numeracion de la DIAN y no hay ninguna vigente. Registrala en Facturacion > Resoluciones.',
  FISCAL_RESOLUTION_EXHAUSTED:
    'Se acabaron los consecutivos del rango que autorizo la DIAN. Registra un rango nuevo en Facturacion > Resoluciones.',
  FISCAL_DOCUMENT_UNSUPPORTED:
    'Este tipo de documento fiscal aun no esta implementado para DIAN propio.',
  FISCAL_PERIOD_CLOSED:
    'El periodo fiscal de esa fecha esta cerrado y no admite movimientos. Reabre el periodo o usa una fecha dentro de un periodo abierto.',
  FISCAL_STATUS_LOCKED:
    'El manejo fiscal esta bloqueado porque ya existen documentos fiscales emitidos. Esta configuracion ya no se puede modificar.',
  FISCAL_STATUS_INVALID_TRANSITION:
    'No se puede cambiar el estado fiscal desde el estado actual. Refresca la pagina y vuelve a intentarlo.',
  FISCAL_SCOPE_MISSING_TAX_ID:
    'Falta el NIT de la entidad fiscal. Registralo en los datos legales antes de continuar.',
  // Responsabilidad de IVA (RUT). Cobrar IVA sin ser responsable produce una
  // factura que la DIAN acepta y que despues hay que corregir con nota credito,
  // asi que el corte es previo y el texto nombra donde se declara la condicion.
  FISCAL_VAT_NOT_RESPONSIBLE_001:
    'Esta tienda está registrada ante la DIAN como NO responsable de IVA, así que no puede asignar ni cobrar IVA. Si tu condición cambió, actualiza la responsabilidad fiscal (RUT) en el manejo fiscal antes de facturar con impuesto.',
  // 500 de configuracion del servidor, no del comerciante: sin la clave de
  // cifrado, guardar el secreto lo dejaria protegido con una clave visible en el
  // repositorio. Se corta antes de escribir, y el copy lo dice para que nadie
  // reintente creyendo que es un dato suyo.
  FISCAL_ENCRYPTION_KEY_MISSING:
    'No se pudo guardar el dato protegido: falta la clave de cifrado fiscal del servidor. No se guardó nada a medias. Es una configuración del servidor, no un dato tuyo — reporta este caso a soporte.',

  // Alcance fiscal (por tienda vs por organización)
  FISCAL_SCOPE_INVALID_VALUE:
    'El alcance fiscal indicado no es válido. Elige si la fiscalidad se maneja por tienda o por organización.',
  FISCAL_SCOPE_INVALID_COMBINATION:
    'Esa combinación de alcance operativo y alcance fiscal no es válida. Revisa cómo opera la organización antes de cambiar el manejo fiscal.',
  FISCAL_SCOPE_CHANGE_BLOCKED:
    'No se puede cambiar el alcance fiscal todavía: hay condiciones previas sin resolver. Revisa los motivos señalados y corrígelos antes de reintentar.',
  FISCAL_SCOPE_FORCE_REASON_REQUIRED:
    'Forzar el cambio de alcance fiscal exige escribir el motivo. Explícalo antes de continuar: queda registrado en la auditoría fiscal.',
  FISCAL_SCOPE_ACCOUNTING_ENTITY_NOT_FOUND:
    'Esa entidad contable no existe o no pertenece a esta organización. Elige una de las entidades fiscales de la organización.',

  // Estado fiscal (asistente de activación)
  FISCAL_STATUS_WIZARD_STEP_INVALID:
    'Ese paso del asistente fiscal no existe. Recarga la página y retoma el asistente desde donde quedó.',
  FISCAL_STATUS_DEACTIVATION_BLOCKED:
    'No se puede desactivar el manejo fiscal: hay operaciones que dependen de él. Revisa los motivos señalados antes de reintentar.',
  FISCAL_STATUS_CONCURRENT_UPDATE:
    'Otra persona cambió el estado fiscal mientras editabas. Recarga la página para ver el estado actual y vuelve a aplicar tu cambio.',
  FISCAL_STATUS_PERMISSION_DENIED:
    'No tienes permiso para cambiar el estado fiscal de esta entidad. Solicítalo a un administrador de la organización.',

  // Fiscal seeding (plan de cuentas / impuestos / entidad contable)
  TAXES_ALREADY_SEEDED:
    'Los impuestos por defecto ya fueron creados para esta entidad fiscal. No los vuelvas a sembrar; edita los existentes en el paso de Impuestos.',
  CHART_ALREADY_SEEDED:
    'El plan de cuentas (PUC) ya fue creado para esta entidad fiscal. No lo vuelvas a sembrar; edita las cuentas existentes en el paso de PUC.',
  CHART_NOT_SEEDED:
    'Aun no existe un plan de cuentas (PUC). Crealo en el paso de PUC antes de continuar.',
  MISSING_ACCOUNTING_ENTITY:
    'Falta la entidad fiscal de la tienda. Completa los datos legales (NIT y razon social) antes de crear el plan de cuentas.',

  // Invoicing
  INVOICING_FIND_001: 'No se encontro la factura.',
  INVOICING_FIND_002: 'No se encontro la resolucion de facturacion.',
  INVOICING_FIND_003: 'No se encontro la orden asociada.',
  INVOICING_FIND_004: 'No se encontro la orden de venta asociada.',
  INVOICING_CREATE_001:
    'No se pudo crear la factura. Revisa los datos e intenta de nuevo.',
  // Sin el numero de la factura existente: `parseApiError` mapea por codigo y
  // nunca usa el `message` del backend. Quien quiera nombrarla —el detalle de
  // la orden lo hace— lo toma de `details.invoice_number`.
  INVOICING_CREATE_002:
    'Este documento ya tiene una factura emitida. Anulala antes de emitir otra.',
  INVOICING_CREATE_003:
    'Los pedidos de venta no registran impuestos, asi que no se pueden facturar. Emite la factura desde la orden.',
  INVOICING_AREA_001:
    'La facturacion electronica no esta activa para esta tienda. Activala en Configuracion fiscal.',
  INVOICING_ENABLEMENT_001:
    'Tu habilitacion ante la DIAN aun no esta viva. Completa el set de pruebas y activa produccion antes de emitir.',
  INVOICING_VALIDATE_001:
    'La factura no cumple las validaciones. Revisa los datos.',
  INVOICING_STATUS_001:
    'No puedes pasar la factura a ese estado desde el actual.',
  INVOICING_STATUS_002: 'No puedes modificar la factura en su estado actual.',
  INVOICING_RESOLUTION_001:
    'No hay una resolucion activa para numerar facturas. Configura una en Resoluciones.',
  INVOICING_RESOLUTION_002:
    'La resolucion se agoto. Crea una nueva resolucion para seguir facturando.',
  // Una resolución que ya numeró documentos es evidencia fiscal: se desactiva,
  // no se borra. El backend manda el detalle (cuántos documentos, en qué número
  // va), así que estos textos son el respaldo cuando ese detalle no llega.
  INVOICING_RESOLUTION_003:
    'La resolución ya emitió documentos o consumió numeración ante la DIAN. Desactívala en vez de borrarla.',
  INVOICING_RESOLUTION_004:
    'La configuración fiscal activa apunta a esta resolución. Reasígnala antes de borrarla o desactivarla.',
  INVOICING_RESOLUTION_005:
    'El prefijo, el tipo de documento y el rango inicial quedan fijos una vez la resolución consumió numeración. Crea una resolución nueva.',
  // Escáner IA de resoluciones DIAN. Nada se guarda al escanear, así que estos
  // errores solo significan "no pude leerla": el usuario siempre puede seguir
  // escribiendo la resolución a mano.
  RESOLUTION_SCAN_NO_FILE: 'Sube una foto o un PDF de la resolución DIAN.',
  RESOLUTION_SCAN_INVALID_FILE:
    'Formato no soportado. Usa JPG, PNG, WebP o PDF.',
  // El backend manda el nombre de la app en el detalle; este texto es el
  // respaldo cuando ese detalle no llega.
  AI_VISION_001:
    'Este escáner no tiene un modelo de visión enlazado. Regístralo en super-admin → IA → Configuraciones; mientras tanto, escribe los datos a mano.',
  RESOLUTION_SCAN_AI_FAIL:
    'La IA no pudo leer la resolución. Intenta con una foto más nítida o escribe los datos a mano.',
  RESOLUTION_SCAN_PARSE_FAIL:
    'La IA respondió algo que no se pudo interpretar. Intenta de nuevo o escribe los datos a mano.',
  // Escáner IA de la habilitación DIAN (software + set de pruebas + resolución
  // de pruebas). Mismo contrato: no persiste nada, así que un fallo solo
  // significa "no pude leerlo".
  HABILITATION_SCAN_NO_FILE:
    'Sube al menos una foto o PDF de la habilitación DIAN.',
  HABILITATION_SCAN_INVALID_FILE:
    'Formato no soportado. Usa JPG, PNG, WebP o PDF.',
  HABILITATION_SCAN_TOO_MANY_FILES:
    'Máximo 3 documentos por escaneo. Quita alguno e inténtalo de nuevo.',
  HABILITATION_SCAN_AI_FAIL:
    'La IA no pudo leer los documentos de habilitación. Intenta con fotos más nítidas o escribe los datos a mano.',
  HABILITATION_SCAN_PARSE_FAIL:
    'La IA respondió algo que no se pudo interpretar. Intenta de nuevo o escribe los datos a mano.',
  INVOICING_RESOLUTION_006:
    'La identidad fiscal no tiene una entidad contable activa, y una resolución tiene que colgar de una. Actívala antes de crear la resolución.',
  INVOICING_RESOLUTION_007:
    'Ya existe una resolución activa con ese prefijo para ese tipo de documento. Usa otro prefijo o desactiva la anterior.',
  // 008 es la puerta del contrato fiscal por tipo de documento: qué campos exige
  // la DIAN a una factura de venta, a una nota, a un documento soporte. La
  // corrección es distinta según el campo, así que el backend manda el detalle.
  INVOICING_RESOLUTION_008:
    'La resolución no cumple lo que la DIAN exige para ese tipo de documento. Revisa los campos señalados.',
  // El rango y la vigencia los fija la DIAN en la autorización de numeración:
  // aquí no se corrige un criterio propio, se transcribe bien el documento.
  INVOICING_RESOLUTION_009:
    'El rango autorizado no es válido: deben ser dos números enteros positivos y el final mayor que el inicial. Cópialos de la autorización de numeración.',
  INVOICING_RESOLUTION_010:
    'La vigencia no es válida: la fecha final debe ser posterior a la inicial. Cópialas de la autorización de numeración.',
  /**
   * ESTE MENSAJE EXISTE POR UN RECHAZO REAL DE LA DIAN.
   *
   * Se guardó una clave técnica de 38 caracteres —dos perdidos al copiarla, todos
   * hexadecimales, nada a la vista que delatara el error—. La ClTec es el único
   * dato del CUFE que NO viaja en el XML, así que la DIAN fue el primer sistema
   * capaz de notarlo: recomputó el hash con la clave verdadera, no coincidió y
   * rechazó la factura. El consecutivo autorizado ya estaba gastado, y eso no se
   * recupera.
   *
   * Por eso el texto dice DÓNDE conseguirla y no solo qué está mal: quien captura
   * una resolución no tiene por qué saber que son 40 o 64 caracteres.
   */
  INVOICING_RESOLUTION_011:
    'La clave técnica (ClTec) debe tener 40 o 64 caracteres hexadecimales, según la emita la DIAN. Cópiala completa del PDF de la autorización de numeración: si está incompleta, la DIAN rechaza cada factura por CUFE mal calculado y el consecutivo que gasta no se recupera.',
  INVOICING_DUP_001: 'Ya existe una factura con ese numero.',
  INVOICING_PROVIDER_001:
    'Fallo la comunicacion con el proveedor de facturacion electronica.',
  INVOICING_PROVIDER_002:
    'El proveedor de facturación electrónica no está configurado para esta tienda. Complétalo en Facturación → Configuración DIAN.',
  INVOICING_PROVIDER_003:
    'Faltan datos obligatorios para transmitir a la DIAN. Revisa la configuración DIAN y la resolución de numeración.',
  // Este NO es un fallo de Vendix: la DIAN juzgó el documento y lo rechazó
  // nombrando la regla que se violó. Ese detalle viaja en `details.dian_errors`,
  // así que la UI debe enumerarlo — este texto es solo el encabezado.
  INVOICING_PROVIDER_004:
    'La DIAN rechazó el documento. Revisa los motivos que reporta y corrígelos antes de reintentar.',
  INVOICING_CUFE_001:
    'Los valores con los que se calculó la clave del documento no coinciden con los del XML. No se transmitió nada y no se gastó numeración. Reporta este caso: es un fallo interno, no un dato tuyo.',
  // La DIAN valida la coherencia entre cantidad y unidad: 3 metros declarados
  // como `EA` afirman "3 unidades". Antes se emitía `EA` de relleno ante
  // cualquier fallo de resolución, así que el documento salía aceptado y falso.
  // El backend nombra las líneas y los productos en `details`.
  DIAN_UNIT_CODE_001:
    'No se puede determinar la unidad de medida de una o más líneas del documento, y no se emite con una unidad de relleno. Revisa en Productos que esos artículos existan en esta tienda y tengan una unidad de stock válida.',
  DIAN_UNIT_CODE_002:
    'No se pudo leer el catálogo de unidades de medida para armar el documento. Es un fallo temporal: vuelve a intentar en unos segundos. No se gastó numeración.',
  // Gemelo de CUFE_001: estructura, no contenido. Un elemento fuera del orden
  // que fija el `xsd:sequence` de UBL produce un documento con TODOS los datos
  // correctos que la DIAN rechaza igual. Se corta antes de firmar, así que lo
  // primero que hay que decir es que no se perdió el consecutivo — ese es el
  // miedo real de quien ve fallar una emisión.
  INVOICING_XSD_001:
    'El XML generado no cumple la estructura que exige la DIAN, así que no se firmó ni se transmitió nada: el borrador conserva su número y no se gastó numeración. Es un fallo interno del generador, no un dato tuyo — reporta este caso a soporte.',
  // El backend recalcula toda la aritmética del documento, así que un importe
  // de impuesto que no cuadre se corrige solo. Este código es el único caso que
  // no se puede recalcular: importe sin tarifa. El mensaje del backend nombra la
  // línea concreta, así que la UI debe preferirlo sobre este texto genérico.
  INVOICING_CALC_001:
    'Una línea declara un impuesto pero no indica su tarifa. Agrega el impuesto con su tarifa (por ejemplo IVA 19%) o deja el importe en cero.',
  /**
   * Genérico a propósito: el backend manda en `message` la lista de
   * identificadores rechazados y si el problema es que no existen o que son de
   * otra organización, y `parseApiError` prefiere ese texto. Este es el respaldo
   * para cuando la respuesta llega sin cuerpo.
   */
  INVOICING_CALC_002:
    'Uno de los impuestos del documento ya no está en el catálogo de la tienda. Vuelve a elegirlo en la línea y guarda de nuevo.',
  /** Mismo respaldo genérico que el anterior, sobre producto y variante. */
  INVOICING_CALC_003:
    'Una de las líneas apunta a un artículo que no está en el catálogo de esta tienda. Vuelve a elegirlo desde el buscador de productos.',
  /** Mismo respaldo genérico que el anterior, sobre el adquiriente. */
  INVOICING_CALC_004:
    'El cliente del documento no está en esta organización. Vuelve a elegirlo desde el buscador de clientes.',
  /**
   * PREVALIDACIÓN FISCAL — los cuatro mensajes siguientes son ENCABEZADOS.
   *
   * El backend rechaza el documento ANTES de firmarlo y transmitirlo, y manda en
   * `details.blockers[]` un hallazgo por regla incumplida, cada uno con su
   * `problem` (qué está mal y por qué la DIAN lo rechaza) y su `fix` (qué tocar y
   * en qué pantalla). La UI DEBE enumerar esa lista: estos textos solo dicen de
   * qué familia es el problema, porque un documento puede incumplir varias reglas
   * a la vez y ninguna frase única las describe.
   *
   * Por qué vale la pena mostrarlos bien: un rechazo de la DIAN gasta un
   * consecutivo autorizado que no se recupera. Todo lo que se corrija en esta
   * pantalla es numeración que no se pierde.
   */
  INVOICING_PREVALIDATION_001:
    'Las cuentas del documento no cuadran y la DIAN lo rechazaría. Revisa los descuadres señalados: normalmente basta con volver a guardar el documento para que se recalculen los totales.',
  INVOICING_PREVALIDATION_002:
    'La resolución de numeración no respalda este documento: revisa su vigencia, su rango y que el prefijo coincida con el número emitido. Se corrige en Facturación → Resoluciones.',
  // El caso real: una clave técnica de 38 caracteres hizo rechazar una factura y
  // quemó el consecutivo. El texto dice DÓNDE conseguirla porque quien captura
  // una resolución no tiene por qué saber que son 40 o 64 caracteres.
  INVOICING_PREVALIDATION_003:
    'La clave técnica (ClTec) de la resolución falta o está incompleta. Cópiala completa del PDF de la autorización de numeración de la DIAN: son 40 o 64 caracteres, y si falta uno solo la DIAN rechaza cada factura y el consecutivo que gasta no se recupera.',
  INVOICING_PREVALIDATION_004:
    'El contenido del documento no se puede emitir tal como está: revisa la moneda, las unidades de medida de las líneas y el tipo de operación. El detalle señala cada línea y qué corregir.',

  /**
   * Retenciones DECLARADAS POR EL CLIENTE al crear la factura.
   *
   * El backend separa el "concepto que no es tuyo" del "concepto borrado /
   * inactivo" para que el mensaje ayude al depurador a saber qué pasó, no para
   * que parezca que se trata del mismo problema. El del backend ya nombra
   * ambos y los detalles llevan la lista de `concept_id`s malos.
   */
  INVOICING_WITHHOLDING_002:
    'Alguna retención declarada referencia conceptos que no existen, están inactivos o pertenecen a otra tienda. El detalle lista los `concept_id`s en cuestión; revisa la lista de conceptos en Contabilidad → Retenciones y reemplaza los que falten o no apliquen.',
  INVOICING_WITHHOLDING_003:
    'La retención declarada no cuadra con la base y la tarifa: la diferencia entre el importe y `base × rate` supera 1 centavo. Una diferencia mayor ya no es truncado, es un dato mal capturado. Revisa la base, la tarifa o el importe y vuelve a enviar.',

  /**
   * AIU — el error que estos tres mensajes evitan NO se ve.
   *
   * Un contrato AIU mal clasificado produce una factura que la DIAN ACEPTA
   * declarando menos IVA del que se debe; el faltante aparece meses después, ya
   * con sanción e intereses, y sólo se corrige con nota crédito. Por eso los
   * textos nombran la pantalla de configuración: quien factura no tiene por qué
   * saber que existen dos regímenes de base gravable, pero sí tiene que poder
   * llegar a donde se elige el suyo.
   */
  INVOICING_AIU_001:
    'La base gravable del AIU es menor al 10% del valor del contrato, que es el mínimo legal para los servicios del artículo 462-1 (aseo y cafetería, vigilancia y servicios temporales de empleo). Sube el AIU o, si tu contrato es de construcción de bien inmueble, cambia el régimen en Configuración → Facturación → AIU.',
  INVOICING_AIU_002:
    'Falta el objeto del contrato AIU, o no tiene la longitud que exige la DIAN (entre 20 y 5.000 caracteres). Descríbelo en Configuración → Facturación → AIU: viaja en la línea de Administración y sin él la DIAN rechaza el documento.',
  INVOICING_AIU_003:
    'Una línea está marcada como componente AIU (Administración, Imprevistos o Utilidad) pero el documento no es un contrato AIU. Cambia el tipo de operación a AIU o quita la marca de la línea: como está, el componente se ignora y la línea se factura como una venta normal.',

  /**
   * AIU 004-006 — los tres nacen de la misma decisión: **la base gravable la
   * fija el régimen, nunca lo que la línea declare.** El servidor se niega a
   * inventar la tarifa ausente porque una factura sub-declarada la DIAN la
   * ACEPTA, y el faltante sólo se corrige con nota crédito y la sanción ya
   * corriendo. Es preferible no emitir.
   */
  INVOICING_AIU_004:
    'Una línea del AIU entra a la base gravable y no declara impuesto, y no hay perfil de facturación que aporte la tarifa de ese componente. Declara el impuesto en la línea o elige un perfil que defina la tarifa: si se emitiera así, el IVA quedaría por debajo del que corresponde y eso sólo se corrige después con nota crédito.',
  INVOICING_AIU_005:
    'El impuesto de una línea contradice el régimen AIU del documento. La base gravable la determina el régimen —artículo 462-1 grava Administración, Imprevistos y Utilidad; Decreto 1372/1992 grava sólo la Utilidad—, no lo que la línea declare. Revisa el impuesto de la línea o el régimen del perfil: como está, el documento declararía un IVA que sus líneas no respaldan.',
  // Las bases son TRES, no dos. El texto anterior nombraba sólo las dos
  // primeras, y ese olvido no era cosmético: este mensaje se muestra justo
  // cuando el comerciante tiene que elegir una base, así que esconderle
  // `subtotal` lo empuja a marcar 462-1 o Decreto 1372/1992 para un contrato
  // que correspondía a subtotal — o sea a declarar el IVA mal, que es
  // exactamente el daño que este código existe para evitar. El backend ya
  // nombra las tres (`error-codes.ts`, INVOICING_AIU_006: «none of the THREE
  // known taxable bases») y el formulario ya ofrece `subtotal`
  // (`invoice-section-aiu.component.ts`), así que el copy era el único sitio
  // que seguía contando dos.
  INVOICING_AIU_006:
    'El documento declara una base gravable de AIU que no existe. Las tres válidas son el artículo 462-1 del Estatuto Tributario (grava Administración, Imprevistos y Utilidad, con piso legal del 10 %), el Decreto 1372/1992 (grava sólo la Utilidad, sin piso) y subtotal (renuncia al tratamiento AIU y grava el contrato completo, incluido el costo reembolsable). No son intercambiables: gravan bases distintas. Elige una en el perfil de facturación.',

  /**
   * XSD_002 — el descuadre de totales. Lo PRIMERO que hay que decir es lo mismo
   * que en `XSD_001`: no se gastó numeración. Quien ve fallar una emisión teme
   * haber quemado un consecutivo autorizado, y aquí la comprobación corre
   * ANTES de firmar.
   */
  INVOICING_XSD_002:
    'Los totales del documento no cuadran con lo que declaran sus líneas, así que no se firmó ni se transmitió nada y el borrador conserva su número: no se gastó numeración. Ocurre cuando la base gravable de la cabecera no coincide con la suma de las bases de las líneas. Previsualiza el perfil para ver qué línea no está aportando su base.',

  // ── Perfiles de facturación ───────────────────────────────────────────────
  INVOICING_PROFILE_001:
    'El perfil de facturación no existe o no pertenece a esta tienda.',
  INVOICING_PROFILE_002:
    'Otro perfil del mismo tipo de operación quedó como predeterminado al mismo tiempo. Vuelve a intentarlo: sólo puede haber un predeterminado por tipo, y la base lo garantiza.',
  INVOICING_PROFILE_003:
    'Este perfil no se puede eliminar porque hay facturas timbradas que lo referencian: su configuración es la que reproduce esas facturas y borrarla las dejaría sin respaldo. Desactívalo en su lugar — deja de ofrecerse al facturar y las facturas existentes siguen intactas.',
  INVOICING_PROFILE_004:
    'Ya existe un perfil con ese nombre en esta tienda. Elige otro nombre.',
  INVOICING_PROFILE_005:
    'La configuración del perfil no es válida fiscalmente. Los porcentajes de Administración, Imprevistos y Utilidad deben sumar exactamente 100, la base gravable no puede quedar por debajo del 10% mínimo del artículo 462-1, y la matriz de impuestos tiene que estar de acuerdo con el régimen elegido. Los campos con problema quedan marcados en el formulario.',
  INVOICING_PROFILE_007:
    'Un perfil inactivo no puede ser el predeterminado. Actívalo primero: el predeterminado es el que se usa al facturar sin elegir perfil, así que tiene que estar disponible.',
  INVOICING_PROFILE_VERSION_001:
    'Esa versión del perfil no existe. El historial puede haberse actualizado mientras la mirabas: vuelve a abrirlo para ver las versiones disponibles.',

  /**
   * PREVIEW_001 — no es un error del usuario, es un cinturón de seguridad que
   * salta. La previsualización tiene prohibido tocar la numeración autorizada:
   * un consecutivo tomado y no usado es irrecuperable. Si este código aparece,
   * el cinturón funcionó — pero hay un defecto que reportar.
   */
  INVOICING_PREVIEW_001:
    'La previsualización no se generó porque intentó consumir numeración autorizada, y eso está prohibido: no se reservó ningún número. Es un fallo interno, no un dato tuyo — reporta este caso a soporte.',
  INVOICING_PREVIEW_002:
    'Los datos de la muestra no permiten calcular la previsualización. Indica el valor del contrato o las líneas de ejemplo —uno de los dos, no ambos— y comprueba que el AIU no supere el valor del contrato.',

  /**
   * DIVISA — la factura siempre se emite en pesos; la divisa sólo se DECLARA.
   * Ninguno de los dos casos se puede resolver adivinando una tasa, así que los
   * mensajes piden el dato en vez de prometer un reintento.
   */
  INVOICING_TRM_001:
    'No se pudo obtener la TRM oficial para la fecha de la operación y no se indicó una tasa manual. Escribe la tasa de cambio en el documento: no se inventa ninguna, porque una tasa equivocada cambia el valor en pesos de la factura.',
  INVOICING_CURRENCY_001:
    'Para una divisa distinta del dólar hay que indicar la tasa de cambio a mano. La TRM oficial sólo cotiza dólar-peso, así que Vendix no puede derivar la equivalencia de otra moneda por su cuenta.',

  // Solicitudes de factura a nombre del cliente. El 001 lo ve el comerciante en
  // el panel; el 002/003/004 los ve el CLIENTE FINAL en el formulario público
  // post-venta, y por eso su copy habla de «la tienda» y no de «el cliente».
  INVOICING_DATA_REQUEST_001:
    'La solicitud ya no está pendiente de procesar: puede que el proceso automático la haya tomado primero. Actualiza la lista para ver en qué estado quedó.',
  INVOICING_DATA_REQUEST_002:
    'El enlace para solicitar tu factura no es válido. Pídele a la tienda uno nuevo.',
  INVOICING_DATA_REQUEST_003:
    'El enlace para solicitar tu factura venció. Pídele a la tienda uno nuevo.',
  INVOICING_DATA_REQUEST_004:
    'Este enlace ya recibió tus datos y sólo se puede usar una vez. La tienda está emitiendo tu factura.',

  // Kitchen tickets (Restaurant Suite Fase K audit jun-2026)
  KITCHEN_TICKET_NOT_READY:
    'No se puede marcar como entregado: el plato aun esta pendiente en cocina. Espera a que el KDS lo marque como listo.',
  KITCHEN_TICKET_ALREADY_DELIVERED:
    'Este plato ya fue marcado como entregado.',
  KITCHEN_TICKET_ALREADY_CANCELLED:
    'Este plato fue cancelado en cocina y no puede modificarse.',
  KITCHEN_TICKET_ALREADY_IN_PREPARATION:
    'El ticket ya esta en preparacion.',
  KITCHEN_TICKET_ALREADY_READY:
    'El ticket ya esta listo para entregar.',
  KITCHEN_TICKET_INVALID_STATE:
    'No se puede realizar esta transicion en el estado actual del ticket de cocina.',
  KITCHEN_TICKET_NO_RECIPE:
    'Este plato no tiene una receta activa: adjunta una receta antes de iniciar la preparacion.',
  KITCHEN_TICKET_CANNOT_REVERT:
    'El ticket esta en su estado inicial y no se puede revertir.',
  KITCHEN_TICKET_REVERT_ORDER_FINISHED:
    'La orden ya esta finalizada; no se puede revertir la entrega del ticket.',
  KITCHEN_TICKET_NOT_FOUND: 'Ticket de cocina no encontrado.',

  // QR Table dine-in (comensal — cuenta de mesa)
  TABLE_NOT_FOUND:
    'No encontramos esta mesa. Vuelve a escanear el código QR.',
  TABLE_SESSION_NOT_FOUND:
    'Aún no hay una cuenta abierta para esta mesa. Llama al mesero para que la abra.',
  TABLE_SESSION_ALREADY_OPEN:
    'Esta mesa ya tiene una cuenta abierta.',
  TABLE_SESSION_CLOSED:
    'La cuenta de esta mesa ya fue cerrada.',
  TABLE_SESSION_CUSTOMER_REQUIRED:
    'Necesitamos tus datos para abrir la cuenta de la mesa.',
  TABLE_INVALID_STATUS:
    'La mesa no está en un estado válido para esta acción.',
  TABLE_SESSION_ADD_ITEMS_INVALID:
    'No se pudieron agregar los productos a la cuenta de la mesa. Verifica que estén disponibles e intenta de nuevo.',
  MENU_ITEM_NOT_AVAILABLE_NOW:
    'Este producto no está disponible en este momento (fuera del horario del menú).',
  TABLE_GUEST_COUNT_EXCEEDS_CAPACITY:
    'El número de comensales supera la capacidad de la mesa.',

  // Caja registradora — transiciones de configuración (QUI-560)
  CASH_REGISTER_DISABLE_001:
    'No se puede deshabilitar la caja registradora: hay sesiones de caja abiertas. Ciérralas desde Caja Registradora antes de continuar.',

  // Caja registradora — cierre contra un esperado rancio (QUI-572)
  CASH_SESSION_EXPECTED_STALE_001:
    'El efectivo esperado cambió mientras contabas el arqueo. Revisá el resumen actualizado antes de cerrar la caja.',

  // Escáner de facturas de compra (POP). Ninguno estaba mapeado: el modal
  // mostraba el devMessage crudo en inglés («AI OCR response parsed but is
  // missing required fields»), que no le dice al usuario qué hacer.
  INV_SCAN_NO_FILE: 'Selecciona la factura que quieres escanear.',
  INV_SCAN_INVALID_FILE:
    'Formato no soportado. Sube la factura como JPG, PNG, WebP o PDF.',
  INV_SCAN_AI_FAIL:
    'No pudimos leer la factura. Vuelve a intentarlo; si persiste, sube una foto más nítida o carga los productos manualmente.',
  INV_SCAN_PARSE_FAIL:
    'La lectura de la factura llegó dañada. Vuelve a intentarlo con una imagen más nítida.',
  INV_SCAN_INCOMPLETE:
    'No se pudieron leer los datos mínimos de la factura (proveedor y productos). Sube una imagen más nítida o la página donde aparece el detalle de los productos.',

  // POS — flujo de venta y edición de orden (QUI-audit-round-1)
  // El cajero o el sistema corrigen estos códigos sin reiniciar la pantalla.
  POS_CUSTOMER_REQUIRED_001:
    'Selecciona o crea un cliente antes de guardar la orden.',
  POS_DRAFT_REQUIRES_PAYMENT_001:
    'No puedes cobrar y guardar borrador al mismo tiempo. Guarda la orden primero y luego cobra.',
  POS_STOCK_INSUFFICIENT_001:
    'No hay stock suficiente para uno o más productos.',
  // Round 3 MAJOR #5 — added to keep the mobile POS payment modal and the
  // web fallback copy aligned with the backend codes the cashier is told
  // to expect (`POS_DIRECT_METHOD_MISSING_001`, `POS_CREDIT_METHOD_MISSING_001`).
  POS_DIRECT_METHOD_MISSING_001:
    'No hay métodos de pago configurados para cobro directo.',
  POS_CREDIT_METHOD_MISSING_001:
    'No hay métodos de pago configurados para venta a crédito.',
  ORD_EDIT_STATE_CHANGED_001:
    'La orden cambió mientras se editaba. Actualiza la pantalla.',
  ORD_EDIT_NOT_ALLOWED_001: 'Esta orden ya no se puede editar.',
  ORD_EDIT_CUSTOMER_STORE_MISMATCH_001:
    'El cliente no pertenece a esta tienda.',
  ORD_EDIT_INVALID_SHIPPING_001:
    'Revisa la dirección, el método y el costo de envío.',
  ORD_EDIT_INVALID_STATE_001:
    'No se pudo guardar la orden. Vuelve a cargarla.',
  ORD_EDIT_PROMOTION_INVALID_001:
    'La promoción o cupón ya no está disponible.',
  ORD_EDIT_COUPON_COMMIT_001:
    'No fue posible registrar el cupón. Revisa la orden.',
  ORD_EDIT_RESPONSE_MISMATCH_001:
    'La orden se guardó pero no se pudo recargar. Actualiza el detalle.',
  ORD_FLOW_PAYMENT_FAILED_001:
    'No se pudo registrar el cobro. La orden sigue pendiente.',
};

export const EMPTY_CART_MESSAGE = 'El carrito está vacío.';
export const EMPTY_CART_INLINE_TITLE = 'Tu carrito está vacío';
export const EMPTY_CART_INLINE_HINT =
  'Selecciona productos en el panel izquierdo';

export const DEFAULT_ERROR_MESSAGE = 'Ocurrio un error. Intente de nuevo.';
