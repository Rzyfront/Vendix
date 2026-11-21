export type StoreMemoryKind = 'preference' | 'fact';
export type StoreMemoryOrigin = 'agent' | 'manual';

export interface StoreMemoryActor {
  id: number;
  name: string;
}

export interface StoreMemoryItem {
  id: number;
  key: string;
  content: string;
  kind: StoreMemoryKind;
  origin: StoreMemoryOrigin;
  created_by: StoreMemoryActor | null;
  updated_by: StoreMemoryActor | null;
  source_conversation_id: number | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreMemoryLimits {
  max_entries: number;
  max_chars: number;
  used_entries: number;
  used_chars: number;
}

export interface StoreMemoryList {
  items: StoreMemoryItem[];
  limits: StoreMemoryLimits;
}

export interface CreateStoreMemoryPayload {
  content: string;
  key?: string;
  kind?: StoreMemoryKind;
}
