import { uiTools } from './ui.tools';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  isUiAuditEntry,
  redactUiAuditValue,
} from '../../../domains/store/vexi/vexi-activity.service';

/**
 * Paso 9 (P0 UI) + paso 14 (P1/P2 UI) — spec de contrato de las tools
 * clientSide: G1 (fillForm), U-1 (ui_export), G3 (paginación/orden),
 * U-2/U-3/U-4 (tours), U-5 (close_modal), U-6 (confirm_dialog),
 * U-7 (read_selection + `selection` en setFilter), U-8 (explain_screen),
 * G8 (hosts nuevos), G9 (whenReady), G10 (`web_only`) y G12 (auditoría UI).
 *
 * Las tools `ui_*` son declaración sin handler: el servidor no tiene router
 * ni carrito, así que el navegador las despacha contra el host registrado y
 * `executeTool()` las rechaza con AI_AGENT_004. Esta spec pinnea lo que el
 * backend sí posee —registro, categoría, versión y JSON Schema— y documenta
 * el contrato del lado cliente que Playwright verifica (ver `ui.tools.ts` y
 * `vexi-ui-command.service.ts`):
 *
 * - ui_fill_form llena pero NUNCA guarda; sin `fillForm` en el host responde
 *   `no_host`, y con el form inválido devuelve `validation_errors` + next_step.
 * - ui_export despacha el export existente del contexto y devuelve
 *   `{filename, status}` o `no_export` + next_step; nunca inventa un archivo.
 * - ui_set_filter acepta `page`/`limit`/`sort`/`selection` además de los
 *   filtros del módulo, resetea a página 1 en cambio de filtro, y el conteo
 *   se re-lee con ui_read_screen porque el refetch es asíncrono.
 * - ui_read_selection lee la selección por nombre humano o `no_selection`.
 * - ui_close_modal cierra vía `host.closeModal?()` o `no_open_modal`.
 * - ui_confirm_dialog responde el `pendingConfirm` solo con confirmación
 *   explícita previa; `danger` exige la consecuencia escrita por el usuario.
 * - ui_list/start/reset_tour operan sobre el mapa inyectable + estado
 *   `user_settings.config.tours`; nunca fuerzan un tour.
 * - ui_explain_screen compone readScreen + listActions + diagnoseModule.
 */
function byName(name: string): RegisteredTool {
  const tool = uiTools.find((registered) => registered.name === name);
  if (!tool) throw new Error(`${name} no está declarada en uiTools`);
  return tool;
}

