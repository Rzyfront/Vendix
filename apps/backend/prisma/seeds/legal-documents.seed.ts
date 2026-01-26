import { PrismaClient, legal_document_type_enum } from '@prisma/client';

export async function seedLegalDocuments(prisma: PrismaClient) {
  console.log('📜 Seeding legal documents...');

  const termsOfService = await prisma.legal_documents.upsert({
    where: {
      version: '1.0',
      document_type: 'TERMS_OF_SERVICE',
    },
    create: {
      document_type: 'TERMS_OF_SERVICE',
      title: 'Términos y Condiciones de Uso de Vendix',
      version: '1.0',
      content: `
        <h1>Términos y Condiciones de Uso de Vendix</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Aceptación de los Términos</h2>
        <p>Al acceder y usar la plataforma Vendix, usted acepta y se obliga a cumplir estos términos. Si no está de acuerdo con estos términos, no debe usar la plataforma.</p>

        <h2>2. Descripción del Servicio</h2>
        <p>Vendix es una plataforma de gestión comercial que proporciona herramientas para administración de tiendas, ventas, inventario y operaciones empresariales.</p>

        <h2>3. Obligaciones del Usuario</h2>
        <ul>
          <li>Mantener la confidencialidad de las credenciales de acceso</li>
          <li>Proporcionar información veraz y actualizada</li>
          <li>Utilizar la plataforma solamente para fines legítimos</li>
          <li>Responsabilizarse por el contenido que publique</li>
        </ul>

        <h2>4. Propiedad Intelectual</h2>
        <p>Todo el contenido, marcas, logos y materiales de Vendix son propiedad exclusiva de Vendix o de sus licenciantes.</p>

        <h2>5. Limitación de Responsabilidad</h2>
        <p>Vendix no se hace responsable por:</p>
        <ul>
          <li>Daños indirectos o consecuentes del uso del servicio</li>
          <li>Interrupciones del servicio por causas técnicas</li>
          <li>Contenido generado por usuarios</li>
        </ul>

        <h2>6. Modificaciones</h2>
        <p>Vendix se reserva el derecho de modificar estos términos en cualquier momento. Los usuarios serán notificados de cambios significativos.</p>

        <h2>7. Terminación</h2>
        <p>Vendix puede suspender o terminar cuentas que violen estos términos.</p>

        <h2>8. Ley Aplicable</h2>
        <p>Estos términos se rigen por las leyes de Colombia. Cualquier controversia estará sujeta a los tribunales competentes.</p>

        <p><em>Para más información, contacte a legal@vendix.com</em></p>
      `,
      effective_date: new Date(),
      is_active: true,
      is_system: true,
      description: 'Términos y condiciones generales de uso de la plataforma Vendix',
    },
    update: {},
  });

  const privacyPolicy = await prisma.legal_documents.upsert({
    where: {
      version: '1.0-privacy',
    },
    create: {
      document_type: 'PRIVACY_POLICY',
      title: 'Política de Privacidad de Vendix',
      version: '1.0-privacy',
      content: `
        <h1>Política de Privacidad de Vendix</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Información que Recopilamos</h2>
        <p>Vendix recopila la siguiente información personal:</p>
        <ul>
          <li>Datos de registro (nombre, email, teléfono)</li>
          <li>Información de perfil y preferencias</li>
          <li>Datos de uso de la plataforma</li>
          <li>Información de pagos (cuando aplica)</li>
        </ul>

        <h2>2. Cómo Usamos su Información</h2>
        <p>Utilizamos su información para:</p>
        <ul>
          <li>Proporcionar y mejorar nuestros servicios</li>
          <li>Procesar transacciones y pagos</li>
          <li>Enviar notificaciones y comunicaciones</li>
          <li>Analizar patrones de uso</li>
          <li>Cumplir obligaciones legales</li>
        </ul>

        <h2>3. Compartición de Información</h2>
        <p>No vendemos su información personal a terceros. Podemos compartir datos con:</p>
        <ul>
          <li>Proveedores de servicios necesarios para operar la plataforma</li>
          <li>Autoridades gubernamentales cuando sea requerido</li>
          <li>Socios de crédito y procesamiento de pagos</li>
        </ul>

        <h2>4. Seguridad de Datos</h2>
        <p>Implementamos medidas de seguridad incluyendo:</p>
        <ul>
          <li>Encriptación de datos en tránsito y en reposo</li>
          <li>Control de acceso con autenticación requerida</li>
          <li>Monitoreo continuo de actividades sospechosas</li>
          <li>Auditoría de accesos y modificaciones</li>
        </ul>

        <h2>5. Sus Derechos</h2>
        <p>Usted tiene derecho a:</p>
        <ul>
          <li>Acceder a sus datos personales</li>
          <li>Solicitar corrección o eliminación</li>
          <li>Revocar consentimientos</li>
          <li>Exportar su información</li>
          <li>Oponerse al procesamiento de datos</li>
        </ul>

        <h2>6. Retención de Datos</h2>
        <p>Mantenemos su información solo el tiempo necesario para:</p>
        <ul>
          <li>Proporcionar los servicios contratados</li>
          <li>Cumplir requisitos legales y contables</li>
          <li>Resolver disputas y defensas legales</li>
        </ul>

        <h2>7. Cookies y Tecnologías Similares</h2>
        <p>Utilizamos cookies y tecnologías similares para:</p>
        <ul>
          <li>Mantener su sesión activa</li>
          <li>Recordar sus preferencias</li>
          <li>Analizar el uso de la plataforma</li>
        </ul>

        <h2>8. Contacto</h2>
        <p>Para preguntas sobre privacidad, contacte a: privacy@vendix.com</p>

        <h2>9. Cambios en esta Política</h2>
        <p>Nos reservamos el derecho de actualizar esta política. Le notificaremos cambios significativos.</p>
      `,
      effective_date: new Date(),
      is_active: true,
      is_system: true,
      description: 'Política de privacidad y protección de datos personales',
    },
    update: {},
  });

  const merchantAgreement = await prisma.legal_documents.upsert({
    where: {
      version: '1.0-merchant',
    },
    create: {
      document_type: 'MERCHANT_AGREEMENT',
      title: 'Acuerdo de Comerciante de Vendix',
      version: '1.0-merchant',
      content: `
        <h1>Acuerdo de Comerciante de Vendix</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Objeto del Acuerdo</h2>
        <p>Este acuerdo rige la relación entre Vendix y los comerciantes que utilizan la plataforma para gestionar sus operaciones comerciales.</p>

        <h2>2. Servicios Contratados</h2>
        <p>Vendix proporciona:</p>
        <ul>
          <li>Plataforma de gestión de inventario</li>
          <li>Sistema de punto de venta (POS)</li>
          <li>Gestión de pedidos y ventas</li>
          <li>Reportes y analíticas</li>
          <li>Integraciones con pasarelas de pago</li>
        </ul>

        <h2>3. Responsabilidades del Comerciante</h2>
        <p>El comerciante se compromete a:</p>
        <ul>
          <li>Mantener actualizada la información de sus productos</li>
          <li>Honorar los precios y promociones publicadas</li>
          <li>Entregar los productos vendidos según lo pactado</li>
          <li>Cumplir con las leyes comerciales aplicables</li>
          <li>Responder a consultas y reclamos en tiempo razonable</li>
        </ul>

        <h2>4. Tarifas y Comisiones</h2>
        <p>El uso de la plataforma está sujeto a tarifas y comisiones establecidas en el contrato de servicio.</p>

        <h2>5. Propiedad Intelectual</h2>
        <p>El comerciante mantiene la propiedad de su información de productos y clientes. Vendix conserva la propiedad de la plataforma y tecnología.</p>

        <h2>6. Confidencialidad</h2>
        <p>Ambas partes acuerdan mantener confidencial la información comercial y técnica intercambiada.</p>

        <h2>7. Duración</h2>
        <p>Este acuerdo tiene vigencia indefinida sujeto a terminación por cualquiera de las partes con 30 días de notificación.</p>

        <h2>8. Jurisdicción</h2>
        <p>Este acuerdo se rige por las leyes de Colombia. Cualquier controversia se resolverá en los tribunales competentes.</p>
      `,
      effective_date: new Date(),
      is_active: true,
      is_system: true,
      description: 'Acuerdo marco para comerciantes que utilizan Vendix',
    },
    update: {},
  });

  const refundPolicy = await prisma.legal_documents.upsert({
    where: {
      version: '1.0-refund',
    },
    create: {
      document_type: 'REFUND_POLICY',
      title: 'Política de Reembolso - Estándar Vendix',
      version: '1.0-refund',
      content: `
        <h1>Política de Reembolso</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Condiciones Generales</h2>
        <p>Los clientes pueden solicitar reembolso dentro de los siguientes plazos:</p>
        <ul>
          <li>Productos digitales: 7 días calendario desde la compra</li>
          <li>Productos físicos: 15 días calendario desde la recepción</li>
        </ul>

        <h2>2. Requisitos para Reembolso</h2>
        <p>Para ser elegible para reembolso, el producto debe:</p>
        <ul>
          <li>Estar en su condición original (sin uso)</li>
          <li>Incluir todos los accesorios y empaque original</li>
          <li>Tener recibo o comprobante de compra</li>
          <li>No estar excluido por categorías especiales (higiénico, personalizado)</li>
        </ul>

        <h2>3. Productos No Reembolsables</h2>
        <p>No se aceptan reembolsos para:</p>
        <ul>
          <li>Productos sellados con descuento mayor al 50%</li>
          <li>Productos personalizados fabricados bajo pedido</li>
          <li>Productos de categorías higiénicas una vez abiertos</li>
          <li>Productos digitales descargados</li>
        </ul>

        <h2>4. Proceso de Reembolso</h2>
        <ol>
          <li>Solicitar reembolso a través de la plataforma</li>
          <li>Autorizar la devolución del producto</li>
          <li>Enviar el producto a la dirección especificada</li>
          <li>Recibir el reembolso en el método de pago original</li>
        </ol>

        <h2>5. Costos de Envío</h2>
        <p>Los costos de envío de devolución son responsabilidad del cliente, excepto cuando el reembolso se debe a defecto del producto.</p>

        <h2>6. Tiempos de Procesamiento</h2>
        <p>Los reembolsos se procesan dentro de 5-10 días hábiles después de recibir el producto devuelto.</p>

        <h2>7. Métodos de Reembolso</h2>
        <p>Los reembolsos se acreditan al mismo método de pago utilizado en la compra original.</p>
      `,
      effective_date: new Date(),
      is_active: true,
      is_system: true,
      description: 'Política de reembolsos estándar para todas las tiendas',
    },
    update: {},
  });

  const shippingPolicy = await prisma.legal_documents.upsert({
    where: {
      version: '1.0-shipping',
    },
    create: {
      document_type: 'SHIPPING_POLICY',
      title: 'Política de Envíos - Estándar Vendix',
      version: '1.0-shipping',
      content: `
        <h1>Política de Envíos</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Zonas de Cobertura</h2>
        <p>Realizamos envíos a todo el territorio nacional colombiano.</p>

        <h2>2. Tiempos de Entrega</h2>
        <p>Los tiempos de entrega estimados son:</p>
        <ul>
          <li>Principales ciudades: 2-3 días hábiles</li>
          <li>Otras ciudades: 3-5 días hábiles</li>
          <li>Zonas rurales: 5-7 días hábiles</li>
        </ul>

        <h2>3. Costos de Envío</h2>
        <p>Los costos se calculan según:</p>
        <ul>
          <li>Ubicación geográfica</li>
          <li>Peso y dimensiones del paquete</li>
          <li>Método de envío seleccionado</li>
        </ul>

        <h2>4. Métodos de Envío Disponibles</h2>
        <ul>
          <li>Envío estándar (servicios de mensajería)</li>
          <li>Envío exprés (servicios de paquetería)</li>
          <li>Recogida en tienda (cuando está disponible)</li>
        </ul>

        <h2>5. Seguimiento de Pedidos</h2>
        <p>Los clientes pueden seguir el estado de su envío a través de la plataforma con número de guía.</p>

        <h2>6. Pérdidas o Daños</h2>
        <p>El transportista es responsable por:</p>
        <ul>
          <li>Pérdida total del paquete</li>
          <li>Daños visibles al empaque o contenido</li>
        </ul>
        <p>Recomendamos fotografiar el paquete antes del envío.</p>

        <h2>7. Dirección Incompleta</h2>
        <p>Si la dirección proporcionada es incompleta o incorrecta, se contactará al cliente para corregirla. Esto puede generar costos adicionales.</p>
      `,
      effective_date: new Date(),
      is_active: true,
      is_system: true,
      description: 'Política de envíos estándar para todas las tiendas',
    },
    update: {},
  });

  console.log('✅ Legal documents seeded successfully');
  console.log(`   - ${termsOfService.title} v${termsOfService.version}`);
  console.log(`   - ${privacyPolicy.title} v${privacyPolicy.version}`);
  console.log(`   - ${merchantAgreement.title} v${merchantAgreement.version}`);
  console.log(`   - ${refundPolicy.title} v${refundPolicy.version}`);
  console.log(`   - ${shippingPolicy.title} v${shippingPolicy.version}`);
}
