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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Lista los módulos del panel de esta tienda con su clave, nombre visible, ruta, para qué sirve, y si el usuario actual los ve o no. Úsala cuando no sepas qué clave de módulo pasarle a las demás herramientas de interfaz, o cuando el usuario pregunte "¿qué puedo hacer aquí?". Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Explica un módulo concreto: qué hace, para qué sirve, en qué ruta vive y si el usuario lo ve. Úsala antes de ofrecer llevar a alguien a un sitio, para no prometer un módulo que no existe en esta tienda. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Explica por qué el usuario no ve un módulo. Devuelve la PRIMERA capa que lo bloquea (permiso faltante, apagado en la configuración del panel de la tienda, apagado para este usuario, no aplica a la industria, requiere activación fiscal, requiere otro alcance de operación, o requiere un plan superior) y qué haría falta para desbloquearlo. Úsala siempre que alguien diga que no encuentra algo que debería estar. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Lleva al usuario a un módulo del panel. Ofrécelo ANTES de usarlo y espera un sí explícito: navegar sin avisar interrumpe lo que la persona estaba haciendo. Devuelve dónde aterrizó realmente, que puede no ser el destino pedido si un guard desvió la navegación. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Busca un producto por nombre y lo agrega al carrito del Punto de Venta. Requiere que el usuario ya esté en el POS: navega primero con ui_navigate si no lo está. Si el producto tiene variantes, exige peso, o es un preparado que puede salir de stock o producirse, NO decide por su cuenta: devuelve needs_user_input y tú le pides a la persona que elija. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Quita una línea del carrito del Punto de Venta, identificada por el nombre del producto. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Asigna un cliente existente a la venta abierta en el Punto de Venta, buscándolo por nombre, documento o teléfono. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Muestra en pantalla el detalle línea por línea del carrito del Punto de Venta. NO la uses para enterarte de qué lleva el usuario: el conteo de líneas, el total y el cliente asignado ya te llegan en el contexto de pantalla de cada turno, y esta herramienta corre en el navegador sin devolverte nada. Úsala solo cuando la persona pida ver el desglose. Para resumirle la venta antes de preguntarle si confirma para cobrar, habla desde el contexto que ya tienes. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_pos_checkout',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Cobra la venta abierta en el Punto de Venta. Úsala SOLO después de haberle resumido la venta a la persona —líneas, cantidades, total y a qué cliente va— y de que ella haya confirmado que quiere cobrar. Abre el cobro con el medio de pago que la persona elija y te devuelve si la venta quedó cobrada, con su número de orden. Si te dice explícitamente el medio de pago pero no lo has confirmado todo, primero resume y pregunta. Nunca contestes que el cobro lo tiene que hacer ella. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_refresh',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Recarga los datos del módulo que el usuario tiene en pantalla, para que vea el resultado de un cambio que acabas de ejecutar. Úsala inmediatamente después de una escritura confirmada. Si el módulo en pantalla no corresponde al dominio que cambiaste, te lo dirá y entonces debes avisarle a la persona que actualice la vista. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Lee lo que la persona tiene en pantalla ahora mismo: qué módulo es, qué filtros están aplicados, cuántos registros se ven y qué hay seleccionado. Úsala cuando la persona diga "esto", "este", "lo que estoy viendo", o cuando necesites saber el estado real de la vista antes de tocarla. No sirve para consultar datos del negocio: para eso están las herramientas de consulta. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_list_actions',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Lista las acciones que el módulo en pantalla expone y que puedes disparar con ui_click_action. Llámala antes de intentar una acción que no hayas usado en esta conversación: cada módulo declara las suyas, así que adivinar el nombre falla. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_fill_form',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Llena campos del formulario abierto en pantalla, SIN guardarlo. Deja el formulario listo para que la persona lo revise y confirme: es lo que se hace cuando ella quiere ver antes de guardar, o cuando falta una decisión que solo ella puede tomar. Pásale los campos con los nombres que devolvió ui_read_screen. Nunca digas que guardaste: llenar no es guardar. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Aplica filtros a la lista que la persona tiene en pantalla: fechas, estado, búsqueda, categoría. Úsala cuando pidan ver un subconjunto de lo que ya están viendo ("muéstrame solo los de agosto sin aprobar"). También acepta `page` y `limit` para paginar, `sort` ("campo:dirección", p.ej. "name:asc") para ordenar, y `selection` con el nombre del registro a seleccionar y abrir ("Orden 1046", "Acme SAS"). Cambiar un filtro vuelve a la página 1, igual que la UI. El conteo se lee después con ui_read_screen porque el refetch es asíncrono. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          description:
            'Pares filtro-valor, con los nombres que devolvió ui_read_screen, más las claves reservadas `page` (número de página, 1-based), `limit` (filas por página), `sort` ("campo:asc|desc") y `selection` (nombre del registro a seleccionar y abrir, p.ej. "Orden 1046"). Las claves que la lista no entienda se reportan, no se inventan.',
        },
      },
      required: ['values'],
    },
  },
  {
    name: 'ui_export',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Descarga el export del contexto actual en el navegador: si la persona está viendo un reporte, dispara su exportación XLSX existente; si el módulo expone una acción de exportar, la dispara. Devuelve el nombre del archivo descargado. Complementa a `export_report` del servidor (A-1): ese genera el XLSX, este lo dispara desde la pantalla. Nunca inventa un archivo: si no hay export en este contexto lo dice con `no_export`. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: {
      type: 'object',
      properties: {
        report_id: {
          type: 'string',
          description:
            'Id del reporte a exportar, de REPORT_DEFINITIONS. Omítelo para exportar lo que la persona tiene en pantalla.',
        },
        format: {
          type: 'string',
          description: 'Formato pedido. Solo se soporta "xlsx".',
        },
        date_from: {
          type: 'string',
          description:
            'Inicio del rango (YYYY-MM-DD) cuando el reporte lo admite. Omítelo para usar el rango de la pantalla.',
        },
        date_to: {
          type: 'string',
          description:
            'Fin del rango (YYYY-MM-DD) cuando el reporte lo admite. Omítelo para usar el rango de la pantalla.',
        },
      },
      required: [],
    },
  },
  {
    name: 'ui_click_action',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Dispara una acción del módulo en pantalla, de las que devuelve ui_list_actions. Si la acción modifica datos, la pantalla pedirá su propia confirmación: no la des por hecha. Úsala cuando la acción vive en la interfaz y no tiene equivalente por API, o cuando conducir la pantalla es lo que la persona pidió. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Abre un formulario o diálogo del módulo en pantalla —crear, editar, filtrar— sin llenarlo ni guardarlo. Combínala con ui_fill_form cuando quieras dejarle el formulario preparado a la persona. Los nombres válidos los devuelve ui_list_actions. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Espera a que la pantalla termine de cargar antes de seguir. Úsala solo después de navegar o de disparar una acción que recarga datos, cuando el siguiente paso depende de lo que aparezca. No la uses "por si acaso": cada espera le cuesta tiempo a la persona. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
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

  // ── Tours, modales, diálogos, selección y descubrimiento (U-2..U-8) ───────
  //
  // Mismo contrato que los comandos genéricos: declaración clientSide sin
  // handler, resuelta en el navegador contra el host registrado, el
  // `DialogService` o el `TourService`. Cada una responde un estado honesto
  // (`no_open_modal`, `no_pending_confirm`, `no_selection`, `unknown_tour`)
  // con `next_step` en español en vez de fingir.
  {
    name: 'ui_list_tours',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Lista los recorridos guiados disponibles con su estado para este usuario (disponible, en curso, completado, saltado). Úsala cuando la persona quiera que la guíes por una pantalla. Ofrece el tour, nunca lo fuerces: si ya lo completó o lo saltó, pregúntale antes de reiniciarlo. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_start_tour',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Inicia un recorrido guiado en la pantalla de la persona. Pásale el id que devolvió ui_list_tours. Si el tour ya fue completado o saltado no se abre: ofrécele reiniciarlo con ui_reset_tour y espera su sí. Nunca inicies un tour que la persona no pidió. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: {
      type: 'object',
      properties: {
        tour_id: {
          type: 'string',
          description:
            'Identificador del tour, tal como lo devolvió ui_list_tours.',
        },
      },
      required: ['tour_id'],
    },
  },
  {
    name: 'ui_reset_tour',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Resetea un recorrido completado o saltado para que pueda volver a mostrarse, solo para este usuario. Úsala únicamente cuando la persona pida repetir el tour. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: {
      type: 'object',
      properties: {
        tour_id: {
          type: 'string',
          description:
            'Identificador del tour, tal como lo devolvió ui_list_tours.',
        },
      },
      required: ['tour_id'],
    },
  },
  {
    name: 'ui_close_modal',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Cierra el modal o formulario que la persona tiene abierto en pantalla. Úsala después de verificar con ui_read_screen (open_modal) qué hay abierto. Si no hay modal abierto lo dice con `no_open_modal`. No cierra diálogos de confirmación pendientes: esos se responden con ui_confirm_dialog. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_confirm_dialog',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Responde el diálogo de confirmación pendiente en pantalla (aceptar o cancelar). Úsala SOLO cuando la persona ya dijo explícitamente en el chat que acepta o que cancela: ningún diálogo se auto-aprueba. Si el diálogo es peligroso (danger), exige además que la persona escriba con sus palabras la consecuencia antes de aceptar. Sin diálogo pendiente responde `no_pending_confirm`. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: {
      type: 'object',
      properties: {
        accept: {
          type: 'boolean',
          description:
            'true para aceptar el diálogo, false para cancelarlo, según lo que la persona dijo en el chat.',
        },
        consequence: {
          type: 'string',
          description:
            'La consecuencia escrita por la persona con sus palabras. Obligatoria cuando el diálogo es peligroso (danger): sin ella el dispatcher rechaza la aceptación.',
        },
      },
      required: ['accept'],
    },
  },
  {
    name: 'ui_read_selection',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Lee qué registro tiene seleccionado o abierto la persona (fila, ficha o detalle), nombrado como ella lo nombraría ("Orden 1046 de Acme"). Úsala antes de actuar "sobre esto", y en cadena ui_read_screen → ui_read_selection → acción. Sin nada seleccionado responde `no_selection` honesto. Para seleccionar, pasa `selection` a ui_set_filter ("abre la orden 1046"). Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_explain_screen',
    version: '1',
    domain: 'ui',
    clientSide: true,
    description:
      'Explica la pantalla actual en una sola llamada: qué módulo es, qué acciones ofrece y qué módulos relacionados están ocultos, con la causa de cada oculto y dónde desbloquearlo. Úsala cuando pregunten "¿qué puedo hacer aquí?". Si un módulo está oculto explica por qué y dónde resolverlo; nunca invites a clicar lo invisible. Solo corre en el panel web (web_only): en móvil no hay dispatcher de interfaz.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];
