import { RegisteredTool } from '../interfaces/tool.interface';
import { VexiContextService } from '../../../domains/store/vexi/vexi-context.service';

export interface BusinessToolDeps {
  vexiContext: VexiContextService;
}

/**
 * The same snapshot that gets interpolated into Vexi's system prompt, exposed
 * as callable tools.
 *
 * Redundant only in appearance: the prompt copy is a point-in-time render from
 * the start of the turn, and a long agentic conversation drifts away from it —
 * the user changes something, or simply asks about a section the model has
 * since paraphrased away. These let the model re-read the ground truth instead
 * of reconstructing it from memory, which is where invented figures come from.
 */
export function createBusinessTools({
  vexiContext,
}: BusinessToolDeps): RegisteredTool[] {
  return [
    {
      name: 'get_store_profile',
      domain: 'business',
      readOnly: true,
      description:
        'Devuelve la identidad del comercio: nombre, organización, industrias, tipo de tienda, moneda y zona horaria. Úsala cuando necesites saber en qué negocio estás operando o cuando el usuario pregunte por la configuración de su tienda.',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const snapshot = await vexiContext.buildSnapshot();
        return JSON.stringify({
          store_profile: snapshot.store_profile,
          current_datetime: snapshot.current_datetime,
        });
      },
    },
    {
      name: 'get_business_snapshot',
      domain: 'business',
      readOnly: true,
      description:
        'Resumen completo del estado del comercio: identidad, métricas del último corte semanal cerrado, módulos habilitados y estado de la suscripción. Úsala para preguntas amplias del tipo "¿cómo va el negocio?". Ojo: las métricas son del último corte semanal, NO del día de hoy — para cifras de hoy usa las herramientas de ventas u órdenes.',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const snapshot = await vexiContext.buildSnapshot();
        return JSON.stringify(snapshot);
      },
    },
  ];
}
