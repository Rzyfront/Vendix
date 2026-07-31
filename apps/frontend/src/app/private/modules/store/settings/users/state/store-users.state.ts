import { StoreUser, StoreUserStats, StoreUserDetail, Role } from '../interfaces/store-user.interface';

export interface StoreUsersState {
  users: StoreUser[];
  /**
   * Carga de la LISTA (`loadUsers`). Gobierna el spinner que sustituye la tabla,
   * así que sólo las lecturas de lista pueden moverlo.
   */
  users_loading: boolean;
  /**
   * QUI-554 — Progreso de una MUTACIÓN (crear / actualizar / desactivar /
   * reactivar). Vive separado de `users_loading` porque una mutación no debe
   * desmontar la tabla: antes, crear un usuario ponía `users_loading: true` y
   * dejaba la lista en "Cargando usuarios..." detrás del modal.
   */
  user_saving: boolean;
  stats: StoreUserStats | null;
  stats_loading: boolean;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;
  error: string | null;

  // Filters
  search: string;
  page: number;
  limit: number;
  state_filter: string;

  // Detail
  selected_user_detail: StoreUserDetail | null;
  detail_loading: boolean;
  available_roles: Role[];
}

export const initialStoreUsersState: StoreUsersState = {
  users: [],
  users_loading: false,
  user_saving: false,
  stats: null,
  stats_loading: false,
  meta: null,
  error: null,

  search: '',
  page: 1,
  limit: 10,
  state_filter: '',

  selected_user_detail: null,
  detail_loading: false,
  available_roles: [],
};
