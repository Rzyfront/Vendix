import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Client-side UI commands.
 *
 * These are *declarations only* — no handler, because there is no router and
 * no cart in this process. The browser intercepts them by the `ui_` prefix and
 * dispatches them against the live application; `AIToolRegistry.executeTool()`
 * refuses them so a mis-wired client fails loudly instead of silently
 * reporting success for something that never happened.
 *
 * No `requiredPermissions`: Vexi is already restricted to owner and admin, and
 * what a given user may actually reach is decided by the browser dispatcher
 * against the real visibility chain — the same one that paints the sidebar.
 * Duplicating that decision here would be a second source of truth that drifts.
 */
export const uiTools: RegisteredTool[] = [
  {
    name: 'ui_list_modules',
    domain: 'ui',
    clientSide: true,
    description:
      'Lista los módulos del panel de esta tienda con su clave, nombre visible, ruta, para qué sirve, y si el usuario actual los ve o no. Úsala cuando no sepas qué clave de módulo pasarle a las demás herramientas de interfaz, o cuando el usuario pregunte "¿qué puedo hacer aquí?".',
    parameters: {
      type: 'object',
      properties: {
        only_visible: {
          type: 'boolean',
          description:
            'Si es true devuelve solo los módulos que el usuario ve. Por defecto false: incluye los ocultos, que es lo que necesitas para explicar por qué no aparece alguno.',
        },
      },
      required: [],
    },
  },
  {
    name: 'ui_explain_module',
    domain: 'ui',
    clientSide: true,
    description:
      'Explica un módulo concreto: qué hace, para qué sirve, en qué ruta vive y si el usuario lo ve. Úsala antes de ofrecer llevar a alguien a un sitio, para no prometer un módulo que no existe en esta tienda.',
    parameters: {
      type: 'object',
      properties: {
        module_key: {
          type: 'string',
          description:
            'Clave del módulo, tal como la devuelve ui_list_modules (por ejemplo "inventory_pop", "pos", "products").',
        },
      },
      required: ['module_key'],
    },
  },
  {
    name: 'ui_why_hidden',
    domain: 'ui',
    clientSide: true,
    description:
      'Explica por qué el usuario no ve un módulo. Devuelve la PRIMERA capa que lo bloquea (permiso faltante, apagado en la configuración del panel de la tienda, apagado para este usuario, no aplica a la industria, requiere activación fiscal, requiere otro alcance de operación, o requiere un plan superior) y qué haría falta para desbloquearlo. Úsala siempre que alguien diga que no encuentra algo que debería estar.',
    parameters: {
      type: 'object',
      properties: {
        module_key: {
          type: 'string',
          description: 'Clave del módulo que el usuario espera ver.',
        },
      },
      required: ['module_key'],
    },
  },
  {
    name: 'ui_navigate',
    domain: 'ui',
    clientSide: true,
    description:
      'Lleva al usuario a un módulo del panel. Ofrécelo ANTES de usarlo y espera un sí explícito: navegar sin avisar interrumpe lo que la persona estaba haciendo. Devuelve dónde aterrizó realmente, que puede no ser el destino pedido si un guard desvió la navegación.',
    parameters: {
      type: 'object',
      properties: {
        module_key: {
          type: 'string',
          description:
            'Clave del módulo destino, de ui_list_modules. No inventes rutas: pasa la clave y el navegador la resuelve.',
        },
      },
      required: ['module_key'],
    },
  },
  {
    name: 'ui_pos_add_item',
    domain: 'ui',
    clientSide: true,
    description:
      'Busca un producto por nombre y lo agrega al carrito del Punto de Venta. Requiere que el usuario ya esté en el POS: navega primero con ui_navigate si no lo está. Si el producto tiene variantes, exige peso, o es un preparado que puede salir de stock o producirse, NO decide por su cuenta: devuelve needs_user_input y tú le pides a la persona que elija.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Nombre del producto tal como lo dijo el usuario, por ejemplo "café americano".',
        },
        quantity: {
          type: 'number',
          description: 'Cantidad a agregar. Por defecto 1.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'ui_pos_remove_item',
    domain: 'ui',
    clientSide: true,
    description:
      'Quita una línea del carrito del Punto de Venta, identificada por el nombre del producto.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Nombre del producto que hay que quitar del carrito.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'ui_pos_set_customer',
    domain: 'ui',
    clientSide: true,
    description:
      'Asigna un cliente existente a la venta abierta en el Punto de Venta, buscándolo por nombre, documento o teléfono.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Nombre, documento o teléfono del cliente.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'ui_pos_read_cart',
    domain: 'ui',
    clientSide: true,
    description:
      'Lee el carrito actual del Punto de Venta: líneas, cantidades, subtotal y total. Úsala para resumirle al usuario qué lleva antes de preguntarle si desea crear, enviar o pagar la orden. Vexi nunca cobra: el pago lo hace la persona.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_refresh',
    domain: 'ui',
    clientSide: true,
    description:
      'Recarga los datos del módulo que el usuario tiene en pantalla, para que vea el resultado de un cambio que acabas de ejecutar. Úsala inmediatamente después de una escritura confirmada. Si el módulo en pantalla no corresponde al dominio que cambiaste, te lo dirá y entonces debes avisarle a la persona que actualice la vista.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description:
            'Dominio de datos que cambió: "products", "inventory", "customers", "orders", "dispatch".',
        },
      },
      required: ['domain'],
    },
  },
];