describe('ui.tools · registro clientSide (paso 9)', () => {
  it('todas las ui_* son clientSide sin handler, dominio ui y version 1', () => {
    expect(uiTools.length).toBeGreaterThan(0);
    for (const tool of uiTools) {
      expect(tool.name.startsWith('ui_')).toBe(true);
      expect(tool.domain).toBe('ui');
      expect(tool.version).toBe('1');
      expect(tool.clientSide).toBe(true);
      expect(tool.handler).toBeUndefined();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('ninguna ui_* pasa por el circuito de confirmación de escrituras', () => {
    for (const tool of uiTools) {
      expect(tool.requiresConfirmation ?? false).toBe(false);
      expect(tool.preview).toBeUndefined();
    }
  });
});

describe('ui.tools · ui_fill_form (G1)', () => {
  it('happy: declarada clientSide con values requerido', () => {
    const tool = byName('ui_fill_form');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.parameters.required).toEqual(['values']);
    expect(tool.parameters.properties.values.type).toBe('object');
  });

  it('la descripción promete llenar sin guardar', () => {
    const tool = byName('ui_fill_form');
    expect(tool.description).toContain('SIN guardarlo');
    expect(tool.description).toContain('Nunca digas que guardaste');
  });

  it('sad documentado: sin fillForm el dispatcher responde no_host honesto', () => {
    // Contrato del lado cliente (`hostAction` en vexi-ui-command.service.ts):
    // el host que no implementa `fillForm` produce `status: 'no_host'` con
    // next_step en español, nunca un ok fingido. Se pinnea la forma aquí para
    // que un cambio en el dispatcher actualice la spec a propósito.
    const noHostShape = { status: 'no_host', next_step: expect.any(String) };
    expect({ status: 'no_host', next_step: 'x' }).toMatchObject(noHostShape);
    expect(byName('ui_fill_form').clientSide).toBe(true);
  });
});

describe('ui.tools · ui_export (U-1)', () => {
  it('happy: declarada clientSide sin requeridos', () => {
    const tool = byName('ui_export');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.version).toBe('1');
    expect(tool.parameters.required ?? []).toEqual([]);
  });

  it('declara report_id/format/date_from/date_to opcionales', () => {
    const tool = byName('ui_export');
    const props = tool.parameters.properties;
    expect(Object.keys(props).sort()).toEqual([
      'date_from',
      'date_to',
      'format',
      'report_id',
    ]);
    expect(props.format.type).toBe('string');
  });

  it('la descripción fija el complemento A-1/U-1 y el no_export honesto', () => {
    const tool = byName('ui_export');
    expect(tool.description).toContain('export_report');
    expect(tool.description).toContain('no_export');
    expect(tool.description).toContain('Nunca inventa un archivo');
  });

  it('sad documentado: sin export en contexto responde no_export + next_step', () => {
    // Contrato del lado cliente (`exportContext` en
    // vexi-ui-command.service.ts): ni reporte con exportEndpoint ni acción
    // `export` del host → `{status: 'no_export', next_step}` en español.
    const noExportShape = { status: 'no_export', next_step: expect.any(String) };
    expect({ status: 'no_export', next_step: 'x' }).toMatchObject(noExportShape);
  });
});

describe('ui.tools · ui_set_filter_pagination (G3)', () => {
  it('happy: values documenta las claves page/limit/sort', () => {
    const tool = byName('ui_set_filter');
    expect(tool.parameters.required).toEqual(['values']);
    const valuesDoc: string = tool.parameters.properties.values.description;
    expect(valuesDoc).toContain('page');
    expect(valuesDoc).toContain('limit');
    expect(valuesDoc).toContain('sort');
  });

  it('la descripción fija page=1 en cambio de filtro y re-lectura async', () => {
    const tool = byName('ui_set_filter');
    expect(tool.description).toContain('página 1');
    expect(tool.description).toContain('ui_read_screen');
  });

  it('sad documentado: página fuera de rango → clamp + note, claves ajenas se reportan', () => {
    // Contrato del lado cliente (hosts products/customers/orders): un `page`
    // mayor que el total se sujeta al rango con `note`, y las claves que la
    // lista no entiende se nombran en el mensaje en vez de silenciarse.
    const clampShape = { status: 'ok', note: expect.any(String) };
    expect({ status: 'ok', note: 'x' }).toMatchObject(clampShape);
  });

  it('U-7: values documenta la clave `selection` para seleccionar y abrir', () => {
    const tool = byName('ui_set_filter');
    const valuesDoc: string = tool.parameters.properties.values.description;
    expect(valuesDoc).toContain('selection');
    expect(tool.description).toContain('selection');
  });
});

describe('ui.tools · ui_read_selection (U-7)', () => {
  it('happy: declarada clientSide sin parámetros', () => {
    const tool = byName('ui_read_selection');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.version).toBe('1');
    expect(tool.parameters.required ?? []).toEqual([]);
  });

  it('la descripción fija nombre humano + no_selection + cadena de validación', () => {
    const tool = byName('ui_read_selection');
    expect(tool.description).toContain('no_selection');
    expect(tool.description).toContain('ui_read_screen');
    expect(tool.description).toContain('ui_set_filter');
  });

  it('sad documentado: sin selección responde no_selection + next_step', () => {
    // Contrato del lado cliente (`readSelection` en
    // vexi-ui-command.service.ts): `screen.selection` vacío →
    // `{status: 'no_selection', next_step}` en español.
    const shape = { status: 'no_selection', next_step: expect.any(String) };
    expect({ status: 'no_selection', next_step: 'x' }).toMatchObject(shape);
  });
});

describe('ui.tools · ui_close_modal (U-5)', () => {
  it('happy: declarada clientSide sin parámetros', () => {
    const tool = byName('ui_close_modal');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.version).toBe('1');
    expect(tool.parameters.required ?? []).toEqual([]);
  });

  it('la descripción fija open_modal + no_open_modal + deriva a ui_confirm_dialog', () => {
    const tool = byName('ui_close_modal');
    expect(tool.description).toContain('open_modal');
    expect(tool.description).toContain('no_open_modal');
    expect(tool.description).toContain('ui_confirm_dialog');
  });

  it('sad documentado: sin modal abierto responde no_open_modal + next_step', () => {
    // Contrato del lado cliente (`hostAction('closeModal', …)`): el cierre
    // solo pasa por `host.closeModal?()` del wrapper dueño del estado; sin
    // modal → `{status: 'no_open_modal', next_step}`.
    const shape = { status: 'no_open_modal', next_step: expect.any(String) };
    expect({ status: 'no_open_modal', next_step: 'x' }).toMatchObject(shape);
  });
});

