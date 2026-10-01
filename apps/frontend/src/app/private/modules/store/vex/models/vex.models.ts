export type VexMessageRole = 'user' | 'agent';

export interface VexMessage {
  id: string;
  role: VexMessageRole;
  content: string;
  created_at: Date;
}

export interface VexConversation {
  id: string;
  title: string;
  messages: VexMessage[];
  created_at: Date;
  updated_at: Date;
}

export type VexLogCategory = 'sale' | 'inventory' | 'cash' | 'alert' | 'agent';

export interface VexLogEvent {
  id: string;
  category: VexLogCategory;
  title: string;
  description: string;
  created_at: Date;
  is_new: boolean;
}

export interface VexModelOption {
  id: string;
  label: string;
}

export const VEX_MODEL_OPTIONS: VexModelOption[] = [
  { id: 'vex-flash', label: 'Flash' },
  { id: 'vex-pro', label: 'Pro' },
];

export const VEX_LOG_CATEGORY_META: Record<
  VexLogCategory,
  { label: string; icon: string }
> = {
  sale: { label: 'Ventas', icon: 'shopping-cart' },
  inventory: { label: 'Inventario', icon: 'package' },
  cash: { label: 'Caja', icon: 'wallet' },
  alert: { label: 'Alertas', icon: 'bell' },
  agent: { label: 'Vex', icon: 'sparkles' },
};
