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
 *
 * The agent loop now WAITS for each of these and receives the browser's real
 * answer inside the same turn (`vexi-ui-channel.service.ts`), which is what makes
 * the generic commands below usable at all: filling a form blind, with no way to
 * learn whether the field existed, is a shot in the dark that the model would then
 * narrate as a success.
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
      'Muestra en pantalla el detalle línea por línea del carrito del Punto de Venta. NO la uses para enterarte de qué lleva el usuario: el conteo de líneas, el total y el cliente asignado ya te llegan en el contexto de pantalla de cada turno, y esta herramienta corre en el navegador sin devolverte nada. Úsala solo cuando la persona pida ver el desglose. Para resumirle la venta antes de preguntarle si confirma para cobrar, habla desde el contexto que ya tienes.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_pos_checkout',
    domain: 'ui',
    clientSide: true,
    description:
      'Cobra la venta abierta en el Punto de Venta. Úsala SOLO después de haberle resumido la venta a la persona —líneas, cantidades, total y a qué cliente va— y de que ella haya confirmado que quiere cobrar. Abre el cobro con el medio de pago que la persona elija y te devuelve si la venta quedó cobrada, con su número de orden. Si te dice explícitamente el medio de pago pero no lo has confirmado todo, primero resume y pregunta. Nunca contestes que el cobro lo tiene que hacer ella.',
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

  // ── Comandos genéricos ──────────────────────────────────────────────────
  //
  // Resueltos contra el host que el módulo en pantalla registró en
  // `VexiUiHostRegistry`. Un módulo entra al alcance operativo de Vexi
  // registrándose a sí mismo y declarando qué acciones expone; el agente no
  // conoce componentes por nombre ni toca servicios internos, que es lo que
  // impide armar estados que la propia pantalla rechazaría después.
  {
    name: 'ui_read_screen',
    domain: 'ui',
    clientSide: true,
    description:
      'Lee lo que la persona tiene en pantalla ahora mismo: qué módulo es, qué filtros están aplicados, cuántos registros se ven y qué hay seleccionado. Úsala cuando la persona diga "esto", "este", "lo que estoy viendo", o cuando necesites saber el estado real de la vista antes de tocarla. No sirve para consultar datos del negocio: para eso están las herramientas de consulta.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_list_actions',
    domain: 'ui',
    clientSide: true,
    description:
      'Lista las acciones que el módulo en pantalla expone y que puedes disparar con ui_click_action. Llámala antes de intentar una acción que no hayas usado en esta conversación: cada módulo declara las suyas, así que adivinar el nombre falla.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_fill_form',
    domain: 'ui',
    clientSide: true,
    description:
      'Llena campos del formulario abierto en pantalla, SIN guardarlo. Deja el formulario listo para que la persona lo revise y confirme: es lo que se hace cuando ella quiere ver antes de guardar, o cuando falta una decisión que solo ella puede tomar. Pásale los campos con los nombres que devolvió ui_read_screen. Nunca digas que guardaste: llenar no es guardar.',
    parameters: {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          description:
            'Pares campo-valor a poner en el formulario, por ejemplo {"description":"Luz de agosto","amount":180000}.',
        },
      },
      required: ['values'],
    },
  },
  {
    name: 'ui_set_filter',
    domain: 'ui',
    clientSide: true,
    description:
      'Aplica filtros a la lista que la persona tiene en pantalla: fechas, estado, búsqueda, categoría. Úsala cuando pidan ver un subconjunto de lo que ya están viendo ("muéstrame solo los de agosto sin aprobar"). Te devuelve cuántos registros quedaron, así que puedes decírselo.',
    parameters: {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          description:
            'Pares filtro-valor, con los nombres que devolvió ui_read_screen.',
        },
      },
      required: ['values'],
    },
  },
  {
    name: 'ui_click_action',
    domain: 'ui',
    clientSide: true,
    description:
      'Dispara una acción del módulo en pantalla, de las que devuelve ui_list_actions. Si la acción modifica datos, la pantalla pedirá su propia confirmación: no la des por hecha. Úsala cuando la acción vive en la interfaz y no tiene equivalente por API, o cuando conducir la pantalla es lo que la persona pidió.',
    parameters: {
      type: 'object',
      properties: {
        action_id: {
          type: 'string',
          description: 'Identificador de la acción, tal como lo devolvió ui_list_actions.',
        },
        args: {
          type: 'object',
          description: 'Argumentos que la acción declare necesitar.',
        },
      },
      required: ['action_id'],
    },
  },
  {
    name: 'ui_open_modal',
    domain: 'ui',
    clientSide: true,
    description:
      'Abre un formulario o diálogo del módulo en pantalla —crear, editar, filtrar— sin llenarlo ni guardarlo. Combínala con ui_fill_form cuando quieras dejarle el formulario preparado a la persona. Los nombres válidos los devuelve ui_list_actions.',
    parameters: {
      type: 'object',
      properties: {
        modal_id: {
          type: 'string',
          description: 'Identificador del diálogo, de ui_list_actions.',
        },
        args: {
          type: 'object',
          description: 'Contexto que el diálogo necesite, por ejemplo el registro a editar.',
        },
      },
      required: ['modal_id'],
    },
  },
  {
    name: 'ui_wait_for',
    domain: 'ui',
    clientSide: true,
    description:
      'Espera a que la pantalla termine de cargar antes de seguir. Úsala solo después de navegar o de disparar una acción que recarga datos, cuando el siguiente paso depende de lo que aparezca. No la uses "por si acaso": cada espera le cuesta tiempo a la persona.',
    parameters: {
      type: 'object',
      properties: {
        module_key: {
          type: 'string',
          description:
            'Módulo que se espera tener en pantalla. Omítelo para esperar el que ya está.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Tope de espera en milisegundos. Por defecto 5000, máximo 15000.',
        },
      },
      required: [],
    },
  },
];