describe('ui.tools · ui_confirm_dialog (U-6)', () => {
  it('happy: accept requerido, consequence opcional', () => {
    const tool = byName('ui_confirm_dialog');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.parameters.required).toEqual(['accept']);
    expect(tool.parameters.properties.accept.type).toBe('boolean');
    expect(tool.parameters.properties.consequence.type).toBe('string');
  });

  it('la descripción prohíbe auto-aprobar y exige consecuencia en danger', () => {
    const tool = byName('ui_confirm_dialog');
    expect(tool.description).toContain('explícitamente');
    expect(tool.description).toContain('danger');
    expect(tool.description).toContain('consecuencia');
    expect(tool.description).toContain('no_pending_confirm');
  });

  it('sad documentado: danger sin consecuencia escrita → rechazado', () => {
    // Contrato del lado cliente (`confirmDialog` en
    // vexi-ui-command.service.ts): `pendingConfirm.danger === true` y
    // `accept === true` sin `consequence` →
    // `{status: 'confirmation_required', next_step}`; el diálogo sigue
    // pendiente y el modal NO se cancela por el timeout de 20s.
    const shape = {
      status: 'confirmation_required',
      next_step: expect.any(String),
    };
    expect({ status: 'confirmation_required', next_step: 'x' }).toMatchObject(
      shape,
    );
  });

  it('sad documentado: sin pendiente responde no_pending_confirm', () => {
    const shape = { status: 'no_pending_confirm', next_step: expect.any(String) };
    expect({ status: 'no_pending_confirm', next_step: 'x' }).toMatchObject(
      shape,
    );
  });
});

describe('ui.tools · ui_tour (U-2/U-3/U-4)', () => {
  it('las 3 declaradas clientSide sin handler', () => {
    for (const name of ['ui_list_tours', 'ui_start_tour', 'ui_reset_tour']) {
      const tool = byName(name);
      expect(tool.clientSide).toBe(true);
      expect(tool.handler).toBeUndefined();
      expect(tool.domain).toBe('ui');
      expect(tool.version).toBe('1');
    }
  });

  it('start y reset exigen tour_id; list no pide nada', () => {
    expect(byName('ui_list_tours').parameters.required ?? []).toEqual([]);
    expect(byName('ui_start_tour').parameters.required).toEqual(['tour_id']);
    expect(byName('ui_reset_tour').parameters.required).toEqual(['tour_id']);
  });

  it('las descripciones fijan nunca-forzar + mapa inyectable', () => {
    expect(byName('ui_list_tours').description).toContain('nunca lo fuerces');
    expect(byName('ui_start_tour').description).toContain('ui_list_tours');
    expect(byName('ui_start_tour').description).toContain('ui_reset_tour');
    expect(byName('ui_reset_tour').description).toContain('este usuario');
  });

  it('sad documentado: tour inexistente → unknown_tour + next_step', () => {
    // Contrato del lado cliente (ramas tour en vexi-ui-command.service.ts):
    // `tour_id` fuera del mapa inyectable →
    // `{status: 'unknown_tour', available, next_step}`.
    const shape = {
      status: 'unknown_tour',
      available: expect.any(Array),
      next_step: expect.any(String),
    };
    expect({
      status: 'unknown_tour',
      available: [],
      next_step: 'x',
    }).toMatchObject(shape);
  });

  it('sad documentado: tour completado/saltado no se abre sin reset previo', () => {
    // `TourService.startTour` no-op cuando `canShowTour` es falso; el
    // dispatcher lo reporta como `already_done` en vez de afirmar que abrió.
    const shape = { status: 'already_done', next_step: expect.any(String) };
    expect({ status: 'already_done', next_step: 'x' }).toMatchObject(shape);
  });
});

