import { apiClient } from '@/core/api';

/**
 * Mínimo viable de confirmación Vexi en móvil (G10).
 *
 * Expone el mismo circuito propose→confirm→apply del panel web con el mismo
 * token single-use (Redis 300s + fingerprint, redeem Lua compare-and-delete):
 * una propuesta creada en cualquier superficie se aplica desde acá, y un
 * doble tap aplica exactamente una vez porque el segundo redeem falla.
 *
 * Los 25 comandos `ui_*` siguen marcados `web_only` en el servidor: no hay
 * dispatcher de interfaz en móvil, así que esta pantalla solo confirma
 * escrituras de datos, nunca opera pantallas.
 */

export interface VexiPreviewChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

export interface VexiProposalPreview {
  status: 'ok' | 'warning' | 'error';
  /** Sujeto humano del cambio: "Coca Cola 1L", no "#4821". */
  target: string;
  changes: VexiPreviewChange[];
  message?: string;
  domain?: string;
}

/** Propuesta tal como viaja en el AI_AGENT_005. */
export interface VexiConfirmationProposal {
  tool: string;
  arguments: Record<string, unknown>;
  preview: VexiProposalPreview;
  confirmation_token: string;
  conversation_id?: number;
}

export interface VexiApplyResult {
  tool: string;
  output: string;
  summary?: string | null;
}

export const VexiConfirmationService = {
  async apply(
    proposal: VexiConfirmationProposal,
  ): Promise<VexiApplyResult> {
    const response = await apiClient.post<{ data: VexiApplyResult }>(
      '/store/vexi/confirmations/apply',
      {
        tool: proposal.tool,
        arguments: proposal.arguments,
        confirmation_token: proposal.confirmation_token,
        ...(proposal.conversation_id
          ? { conversation_id: proposal.conversation_id }
          : {}),
      },
    );
    return response.data?.data;
  },
};
