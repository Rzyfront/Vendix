import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../../environments/environment';

/** Why an agent is on or off (T19): the plan, or the store's own switch. */
export interface AgentStatusView {
  agent_key: 'vex' | 'vexi';
  label: 'Vex' | 'Vexi';
  state: 'on' | 'off_by_plan' | 'off_by_store' | 'no_subscription';
  plan_includes: boolean;
  store_enabled: boolean;
  reason: string | null;
}

/**
 * Reads `GET /store/ai-agents/status`. Never throws: when the call fails the
 * switches keep working as before and just show no reason.
 */
@Injectable({ providedIn: 'root' })
export class AgentStatusService {
  private readonly http = inject(HttpClient);

  async load(): Promise<AgentStatusView[] | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: { agents?: AgentStatusView[] } }>(
          `${environment.apiUrl}/store/ai-agents/status`,
        ),
      );
      return res?.data?.agents ?? null;
    } catch {
      return null;
    }
  }

  async loadFor(agent: 'vex' | 'vexi'): Promise<AgentStatusView | null> {
    const agents = await this.load();
    return agents?.find((entry) => entry.agent_key === agent) ?? null;
  }
}
