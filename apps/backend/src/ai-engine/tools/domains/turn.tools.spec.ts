import { AIToolRegistry } from '../ai-tool-registry';
import { FINISH_TURN_TOOL, createTurnTools } from './turn.tools';
import { AGENT_TOOL_CORE } from '../tool-router.service';

describe('finish_turn (cierre de turno)', () => {
  const [tool] = createTurnTools();

  it('es una herramienta sin efectos que no requiere confirmación', async () => {
    expect(tool.name).toBe(FINISH_TURN_TOOL);
    expect(tool.name).toBe('finish_turn');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.readOnly).toBe(true);
    expect(tool.clientSide).toBeFalsy();
    expect(tool.irreversible).toBeFalsy();
    expect(tool.preview).toBeUndefined();
    expect(tool.compensate).toBeUndefined();
    expect(tool.access).toBe('public');
    await expect(tool.handler!({ summary: 'listo' }, {} as any)).resolves.toBe(
      JSON.stringify({ status: 'closed' }),
    );
  });

  it('no exige parámetros: summary es opcional', () => {
    expect(tool.parameters.required ?? []).toEqual([]);
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual(['summary']);
  });

  it('la descripción prohíbe usarla para anunciar algo futuro', () => {
    expect(tool.description).toBe(
      'Llama a esta herramienta SOLO cuando ya terminaste tu turno: ejecutaste lo que tenías que hacer o ya diste la respuesta completa. No la uses para anunciar algo que vas a hacer después.',
    );
  });

  it('se registra en el registro y queda disponible sin permisos especiales', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createTurnTools());
    expect(registry.get(FINISH_TURN_TOOL)?.name).toBe(FINISH_TURN_TOOL);
    expect(
      registry.getAvailableDefinitions([]).map((d) => d.function.name),
    ).toContain(FINISH_TURN_TOOL);
  });

  it('está en el núcleo fijo de Vex y de Vexi', () => {
    expect(AGENT_TOOL_CORE.vex).toContain(FINISH_TURN_TOOL);
    expect(AGENT_TOOL_CORE.vexi).toContain(FINISH_TURN_TOOL);
  });
});
