export type VehicleType =
  | 'motorcycle'
  | 'car'
  | 'truck'
  | 'van'
  | 'bicycle'
  | 'other';

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  motorcycle: 'Motocicleta',
  car: 'Automóvil',
  truck: 'Camión',
  van: 'Furgoneta',
  bicycle: 'Bicicleta',
  other: 'Otro',
};

export const VEHICLE_TYPE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: 'motorcycle', label: VEHICLE_TYPE_LABELS.motorcycle },
  { value: 'car', label: VEHICLE_TYPE_LABELS.car },
  { value: 'truck', label: VEHICLE_TYPE_LABELS.truck },
  { value: 'van', label: VEHICLE_TYPE_LABELS.van },
  { value: 'bicycle', label: VEHICLE_TYPE_LABELS.bicycle },
  { value: 'other', label: VEHICLE_TYPE_LABELS.other },
];

export interface VehicleDriver {
  id: number;
  first_name?: string;
  last_name?: string;
}

export type SettlementType = 'none' | 'per_delivery' | 'per_route';

export const SETTLEMENT_TYPE_LABELS: Record<SettlementType, string> = {
  none: 'Sin tarifa (sueldo interno)',
  per_delivery: 'Por entrega',
  per_route: 'Por ruta cerrada',
};

export const SETTLEMENT_TYPE_OPTIONS: { value: SettlementType; label: string }[] = [
  { value: 'none', label: SETTLEMENT_TYPE_LABELS.none },
  { value: 'per_delivery', label: SETTLEMENT_TYPE_LABELS.per_delivery },
  { value: 'per_route', label: SETTLEMENT_TYPE_LABELS.per_route },
];

export interface Vehicle {
  id: number;
  store_id: number;
  plate: string;
  type: VehicleType;
  brand?: string | null;
  model_name?: string | null;
  capacity_kg?: string | number | null;
  capacity_units?: number | null;
  primary_driver_id?: number | null;
  is_active: boolean;
  notes?: string | null;
  // Plan Despacho Economía — FASE 1 paso 6.
  settlement_type?: SettlementType;
  settlement_rate?: string | number | null;
  created_by_user_id?: number | null;
  created_at?: string;
  updated_at?: string;
  primary_driver?: VehicleDriver | null;
}

export interface CreateVehicleDto {
  plate: string;
  type?: VehicleType;
  brand?: string;
  model_name?: string;
  capacity_kg?: number;
  capacity_units?: number;
  primary_driver_id?: number;
  is_active?: boolean;
  notes?: string;
  settlement_type?: SettlementType;
  settlement_rate?: number;
}

export type UpdateVehicleDto = Partial<CreateVehicleDto>;

export interface VehicleListQuery {
  page?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
}

export interface VehicleListResponse {
  data: Vehicle[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
