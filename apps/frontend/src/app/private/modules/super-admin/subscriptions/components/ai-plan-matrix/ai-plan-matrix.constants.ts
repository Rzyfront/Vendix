/**
 * Capability switches whose runtime enforcement has not shipped yet (plan
 * odd/tasks/vex-agente-avanzado.md, section 3.11 and audit finding F4). The
 * plan screen saves them, but turning them off changes nothing today, so the
 * matrix says so next to the switch. Keyed by catalog id
 * `<agent_key>.<capability_key>`; the value is what arrives with the phase.
 * One list: remove an entry when its consumer starts enforcing the row.
 * (Per-agent voice is enforced since T14, so it is NOT listed.)
 */
export const AI_CAPABILITIES_NOT_YET_ENFORCED: Readonly<Record<string, string>> = {
  'vex.files': 'llega con la fase 6',
  'vex.code_analysis': 'llega con la fase 9',
  'vex.advanced_model': 'llega cuando exista quien lo consuma',
};

/** Engine configuration shown read-only (no editor, same for every plan). */
export const AI_ENGINE_CONFIG_LINES: readonly string[] = [
  'Cola de procesamiento (escaneo de documentos recibidos): activa.',
];
