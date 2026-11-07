/** Row of `GET store/workflows/secrets`. The value is never part of it. */
export interface WorkflowSecretRow {
  id: number;
  name: string;
  description: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkflowSecretBody {
  name: string;
  value: string;
  description?: string;
}

/** `PUT store/workflows/secrets/:id`: only what changes. */
export interface UpdateWorkflowSecretBody {
  value?: string;
  description?: string;
}

/** A flow that still uses a secret (details of the 409 on delete). */
export interface WorkflowSecretUse {
  key: string;
  name: string;
}