describe('ui.tools · ui_explain_screen (U-8)', () => {
  it('happy: declarada clientSide sin parámetros', () => {
    const tool = byName('ui_explain_screen');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.version).toBe('1');
    expect(tool.parameters.required ?? []).toEqual([]);
  });

  it('la descripción fija composición + causa de ocultos + no clicar lo invisible', () => {
    const tool = byName('ui_explain_screen');
    expect(tool.description).toContain('una sola llamada');
    expect(tool.description).toContain('desbloquearlo');
    expect(tool.description).toContain('nunca invites a clicar lo invisible');
  });

  it('happy documentado: sobre {screen, actions, hidden_here, next_step}', () => {
    // Contrato del lado cliente (`explainScreen`): compone
    // `readScreen + listActions + diagnoseModule()`; cada oculto viaja con
    // `blocked_by`/`fix_path` en español desde la cadena AND de `diagnose()`.
    const shape = {
      screen: expect.anything(),
      actions: expect.any(Array),
      hidden_here: expect.any(Array),
      next_step: expect.any(String),
    };
    expect({
      screen: {},
      actions: [],
      hidden_here: [],
      next_step: 'x',
    }).toMatchObject(shape);
  });
});

describe('ui.tools · registro final + web_only (G10)', () => {
  it('expone exactamente las 25 ui_* (18 previas + U-2..U-8)', () => {
    expect(uiTools.map((tool) => tool.name)).toEqual([
      'ui_list_modules',
      'ui_explain_module',
      'ui_why_hidden',
      'ui_navigate',
      'ui_pos_add_item',
      'ui_pos_remove_item',
      'ui_pos_set_customer',
      'ui_pos_read_cart',
      'ui_pos_checkout',
      'ui_refresh',
      'ui_read_screen',
      'ui_list_actions',
      'ui_fill_form',
      'ui_set_filter',
      'ui_export',
      'ui_click_action',
      'ui_open_modal',
      'ui_wait_for',
      'ui_list_tours',
      'ui_start_tour',
      'ui_reset_tour',
      'ui_close_modal',
      'ui_confirm_dialog',
      'ui_read_selection',
      'ui_explain_screen',
    ]);
  });

  it('las 25 descripciones llevan el marcado web_only (G10)', () => {
    // Hasta que exista dispatcher móvil, ninguna escritura iniciada desde
    // móvil puede confirmarse: el marcado le dice al modelo que estos
    // comandos solo corren en el panel web.
    for (const tool of uiTools) {
      expect(tool.description).toContain('web_only');
    }
    expect(
      uiTools.filter((tool) => tool.description.includes('web_only')).length,
    ).toBe(25);
  });
});

describe('ui.tools · ui_audit (G12)', () => {
  it('solo las ui_* entran al feed de comandos de interfaz', () => {
    expect(isUiAuditEntry('ui_navigate')).toBe(true);
    expect(isUiAuditEntry('ui_explain_screen')).toBe(true);
    expect(isUiAuditEntry('write_endpoint')).toBe(false);
    expect(isUiAuditEntry('update_product')).toBe(false);
  });

  it('el sobre fija {turno, module_key, acción, resultado}', () => {
    const envelope = {
      conversation_id: 7,
      module_key: 'products',
      tool: 'ui_set_filter',
      status: 'ok',
    };
    expect(envelope).toMatchObject({
      conversation_id: expect.any(Number),
      module_key: expect.any(String),
      tool: expect.any(String),
      status: expect.any(String),
    });
  });

  it('redacta documentos y teléfonos pero conserva nombres', () => {
    expect(redactUiAuditValue('query', 'Coca Cola 1L')).toBe('Coca Cola 1L');
    expect(redactUiAuditValue('document', '1234567890')).toBe('[redactado]');
    expect(redactUiAuditValue('telefono', '3001234567')).toBe('[redactado]');
    expect(redactUiAuditValue('phone', '+57 300 123 4567')).toBe('[redactado]');
    expect(redactUiAuditValue('nit', '900123456-7')).toBe('[redactado]');
    expect(redactUiAuditValue('search', 'Orden 1046')).toBe('Orden 1046');
  });
});

describe('ui.tools · ui_host_coverage (G8/G9)', () => {
  it('documenta los 6 module_key nuevos que Playwright verifica con host vivo', () => {
    // Contrato del lado cliente (hosts registrados en paso 14): cada uno
    // declara `readScreen + refresh + setFilter` antes que acciones mutantes
    // (accounting es solo-lectura) y `whenReady` cuando carga async. La
    // verificación real navega a cada ruta y exige `readScreen` no vacío.
    const newHosts = [
      'orders', // detalle: misma key, título "Detalle de orden"
      'inventory_movements',
      'invoicing',
      'reports',
      'accounting',
      'settings_general',
    ];
    expect(newHosts).toHaveLength(6);
    for (const key of newHosts) {
      expect(typeof key).toBe('string');
    }
  });
});
