import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Modal as RNModal,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { OrgUsersService } from '@/features/org/services/org-users.service';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import { OrgRolesService } from '@/features/org/services/org-roles.service';
import type { OrgUser, InviteUserInput, UpdateUserInput, UserState } from '@/core/models/org-admin/users.types';
import { unwrapList } from '@/core/api/http';

import {
  SearchBar,
  ConfirmDialog,
  toastSuccess,
  toastError,
  EmptyState,
  StatsGrid,
  Badge,
  Modal,
  Button,
  Input,
} from '@/shared/components';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius, interFonts } from '@/shared/theme';

// ─── Constants ──────────────────────────────────────────────────────────────
const USER_STATE_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  INVITED: 'Invitado',
  SUSPENDED: 'Suspendido',
  DISABLED: 'Desactivado',
};

const USER_STATE_COLORS: Record<string, string> = {
  ACTIVE: colors.success,
  INVITED: colorScales.amber[500],
  SUSPENDED: colors.error,
  DISABLED: colorScales.gray[400],
};

const FILTER_STATE_OPTIONS = [
  { value: '', label: 'Todos los Estados' },
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INVITED', label: 'Invitado' },
  { value: 'SUSPENDED', label: 'Suspendido' },
  { value: 'DISABLED', label: 'Desactivado' },
];

const FORM_STATE_OPTIONS = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INVITED', label: 'Invitado' },
  { value: 'SUSPENDED', label: 'Suspendido' },
  { value: 'DISABLED', label: 'Desactivado' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateString?: string): string {
  if (!dateString) return 'Nunca';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return 'N/A';
  }
}

// ─── Option Picker Modal (Bottom-sheet style selector) ──────────────────────────
interface Option {
  value: string;
  label: string;
}

function OptionPickerModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Option[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={pickerStyles.backdrop} onPress={onClose}>
        <Pressable style={pickerStyles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={pickerStyles.handle} />
          <Text style={pickerStyles.title}>{title}</Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {options.map((opt) => {
              const isActive = selected === opt.value;
              return (
                <Pressable
                  key={opt.value || 'all'}
                  style={({ pressed }) => [
                    pickerStyles.row,
                    isActive && pickerStyles.rowActive,
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => {
                    onSelect(opt.value);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      pickerStyles.rowLabel,
                      isActive && pickerStyles.rowLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {isActive && <Icon name="check" size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[6],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colorScales.gray[300],
    alignSelf: 'center',
    marginBottom: spacing[3],
  },
  title: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    marginBottom: spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.md,
    marginBottom: 2,
  },
  rowActive: {
    backgroundColor: colorScales.green[50],
  },
  rowLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[700],
  },
  rowLabelActive: {
    color: colors.primary,
    fontFamily: interFonts.semibold,
  },
});

// ─── User Detail Card Component ───────────────────────────────────────────────
function UserCard({
  user,
  onEdit,
  onDelete,
  rolesList,
  storesList,
}: {
  user: OrgUser;
  onEdit: () => void;
  onDelete: () => void;
  rolesList: any[];
  storesList: any[];
}) {
  const stateLabel = USER_STATE_LABELS[user.state] || user.state;
  
  const { data: config } = useQuery({
    queryKey: ['user-config', user.id],
    queryFn: () => OrgUsersService.getConfiguration(user.id),
  });

  const mainRole = useMemo(() => {
    if (!config?.roles || config.roles.length === 0) return 'N/A';
    const roleId = config.roles[0];
    return rolesList?.find((r) => Number(r.value) === Number(roleId))?.label || 'N/A';
  }, [config, rolesList]);

  const mainStore = useMemo(() => {
    if (!config?.store_ids || config.store_ids.length === 0) return 'Organización';
    const storeId = config.store_ids[0];
    return storesList?.find((s) => Number(s.value) === Number(storeId))?.label || 'Organización';
  }, [config, storesList]);

  const initials = `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || '?';

  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.body}>
        {/* Avatar */}
        <View style={[cardStyles.avatar, { backgroundColor: user.state === 'ACTIVE' ? '#dcfce7' : colorScales.gray[100] }]}>
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={cardStyles.avatarImage} />
          ) : (
            <Text style={[cardStyles.avatarText, { color: user.state === 'ACTIVE' ? '#047857' : colorScales.gray[600] }]}>
              {initials}
            </Text>
          )}
        </View>

        {/* Main Content */}
        <View style={cardStyles.mainContent}>
          <View style={cardStyles.titleRow}>
            <View style={cardStyles.titleGroup}>
              <Text style={cardStyles.title} numberOfLines={1}>
                {user.first_name} {user.last_name}
              </Text>
              <Text style={cardStyles.subtitle} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
            {/* Status Badge */}
            <View
              style={[
                cardStyles.statusBadge,
                user.state === 'ACTIVE'
                  ? cardStyles.statusActive
                  : user.state === 'INVITED'
                  ? cardStyles.statusInvited
                  : cardStyles.statusSuspended,
              ]}
            >
              <Text
                style={[
                  cardStyles.statusText,
                  user.state === 'ACTIVE'
                    ? cardStyles.statusTextActive
                    : user.state === 'INVITED'
                    ? cardStyles.statusTextInvited
                    : cardStyles.statusTextSuspended,
                ]}
              >
                {stateLabel}
              </Text>
            </View>
          </View>

          {/* Details Grid */}
          <View style={cardStyles.detailGrid}>
            <View style={cardStyles.detailItem}>
              <Text style={cardStyles.detailLabel}>USUARIO</Text>
              <Text style={cardStyles.detailValue} numberOfLines={1}>
                {user.username}
              </Text>
            </View>
            <View style={cardStyles.detailItem}>
              <Text style={cardStyles.detailLabel}>TIENDA PRINCIPAL</Text>
              <Text style={cardStyles.detailValue} numberOfLines={1}>
                {mainStore}
              </Text>
            </View>
            <View style={cardStyles.detailItem}>
              <Text style={cardStyles.detailLabel}>CREADO</Text>
              <Text style={cardStyles.detailValue} numberOfLines={1}>
                {formatDate(user.created_at)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Card Actions Footer */}
      <View style={cardStyles.footer}>
        <View style={cardStyles.footerSpacer} />
        <View style={cardStyles.footerActions}>
          {/* Edit */}
          <Pressable
            style={({ pressed }) => [cardStyles.actionBtn, cardStyles.actionInfo, pressed && { opacity: 0.75 }]}
            onPress={onEdit}
            hitSlop={4}
          >
            <Icon name="edit" size={16} color="#3b82f6" />
          </Pressable>

          {/* Action contextual según estado:
              ACTIVE/INVITED → "Suspender" (warning)
              SUSPENDED       → "Reactivar" (success)
              DISABLED        → "Eliminar"   (danger, destructive) */}
          <Pressable
            style={({ pressed }) => {
              const base = cardStyles.actionBtn;
              if (user.state === 'DISABLED') {
                return [base, cardStyles.actionDanger, pressed && { opacity: 0.75 }];
              }
              if (user.state === 'SUSPENDED') {
                return [base, cardStyles.actionSuccess, pressed && { opacity: 0.75 }];
              }
              return [base, cardStyles.actionWarning, pressed && { opacity: 0.75 }];
            }}
            onPress={onDelete}
            hitSlop={4}
            accessibilityLabel={
              user.state === 'DISABLED'
                ? `Eliminar a ${user.first_name}`
                : user.state === 'SUSPENDED'
                  ? `Reactivar a ${user.first_name}`
                  : `Suspender a ${user.first_name}`
            }
          >
            <Icon
              name={
                user.state === 'DISABLED'
                  ? 'trash-2'
                  : user.state === 'SUSPENDED'
                    ? 'check-circle'
                    : 'user-x'
              }
              size={16}
              color={
                user.state === 'DISABLED'
                  ? '#ef4444'
                  : user.state === 'SUSPENDED'
                    ? '#22c55e'
                    : '#f59e0b'
              }
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 16,
  },
  body: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarText: {
    fontSize: 14,
    fontFamily: interFonts.bold,
  },
  mainContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  title: {
    fontSize: 14,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    fontFamily: interFonts.regular,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    borderWidth: 1,
    marginLeft: 8,
    flexShrink: 0,
  },
  statusActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  statusInvited: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  statusSuspended: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  statusText: {
    fontSize: 10,
    fontFamily: interFonts.medium,
  },
  statusTextActive: { color: '#047857' },
  statusTextInvited: { color: '#b45309' },
  statusTextSuspended: { color: '#b91c1c' },

  detailGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  detailItem: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
  },
  detailLabel: {
    fontSize: 8,
    fontFamily: interFonts.bold,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 12,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  footerSpacer: { flex: 1 },
  footerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  actionInfo: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  actionWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  actionSuccess: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  actionKey: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
  },
  actionDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
});

// ─── Invite User Modal Component (web `app-invite-user-modal` parity) ─────────
// Espejo EXACTO del `InviteUserModalComponent` web:
//   - title "Invitar Usuario"
//   - subtitle "Enviar invitación por email para crear una cuenta"
//   - descripción del flujo en el body
//   - campos: Nombre, Apellido, Email, Aplicación (select)
//   - footer: Cancelar + Enviar Invitación
//
// Diferencias intencionales vs el UserFormModal:
//   - NO pide teléfono/rol/tienda aquí — la web tampoco. Esos se configuran
//     después de que el usuario acepta la invitación (en la edición).
//   - El campo Aplicación es explícito en la web (el usuario lo escoge),
//     mientras el UserFormModal lo infiere del rol. Aquí respetamos la web.
const APP_OPTIONS = [
  { value: 'ORG_ADMIN', label: 'ORG_ADMIN' },
  { value: 'STORE_ADMIN', label: 'STORE_ADMIN' },
  { value: 'STORE_ECOMMERCE', label: 'STORE_ECOMMERCE' },
] as const;

function InviteUserModal({
  visible,
  onClose,
  onSubmit,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: { first_name: string; last_name: string; email: string; app: string }) => void;
  loading: boolean;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [app, setApp] = useState<string>('ORG_ADMIN');

  // Reset al reabrir
  useMemo(() => {
    if (visible) {
      setFirstName('');
      setLastName('');
      setEmail('');
      setApp('ORG_ADMIN');
    }
  }, [visible]);

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toastError('Por favor completa los campos obligatorios (*).');
      return;
    }
    onSubmit({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim().toLowerCase(),
      app,
    });
  };

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Invitar Usuario"
      subtitle="Enviar invitación por email para crear una cuenta"
      size="md"
      footer={
        <View style={inviteStyles.footer}>
          <Pressable
            style={({ pressed }) => [inviteStyles.cancelBtn, pressed && { opacity: 0.75 }]}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={inviteStyles.cancelBtnText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              inviteStyles.submitBtn,
              (loading || !firstName.trim() || !lastName.trim() || !email.trim()) && inviteStyles.submitBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleSubmit}
            disabled={loading || !firstName.trim() || !lastName.trim() || !email.trim()}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={inviteStyles.submitBtnText}>Enviar Invitación</Text>
            )}
          </Pressable>
        </View>
      }
    >
      <View style={inviteStyles.body}>
        <Text style={inviteStyles.description}>
          Se enviará un correo de invitación al usuario. El usuario deberá
          completar su registro haciendo clic en el enlace.
        </Text>

        <View style={inviteStyles.fieldGroup}>
          <Text style={inviteStyles.fieldLabel}>Nombre *</Text>
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Juan"
            placeholderTextColor={colorScales.gray[400]}
            editable={!loading}
            style={inviteStyles.input}
          />
        </View>

        <View style={inviteStyles.fieldGroup}>
          <Text style={inviteStyles.fieldLabel}>Apellido *</Text>
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder="Pérez"
            placeholderTextColor={colorScales.gray[400]}
            editable={!loading}
            style={inviteStyles.input}
          />
        </View>

        <View style={inviteStyles.fieldGroup}>
          <Text style={inviteStyles.fieldLabel}>Email *</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="juan@ejemplo.com"
            placeholderTextColor={colorScales.gray[400]}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!loading}
            style={inviteStyles.input}
          />
        </View>

        <View style={inviteStyles.fieldGroup}>
          <Text style={inviteStyles.fieldLabel}>Aplicación</Text>
          <View style={inviteStyles.selectList}>
            {APP_OPTIONS.map((opt, idx) => {
              const isActive = app === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  style={({ pressed }) => [
                    inviteStyles.selectRow,
                    idx > 0 && inviteStyles.selectRowBorder,
                    isActive && inviteStyles.selectRowActive,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => setApp(opt.value)}
                  disabled={loading}
                >
                  <Text
                    style={[
                      inviteStyles.selectRowText,
                      isActive && inviteStyles.selectRowTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {isActive ? <Icon name="check" size={14} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </OrgCenteredModal>
  );
}

const inviteStyles = StyleSheet.create({
  body: {
    gap: spacing[4],
  },
  // Espejo del `<p class="text-sm text-[var(--color-text-secondary)]">` web.
  description: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    lineHeight: 20,
  },
  fieldGroup: {
    gap: spacing[2],
  },
  fieldLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.medium,
    color: colorScales.gray[700],
  },
  // Espejo del `<app-input>` web moderno (var(--color-surface), 8px radius,
  // border, focus ring primary). En mobile usamos el patrón equivalente
  // para inputs del `UserFormModal`.
  input: {
    height: 44,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[900],
  },
  selectList: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  selectRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  selectRowActive: {
    backgroundColor: colorScales.green[50],
  },
  selectRowText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.medium,
    color: colorScales.gray[700],
  },
  selectRowTextActive: {
    color: colors.primary,
    fontFamily: interFonts.semibold,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
  },
  cancelBtn: {
    height: 40,
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
  },
  cancelBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
  },
  submitBtn: {
    height: 40,
    paddingHorizontal: spacing[5],
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: '#FFFFFF',
  },
});

// ─── Edit User Modal (web `app-user-edit-modal` parity) ──────────────────────
// Espejo del `UserEditModalComponent` web:
//   - title "Editar Usuario"
//   - subtitle "Actualiza la información del usuario seleccionado"
//   - size="lg" (720px max)
//   - 2-column grid para los campos principales
//   - footer Cancelar + Actualizar Usuario
//
// El web tiene 2 modales separados (edit + config). Mobile consolida todo
// en este modal: primero los datos del perfil, luego una sección
// "Configuración" con Rol/Tienda (los mobile-dev puede separar a futuro
// si crece).
const EDIT_DOCUMENT_TYPES = [
  { value: '', label: 'Seleccionar' },
  { value: 'CC', label: 'Cédula de Ciudadanía' },
  { value: 'CE', label: 'Cédula de Extranjería' },
  { value: 'PASSPORT', label: 'Pasaporte' },
  { value: 'NIT', label: 'NIT' },
  { value: 'OTHER', label: 'Otro' },
] as const;

function EditUserModal({
  visible,
  onClose,
  onSubmit,
  user,
  rolesList,
  storesList,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: UpdateUserInput) => void;
  user: OrgUser | null;
  rolesList: Option[];
  storesList: Option[];
  loading: boolean;
}) {
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [selectedRole, setSelectedRole] = useState(user?.roles?.[0] || '');
  const [selectedStore, setSelectedStore] = useState(user?.default_store_id || '');
  const [selectedState, setSelectedState] = useState<UserState>(user?.state || 'ACTIVE');

  // Cargar la configuración (rol + tienda) cuando se abre el modal
  const { data: config } = useQuery({
    queryKey: ['user-config', user?.id],
    queryFn: () => OrgUsersService.getConfiguration(user!.id),
    enabled: !!user?.id && visible,
  });

  // Sincronizar form cuando cambia el user o la config
  useMemo(() => {
    if (user) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name || '');
      setPhone(user.phone || '');
      setSelectedState(user.state || 'ACTIVE');
      if (config) {
        setSelectedRole(config.roles?.[0] ? String(config.roles[0]) : '');
        setSelectedStore(config.store_ids?.[0] ? String(config.store_ids[0]) : '');
      }
    }
  }, [user, config]);

  const [pickerOpen, setPickerOpen] = useState<'role' | 'store' | 'state' | null>(null);

  const handleSave = () => {
    if (!firstName.trim() || !lastName.trim() || !selectedRole) {
      toastError('Por favor completa los campos obligatorios (*).');
      return;
    }
    onSubmit({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || undefined,
      roles: [selectedRole],
      default_store_id: selectedStore || null,
      state: selectedState,
    });
  };

  const selectedStoreLabel = storesList.find((s) => s.value === selectedStore)?.label || 'Ninguna (Organización)';
  const selectedRoleLabel = rolesList.find((r) => r.value === selectedRole)?.label || 'Seleccionar Rol *';
  const selectedStateLabel = USER_STATE_LABELS[selectedState] || selectedState;
  const fullName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : '';

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Editar Usuario"
      subtitle="Actualiza la información del usuario seleccionado"
      size="lg"
      footer={
        <View style={editStyles.footer}>
          <Pressable
            style={({ pressed }) => [editStyles.cancelBtn, pressed && { opacity: 0.75 }]}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={editStyles.cancelBtnText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              editStyles.submitBtn,
              (loading || !firstName.trim() || !lastName.trim() || !selectedRole) && editStyles.submitBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleSave}
            disabled={loading || !firstName.trim() || !lastName.trim() || !selectedRole}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={editStyles.submitBtnText}>Actualizar Usuario</Text>
            )}
          </Pressable>
        </View>
      }
    >
      <ScrollView
        style={editStyles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={editStyles.body}>
          {/* Espejo del `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">` web:
              2 columnas en pantallas >= md (720px), 1 columna en mobile. */}
          <View style={editStyles.grid}>
            <View style={editStyles.gridItem}>
              <Text style={editStyles.fieldLabel}>Nombre *</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Juan"
                placeholderTextColor={colorScales.gray[400]}
                editable={!loading}
                style={editStyles.input}
              />
            </View>

            <View style={editStyles.gridItem}>
              <Text style={editStyles.fieldLabel}>Apellido *</Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Pérez"
                placeholderTextColor={colorScales.gray[400]}
                editable={!loading}
                style={editStyles.input}
              />
            </View>

            {/* Username — read-only (espejo del web `[disabled]="true"`) */}
            <View style={editStyles.gridItem}>
              <Text style={editStyles.fieldLabel}>Nombre de Usuario</Text>
              <TextInput
                value={user?.username || ''}
                editable={false}
                style={[editStyles.input, editStyles.inputDisabled]}
              />
              <Text style={editStyles.fieldHint}>
                El nombre de usuario no es editable.
              </Text>
            </View>

            {/* Email — read-only (espejo del web `[disabled]="true"`) */}
            <View style={editStyles.gridItem}>
              <Text style={editStyles.fieldLabel}>Email</Text>
              <TextInput
                value={user?.email || ''}
                editable={false}
                style={[editStyles.input, editStyles.inputDisabled]}
              />
            </View>

            <View style={editStyles.gridItem}>
              <Text style={editStyles.fieldLabel}>Teléfono</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+57 300 123 4567"
                placeholderTextColor={colorScales.gray[400]}
                keyboardType="phone-pad"
                editable={!loading}
                style={editStyles.input}
              />
            </View>

            {/* Estado — select (espejo del `<select formControlName="state">` web) */}
            <View style={editStyles.gridItem}>
              <Text style={editStyles.fieldLabel}>Estado</Text>
              <Pressable
                style={({ pressed }) => [
                  editStyles.selectTrigger,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setPickerOpen('state')}
                disabled={loading}
              >
                <Text style={editStyles.selectTriggerText}>{selectedStateLabel}</Text>
                <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
              </Pressable>
            </View>
          </View>

          {/* ─── Sección Configuración (mobile-specific, web la tiene en modal aparte) ── */}
          <View style={editStyles.configSection}>
            <View style={editStyles.configSectionHeader}>
              <Icon name="settings" size={14} color={colorScales.gray[500]} />
              <Text style={editStyles.configSectionTitle}>Configuración de Acceso</Text>
            </View>

            <View style={editStyles.grid}>
              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Rol de Acceso *</Text>
                <Pressable
                  style={({ pressed }) => [
                    editStyles.selectTrigger,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => setPickerOpen('role')}
                  disabled={loading}
                >
                  <Text style={[editStyles.selectTriggerText, !selectedRole && { color: colorScales.gray[400] }]}>
                    {selectedRoleLabel}
                  </Text>
                  <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Tienda Principal</Text>
                <Pressable
                  style={({ pressed }) => [
                    editStyles.selectTrigger,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => setPickerOpen('store')}
                  disabled={loading}
                >
                  <Text style={editStyles.selectTriggerText}>{selectedStoreLabel}</Text>
                  <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                </Pressable>
              </View>
            </View>
          </View>

          {/* ─── User Info card (espejo del bloque `<div class="mt-6 p-4 bg-gray-50 ...">` web) ── */}
          {user ? (
            <View style={editStyles.infoCard}>
              <Text style={editStyles.infoCardTitle}>Información del Usuario</Text>
              <View style={editStyles.infoGrid}>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>ID</Text>
                  <Text style={editStyles.infoValue}>{user.id}</Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Creado</Text>
                  <Text style={editStyles.infoValue}>{formatDate(user.created_at)}</Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Email Verificado</Text>
                  <Text
                    style={[
                      editStyles.infoValue,
                      { color: user.email_verified ? colorScales.green[600] : colorScales.amber[600] },
                    ]}
                  >
                    {user.email_verified ? 'Sí' : 'No'}
                  </Text>
                </View>
                {fullName ? (
                  <View style={editStyles.infoItem}>
                    <Text style={editStyles.infoLabel}>Nombre Completo</Text>
                    <Text style={editStyles.infoValue}>{fullName}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Option Pickers */}
      <OptionPickerModal
        visible={pickerOpen === 'role'}
        title="Seleccionar Rol"
        options={rolesList}
        selected={selectedRole}
        onSelect={setSelectedRole}
        onClose={() => setPickerOpen(null)}
      />
      <OptionPickerModal
        visible={pickerOpen === 'store'}
        title="Seleccionar Tienda Principal"
        options={[{ value: '', label: 'Ninguna (Organización)' }, ...storesList]}
        selected={selectedStore}
        onSelect={setSelectedStore}
        onClose={() => setPickerOpen(null)}
      />
      <OptionPickerModal
        visible={pickerOpen === 'state'}
        title="Seleccionar Estado"
        options={FORM_STATE_OPTIONS}
        selected={selectedState}
        onSelect={(val) => setSelectedState(val as UserState)}
        onClose={() => setPickerOpen(null)}
      />
    </OrgCenteredModal>
  );
}

const editStyles = StyleSheet.create({
  scroll: {
    maxHeight: 520,
  },
  body: {
    gap: spacing[4],
  },
  // Espejo del `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">` web.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[4],
  },
  gridItem: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 220,
    gap: spacing[2],
  },
  fieldLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.medium,
    color: colorScales.gray[700],
  },
  // Espejo del `<app-input>` web (var(--color-surface), 8px radius,
  // border, focus ring primary).
  input: {
    height: 44,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[900],
  },
  inputDisabled: {
    backgroundColor: colorScales.gray[50],
    color: colorScales.gray[500],
  },
  fieldHint: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
  },
  selectTriggerText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[900],
  },
  // ─── Configuración section ───────────────────────────────────────
  configSection: {
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  configSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  configSectionTitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  // ─── User Info card (espejo del bloque bg-gray-50 web) ───────────
  infoCard: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    padding: spacing[4],
    gap: spacing[3],
  },
  infoCardTitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  infoItem: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 180,
    flexDirection: 'row',
    gap: spacing[2],
  },
  infoLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.medium,
    color: colorScales.gray[500],
  },
  infoValue: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  // ─── Footer (espejo del `<div class="flex justify-end gap-3">` web)
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
  },
  cancelBtn: {
    height: 40,
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
  },
  cancelBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
  },
  submitBtn: {
    height: 40,
    paddingHorizontal: spacing[5],
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: '#FFFFFF',
  },
});

// ─── Modal Form Component (Combined Invite / Edit) ───────────────────────────
function UserFormModal({
  visible,
  onClose,
  onSubmit,
  user,
  rolesList,
  storesList,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: InviteUserInput | UpdateUserInput) => void;
  user?: OrgUser | null;
  rolesList: Option[];
  storesList: Option[];
  loading: boolean;
}) {
  const isEdit = !!user;
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [selectedRole, setSelectedRole] = useState(user?.roles?.[0] || '');
  const [selectedStore, setSelectedStore] = useState(user?.default_store_id || '');
  const [selectedState, setSelectedState] = useState(user?.state || 'INVITED');

  const [pickerOpen, setPickerOpen] = useState<'role' | 'store' | 'state' | null>(null);

  const { data: config } = useQuery({
    queryKey: ['user-config', user?.id],
    queryFn: () => OrgUsersService.getConfiguration(user!.id),
    enabled: !!user?.id,
  });

  // Sync state if user or configuration changes
  useMemo(() => {
    setFirstName(user?.first_name || '');
    setLastName(user?.last_name || '');
    setEmail(user?.email || '');
    setPhone(user?.phone || '');
    if (user) {
      setSelectedState(user.state || 'ACTIVE');
      if (config) {
        setSelectedRole(config.roles?.[0] ? String(config.roles[0]) : '');
        setSelectedStore(config.store_ids?.[0] ? String(config.store_ids[0]) : '');
      } else {
        setSelectedRole('');
        setSelectedStore('');
      }
    } else {
      setSelectedRole('');
      setSelectedStore('');
      setSelectedState('INVITED');
    }
  }, [user, config]);

  const handleSave = () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !selectedRole) {
      toastError('Por favor completa los campos obligatorios (*).');
      return;
    }

    if (isEdit) {
      const updateData: UpdateUserInput = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || undefined,
        roles: [selectedRole],
        default_store_id: selectedStore || null,
        state: selectedState as UserState,
      };
      onSubmit(updateData);
    } else {
      const inviteData: InviteUserInput = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        roles: [selectedRole],
        default_store_id: selectedStore || undefined,
      };
      onSubmit(inviteData);
    }
  };

  const selectedStoreLabel = storesList.find((s) => s.value === selectedStore)?.label || 'Ninguna (Organización)';
  const selectedRoleLabel = rolesList.find((r) => r.value === selectedRole)?.label || 'Seleccionar Rol *';
  const selectedStateLabel = USER_STATE_LABELS[selectedState] || selectedState;

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={isEdit ? 'Editar Usuario' : 'Invitar Usuario'}
      showFooter
      footer={
        <View style={formStyles.footerContainer}>
          <Button title="Cancelar" variant="secondary" onPress={onClose} disabled={loading} style={formStyles.footerBtn} />
          <Button
            title={isEdit ? 'Guardar Cambios' : 'Enviar Invitación'}
            variant="primary"
            onPress={handleSave}
            loading={loading}
            disabled={loading || !firstName.trim() || !lastName.trim() || !email.trim() || !selectedRole}
            style={formStyles.footerBtn}
          />
        </View>
      }
    >
      <View style={formStyles.container}>
        <Input
          label="Nombre *"
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Ej: Juan"
          autoFocus={!isEdit}
        />
        <Input
          label="Apellido *"
          value={lastName}
          onChangeText={setLastName}
          placeholder="Ej: Pérez"
        />
        <Input
          label="Email *"
          value={email}
          onChangeText={setEmail}
          placeholder="Ej: juan@ejemplo.com"
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!isEdit}
          helperText={isEdit ? 'El email de registro no es editable.' : undefined}
        />
        <Input
          label="Teléfono"
          value={phone}
          onChangeText={setPhone}
          placeholder="Ej: +57 300 123 4567"
          keyboardType="phone-pad"
        />

        {/* Roles Select Trigger */}
        <View style={formStyles.selectWrapper}>
          <Text style={formStyles.selectLabel}>ROL DE ACCESO *</Text>
          <Pressable style={formStyles.selectTrigger} onPress={() => setPickerOpen('role')}>
            <Text style={[formStyles.selectText, !selectedRole && { color: colors.text.muted }]}>
              {selectedRoleLabel}
            </Text>
            <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
          </Pressable>
        </View>

        {/* Stores Select Trigger */}
        <View style={formStyles.selectWrapper}>
          <Text style={formStyles.selectLabel}>TIENDA PRINCIPAL</Text>
          <Pressable style={formStyles.selectTrigger} onPress={() => setPickerOpen('store')}>
            <Text style={formStyles.selectText}>{selectedStoreLabel}</Text>
            <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
          </Pressable>
        </View>

        {/* Status Select Trigger (Edit Mode Only) */}
        {isEdit && (
          <View style={formStyles.selectWrapper}>
            <Text style={formStyles.selectLabel}>ESTADO DE LA CUENTA</Text>
            <Pressable style={formStyles.selectTrigger} onPress={() => setPickerOpen('state')}>
              <Text style={formStyles.selectText}>{selectedStateLabel}</Text>
              <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
            </Pressable>
          </View>
        )}
      </View>

      {/* Option Pickers */}
      <OptionPickerModal
        visible={pickerOpen === 'role'}
        title="Seleccionar Rol"
        options={rolesList}
        selected={selectedRole}
        onSelect={setSelectedRole}
        onClose={() => setPickerOpen(null)}
      />
      <OptionPickerModal
        visible={pickerOpen === 'store'}
        title="Seleccionar Tienda Principal"
        options={[{ value: '', label: 'Ninguna (Organización)' }, ...storesList]}
        selected={selectedStore}
        onSelect={setSelectedStore}
        onClose={() => setPickerOpen(null)}
      />
      <OptionPickerModal
        visible={pickerOpen === 'state'}
        title="Seleccionar Estado"
        options={FORM_STATE_OPTIONS}
        selected={selectedState}
        onSelect={(val) => setSelectedState(val as UserState)}
        onClose={() => setPickerOpen(null)}
      />
    </Modal>
  );
}

const formStyles = StyleSheet.create({
  container: {
    padding: spacing[4],
    gap: spacing[4],
  },
  footerContainer: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  footerBtn: {
    flex: 1,
  },
  selectWrapper: {
    width: '100%',
  },
  selectLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
    marginBottom: spacing[1.5],
    letterSpacing: 1.5,
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBg,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.inputBorder,
    height: 48,
  },
  selectText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
  },
});

// ─── Reset Password Modal Component ───────────────────────────────────────────
function UserResetPasswordModal({
  visible,
  onClose,
  onSubmit,
  user,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (body: any) => void;
  user: OrgUser | null;
  loading: boolean;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMismatch, setPasswordMismatch] = useState(false);

  useMemo(() => {
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMismatch(false);
  }, [user, visible]);

  const handlePasswordChange = (text: string) => {
    setNewPassword(text);
    setPasswordMismatch(text !== confirmPassword && confirmPassword.length > 0);
  };

  const handleConfirmPasswordChange = (text: string) => {
    setConfirmPassword(text);
    setPasswordMismatch(newPassword !== text && text.length > 0);
  };

  const handleSubmit = () => {
    if (!newPassword || newPassword !== confirmPassword || newPassword.length < 8) {
      toastError('Por favor verifica los campos de contraseña.');
      return;
    }

    onSubmit({
      new_password: newPassword,
      confirm_password: confirmPassword,
    });
  };

  const hasValidationError = newPassword.length > 0 && (newPassword.length < 8 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(newPassword));

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Restablecer Contraseña"
      showFooter
      footer={
        <View style={formStyles.footerContainer}>
          <Button title="Cancelar" variant="secondary" onPress={onClose} disabled={loading} style={formStyles.footerBtn} />
          <Button
            title="Restablecer"
            variant="primary"
            onPress={handleSubmit}
            loading={loading}
            disabled={loading || !newPassword || passwordMismatch || newPassword.length < 8 || hasValidationError}
            style={formStyles.footerBtn}
          />
        </View>
      }
    >
      <View style={formStyles.container}>
        <Text style={styles.resetInfoText}>
          Asigna una nueva contraseña para "{user?.first_name} {user?.last_name}". El usuario deberá utilizarla en su próximo inicio de sesión.
        </Text>

        <Input
          label="Nueva Contraseña"
          value={newPassword}
          onChangeText={handlePasswordChange}
          placeholder="••••••••••"
          secureTextEntry
          error={hasValidationError ? 'Mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial.' : undefined}
        />

        <Input
          label="Confirmar Contraseña"
          value={confirmPassword}
          onChangeText={handleConfirmPasswordChange}
          placeholder="••••••••••"
          secureTextEntry
          error={passwordMismatch ? 'Las contraseñas no coinciden' : undefined}
        />
      </View>
    </Modal>
  );
}

// ─── Main Screen Component ───────────────────────────────────────────────────
export default function UsersList() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [actionsModalOpen, setActionsModalOpen] = useState(false);

  // Modal and Confirm dialog states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);

  // Modal de invitación web-parity (separado del form de edición).
  // El web distingue entre invite (solo para enviar email) y edit (configuración
  // completa). Mobile replica esa separación.
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<OrgUser | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    type: 'toggle' | 'delete' | null;
    user: OrgUser | null;
    targetState?: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  }>({ type: null, user: null });

  // ─── Fetching Data ──────────────────────────────────────────────────────────
  const {
    data: usersData,
    isLoading: loadingUsers,
    refetch: refetchUsers,
    isError: isUsersError,
    error: usersError,
  } = useQuery({
    queryKey: ['org-users-list', page, search, filterState, filterRole],
    queryFn: async () => {
      const params: any = {
        page,
        limit: 10,
        search: search.trim() || undefined,
        state: filterState || undefined,
        role: filterRole || undefined,
      };
      const response = await OrgUsersService.listPaginated(params);
      return response;
    },
  });

  const { data: statsData, refetch: refetchStats } = useQuery({
    queryKey: ['org-users-stats'],
    queryFn: () => OrgUsersService.getStats(),
  });

  const { data: storesResponse } = useQuery({
    queryKey: ['org-stores-list'],
    queryFn: () => OrgStoreService.list({ pageSize: 100 }),
  });

  const { data: rolesResponse } = useQuery({
    queryKey: ['org-roles-list'],
    queryFn: () => OrgRolesService.list({ pageSize: 100 }),
  });

  const users = usersData?.data ?? [];
  const meta = usersData?.meta;
  const totalPages = meta?.totalPages ?? 1;
  const totalUsers = meta?.total ?? 0;
  const stats = statsData;

  const storesOptions = useMemo(() => {
    return (storesResponse?.data || []).map((s) => ({
      value: String(s.id),
      label: s.name,
    }));
  }, [storesResponse]);

  const rolesOptions = useMemo(() => {
    return (rolesResponse || []).map((r) => ({
      value: String(r.id),
      label: r.name.toLowerCase() === 'customer' ? 'Usuario' : r.name,
    }));
  }, [rolesResponse]);

  const filterRoleOptions = useMemo(() => {
    return [
      { value: '', label: 'Todos los Roles' },
      ...(rolesResponse || []).map((r) => ({
        value: r.name,
        label: r.name.toLowerCase() === 'customer' ? 'Usuario' : r.name,
      })),
    ];
  }, [rolesResponse]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const inviteMutation = useMutation({
    mutationFn: async (body: { first_name: string; last_name: string; email: string; app: string }) => {
      const inviteRes = await OrgUsersService.invite(body);

      // Después de invitar, configuramos con roles/tiendas según el app elegido:
      //   - ORG_ADMIN        → sin tienda, rol por defecto org_admin
      //   - STORE_ADMIN      → tienda principal requerida, rol store_admin
      //   - STORE_ECOMMERCE  → sin tienda, rol ecommerce
      const userId = String(inviteRes.user_id);
      const defaultRoleByApp: Record<string, { code: string; roleName: string }> = {
        ORG_ADMIN: { code: 'org_admin', roleName: 'Org Admin' },
        STORE_ADMIN: { code: 'store_admin', roleName: 'Store Admin' },
        STORE_ECOMMERCE: { code: 'customer', roleName: 'Customer' },
      };
      const appConfig = defaultRoleByApp[body.app];
      if (appConfig) {
        const matchedRole = (rolesResponse || []).find(
          (r: any) => r.code === appConfig.code || r.name?.toLowerCase().includes(appConfig.roleName.toLowerCase().split(' ')[0]),
        );
        if (matchedRole) {
          await OrgUsersService.updateConfiguration(userId, {
            app: body.app,
            roles: [Number(matchedRole.id)],
            store_ids: [],
            panel_ui: {},
          });
        }
      }

      return inviteRes;
    },
    onSuccess: () => {
      toastSuccess('Invitación enviada exitosamente.');
      queryClient.invalidateQueries({ queryKey: ['org-users-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-users-stats'] });
      setInviteModalOpen(false);
    },
    onError: (err: any) => {
      toastError(err?.message || 'Error al enviar la invitación.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateUserInput }) => {
      const userRes = await OrgUsersService.update(id, {
        first_name: body.first_name,
        last_name: body.last_name,
        phone: body.phone,
        state: body.state,
      });

      const roleId = body.roles?.[0];
      const role = rolesResponse?.find((r) => String(r.id) === String(roleId));
      const app = role?.code === 'org_admin' ? 'ORG_ADMIN' : 'STORE_ADMIN';

      await OrgUsersService.updateConfiguration(id, {
        app,
        roles: roleId ? [Number(roleId)] : [],
        store_ids: body.default_store_id ? [Number(body.default_store_id)] : [],
        panel_ui: {},
      });

      return userRes;
    },
    onSuccess: (data, variables) => {
      toastSuccess('Usuario actualizado con éxito.');
      queryClient.invalidateQueries({ queryKey: ['org-users-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-users-stats'] });
      queryClient.invalidateQueries({ queryKey: ['user-config', variables.id] });
      setFormModalOpen(false);
      setEditingUser(null);
    },
    onError: (err: any) => {
      toastError(err?.message || 'Error al actualizar el usuario.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => OrgUsersService.delete(id),
    onSuccess: () => {
      toastSuccess('Usuario eliminado exitosamente.');
      queryClient.invalidateQueries({ queryKey: ['org-users-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-users-stats'] });
      setConfirmAction({ type: null, user: null });
    },
    onError: (err: any) => {
      toastError(err?.message || 'Error al eliminar el usuario.');
    },
  });

  const toggleStateMutation = useMutation({
    mutationFn: ({ id, state }: { id: string; state: 'ACTIVE' | 'SUSPENDED' }) =>
      OrgUsersService.toggleState(id, state),
    onSuccess: (_data, vars) => {
      const verb = vars.state === 'SUSPENDED' ? 'suspendido' : 'reactivado';
      toastSuccess(`Usuario ${verb} exitosamente.`);
      queryClient.invalidateQueries({ queryKey: ['org-users-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-users-stats'] });
      setConfirmAction({ type: null, user: null });
    },
    onError: (err: any) => {
      toastError(err?.message || 'No se pudo cambiar el estado del usuario.');
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => OrgUsersService.resetPassword(id, body),
    onSuccess: () => {
      toastSuccess('Contraseña restablecida exitosamente.');
      setResetPasswordModalOpen(false);
      setResetPasswordUser(null);
    },
    onError: (err: any) => {
      toastError(err?.message || 'Error al restablecer la contraseña.');
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchUsers(), refetchStats()]);
    setRefreshing(false);
  };

  const handleClearFilters = () => {
    setFilterState('');
    setFilterRole('');
    setSearch('');
    setPage(1);
  };

  const handleFormSubmit = (data: UpdateUserInput) => {
    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, body: data });
    }
  };

  const handleInviteSubmit = (data: { first_name: string; last_name: string; email: string; app: string }) => {
    inviteMutation.mutate(data);
  };

  const handleConfirmAction = () => {
    const { type, user } = confirmAction;
    if (!user) return;

    if (type === 'delete') {
      deleteMutation.mutate(user.id);
    } else if (type === 'toggle' && confirmAction.targetState && confirmAction.targetState !== 'DISABLED') {
      toggleStateMutation.mutate({ id: user.id, state: confirmAction.targetState });
    }
  };

  const handleResetPasswordSubmit = (body: any) => {
    if (resetPasswordUser) {
      resetPasswordMutation.mutate({ id: resetPasswordUser.id, body });
    }
  };

  // KPI Grid items mapping — paridad con web (8 tarjetas).
  // Web (Tailwind): bg-primary/10 · bg-green-100/text-green-600 · bg-yellow-100/text-yellow-600
  // · bg-purple-100/text-purple-600 · bg-gray-100/text-gray-600 · bg-red-100/text-red-600
  // · bg-emerald-100/text-emerald-600 · bg-red-100/text-red-600.
  const statsItems = useMemo(() => {
    const total = stats?.total_usuarios ?? 0;
    const active = stats?.activos ?? 0;
    const pending = stats?.pendientes ?? 0;
    const twoFA = stats?.con_2fa ?? 0;
    const inactive = stats?.inactivos ?? 0;
    const suspended = stats?.suspendidos ?? 0;
    const emailVerified = stats?.email_verificado ?? 0;
    const archived = stats?.archivados ?? 0;

    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

    return [
      {
        label: 'Total Usuarios',
        value: total,
        icon: 'users',
        description: 'En la organización',
        iconBg: 'rgba(34, 197, 94, 0.1)',
        iconColor: colors.primary,
      },
      {
        label: 'Activos',
        value: active,
        icon: 'check-circle',
        description: `${pct(active)}% del total`,
        iconBg: 'rgba(22, 163, 74, 0.12)',
        iconColor: '#16a34a',
      },
      {
        label: 'Pendientes',
        value: pending,
        icon: 'clock',
        description: `${pct(pending)}% del total`,
        iconBg: 'rgba(202, 138, 4, 0.12)',
        iconColor: '#ca8a04',
      },
      {
        label: 'Con 2FA',
        value: twoFA,
        icon: 'shield',
        description: `${pct(twoFA)}% del total`,
        iconBg: 'rgba(147, 51, 234, 0.12)',
        iconColor: '#9333ea',
      },
      {
        label: 'Inactivos',
        value: inactive,
        icon: 'user-x',
        description: `${pct(inactive)}% del total`,
        iconBg: 'rgba(75, 85, 99, 0.12)',
        iconColor: '#4b5563',
      },
      {
        label: 'Suspendidos',
        value: suspended,
        icon: 'alert-triangle',
        description: `${pct(suspended)}% del total`,
        iconBg: 'rgba(220, 38, 38, 0.12)',
        iconColor: '#dc2626',
      },
      {
        label: 'Email Verificado',
        value: emailVerified,
        icon: 'mail-check',
        description: `${pct(emailVerified)}% del total`,
        iconBg: 'rgba(5, 150, 105, 0.12)',
        iconColor: '#059669',
      },
      {
        label: 'Archivados',
        value: archived,
        icon: 'archive',
        description: `${pct(archived)}% del total`,
        iconBg: 'rgba(220, 38, 38, 0.12)',
        iconColor: '#dc2626',
      },
    ];
  }, [stats]);

  const hasFilters = filterState || filterRole || search;
  const isLoading = loadingUsers;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Stats KPI Cards ── */}
      <View style={styles.statsScroll}>
        <StatsGrid items={statsItems} />
      </View>

      {/* ── Table / List Container ── */}
      <View style={styles.tableCard}>
        {/* Header con Buscador y Filtros — espejo del bloque sticky web:
            <h2 class="text-lg font-semibold text-text-primary">Usuarios (N)</h2>
            + search + options-dropdown */}
        <View style={styles.tableHeader}>
          <View style={styles.tableTitleRow}>
            <Text style={styles.tableTitle}>Usuarios ({totalUsers})</Text>
          </View>

          {/* Search bar + 2 icon-only triggers (espejo del `<app-options-dropdown>`
              web mobile responsive: ambos icon-only 40x40, primary border, primary icon). */}
          <View style={styles.searchRow}>
            <View style={{ flex: 1 }}>
              <SearchBar
                value={search}
                onChangeText={(text) => {
                  setSearch(text);
                  setPage(1);
                }}
                placeholder="Buscar usuarios..."
                style={styles.searchInput}
              />
            </View>
            {/* Actions trigger (+ button) — abre modal con Invitar/Actualizar */}
            <Pressable
              style={styles.optionsTrigger}
              onPress={() => setActionsModalOpen(true)}
              accessibilityLabel="Abrir acciones"
            >
              <Icon
                name="plus"
                size={18}
                color={colors.primary}
              />
            </Pressable>
            {/* Filters trigger — abre modal con Estado/Rol */}
            <Pressable
              style={styles.optionsTrigger}
              onPress={() => setFiltersModalOpen(true)}
              accessibilityLabel="Abrir filtros"
            >
              <Icon
                name="filter"
                size={16}
                color={colors.primary}
              />
              {hasFilters ? (
                <View style={styles.filterTriggerBadge}>
                  <Text style={styles.filterTriggerBadgeText}>
                    {(filterState ? 1 : 0) + (filterRole ? 1 : 0)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>

        {/* ── Cards List ── */}
        <View style={styles.cardList}>
          {isUsersError ? (
            <EmptyState
              icon="alert-triangle"
              title="Error al cargar usuarios"
              description={usersError instanceof Error ? usersError.message : 'Ocurrió un problema al conectar con el servidor.'}
              actionLabel="Reintentar"
              onAction={() => refetchUsers()}
            />
          ) : isLoading ? (
            // Skeletons
            Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          ) : users.length === 0 ? (
            <EmptyState
              icon="users"
              title={hasFilters ? 'Sin resultados' : 'No hay usuarios'}
              description={
                hasFilters
                  ? 'Intenta modificando los filtros o el buscador de usuarios.'
                  : 'Invita a tu primer miembro del equipo para empezar.'
              }
              actionLabel={hasFilters ? 'Limpiar filtros' : 'Invitar Usuario'}
              onAction={
                hasFilters
                  ? handleClearFilters
                  : () => setInviteModalOpen(true)
              }
            />
          ) : (
            users.map((u: OrgUser) => (
              <UserCard
                key={u.id}
                user={u}
                onEdit={() => {
                  setEditingUser(u);
                  setFormModalOpen(true);
                }}
                onDelete={() => {
                  // Acción contextual según estado:
                  //   ACTIVE / INVITED → suspender (toggle a SUSPENDED)
                  //   SUSPENDED         → reactivar (toggle a ACTIVE)
                  //   DISABLED          → eliminar (acción destructiva)
                  if (u.state === 'DISABLED') {
                    setConfirmAction({ type: 'delete', user: u });
                  } else if (u.state === 'SUSPENDED') {
                    setConfirmAction({
                      type: 'toggle',
                      user: u,
                      targetState: 'ACTIVE',
                    });
                  } else {
                    setConfirmAction({
                      type: 'toggle',
                      user: u,
                      targetState: 'SUSPENDED',
                    });
                  }
                }}
                rolesList={rolesOptions}
                storesList={storesOptions}
              />
            ))
          )}
        </View>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <View style={styles.paginationContainer}>
            <Button
              title="Anterior"
              variant="secondary"
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={styles.paginationBtn}
            />
            <Text style={styles.paginationText}>
              Página {page} de {totalPages}
            </Text>
            <Button
              title="Siguiente"
              variant="secondary"
              onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={styles.paginationBtn}
            />
          </View>
        )}
      </View>

      {/* ── Confirm dialogs ─────────────────────────────────────────────────── */}
      {(() => {
        const { type, user, targetState } = confirmAction;
        if (!type || !user) return null;

        const fullName = `${user.first_name} ${user.last_name}`.trim() || user.email;
        const isSuspend = type === 'toggle' && targetState === 'SUSPENDED';
        const isReactivate = type === 'toggle' && targetState === 'ACTIVE';
        const isDelete = type === 'delete';

        const title = isSuspend
          ? 'Suspender usuario'
          : isReactivate
            ? 'Reactivar usuario'
            : 'Eliminar usuario';

        const message = isSuspend
          ? `¿Suspender a "${fullName}"?\n\nNo podrá iniciar sesión ni usar la plataforma hasta que lo reactives. Sus datos y permisos se conservan.`
          : isReactivate
            ? `¿Reactivar a "${fullName}"?\n\nVolverá a tener acceso inmediato con sus roles y tiendas asignadas.`
            : `¿Eliminar definitivamente a "${fullName}"?\n\nEsta acción no se puede deshacer y borrará sus datos asociados.`;

        const confirmLabel = isSuspend
          ? 'Sí, suspender'
          : isReactivate
            ? 'Sí, reactivar'
            : 'Eliminar';

        return (
          <ConfirmDialog
            visible
            onClose={() => setConfirmAction({ type: null, user: null })}
            onConfirm={handleConfirmAction}
            title={title}
            message={message}
            confirmLabel={confirmLabel}
            cancelLabel="Cancelar"
            destructive={isSuspend || isDelete}
            loading={deleteMutation.isPending || toggleStateMutation.isPending}
          />
        );
      })()}

      {/* Filter Modal — espejo del `<app-options-dropdown>` web mobile:
          un solo modal con Estado + Rol, Aplicar/Limpiar. */}
      <OrgCenteredModal
        visible={filtersModalOpen}
        onClose={() => setFiltersModalOpen(false)}
        title="Filtros"
        subtitle={
          filterState || filterRole
            ? `${(filterState ? 1 : 0) + (filterRole ? 1 : 0)} filtro(s) activo(s)`
            : 'Mostrando todos los usuarios'
        }
        size="sm"
        footer={
          <View style={styles.filtersModalFooter}>
            <Pressable
              style={styles.filtersModalClearBtn}
              onPress={() => {
                setFilterState('');
                setFilterRole('');
              }}
            >
              <Icon name="rotate-ccw" size={14} color={colorScales.gray[600]} />
              <Text style={styles.filtersModalClearText}>Limpiar</Text>
            </Pressable>
            <Pressable
              style={styles.filtersModalApplyBtn}
              onPress={() => {
                setFiltersModalOpen(false);
                setPage(1);
              }}
            >
              <Icon name="check" size={16} color="#FFFFFF" />
              <Text style={styles.filtersModalApplyText}>Aplicar</Text>
            </Pressable>
          </View>
        }
      >
        {/* Estado — espejo de `<app-selector>` web en el filter dropdown */}
        <View style={styles.filtersModalSection}>
          <Text style={styles.filtersModalLabel}>Estado</Text>
          <View style={styles.filtersModalOptions}>
            {FILTER_STATE_OPTIONS.map((opt) => {
              const isActive = filterState === opt.value;
              return (
                <Pressable
                  key={opt.value || 'all-state'}
                  style={[styles.filtersModalOption, isActive && styles.filtersModalOptionActive]}
                  onPress={() => setFilterState(opt.value)}
                >
                  <Text style={[styles.filtersModalOptionText, isActive && styles.filtersModalOptionTextActive]}>
                    {opt.label}
                  </Text>
                  {isActive ? <Icon name="check" size={14} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Rol — espejo de `<app-selector>` web en el filter dropdown */}
        <View style={styles.filtersModalSection}>
          <Text style={styles.filtersModalLabel}>Rol</Text>
          <View style={styles.filtersModalOptions}>
            {filterRoleOptions.map((opt) => {
              const isActive = filterRole === opt.value;
              return (
                <Pressable
                  key={opt.value || 'all-role'}
                  style={[styles.filtersModalOption, isActive && styles.filtersModalOptionActive]}
                  onPress={() => setFilterRole(opt.value)}
                >
                  <Text style={[styles.filtersModalOptionText, isActive && styles.filtersModalOptionTextActive]}>
                    {opt.label}
                  </Text>
                  {isActive ? <Icon name="check" size={14} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </OrgCenteredModal>

      {/* Actions Modal — espejo del `<app-options-dropdown>` web con la lista
          de acciones globales (Invitar Usuario + Actualizar). Mismo patrón visual
          que el filters modal: options list bordered, check activo a la derecha. */}
      <OrgCenteredModal
        visible={actionsModalOpen}
        onClose={() => setActionsModalOpen(false)}
        title="Acciones"
        subtitle="¿Qué quieres hacer con la lista de usuarios?"
        size="sm"
      >
        <View style={styles.actionsModalList}>
          <Pressable
            style={styles.actionsModalOption}
            onPress={() => {
              setActionsModalOpen(false);
              setInviteModalOpen(true);
            }}
          >
            <View style={[styles.actionsModalIconWrap, { backgroundColor: colors.primary + '15' }]}>
              <Icon name="plus" size={16} color={colors.primary} />
            </View>
            <View style={styles.actionsModalTextWrap}>
              <Text style={styles.actionsModalOptionTitle}>Invitar Usuario</Text>
              <Text style={styles.actionsModalOptionHint}>
                Enviar una invitación por correo a un nuevo miembro
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.actionsModalOption}
            onPress={() => {
              setActionsModalOpen(false);
              onRefresh();
            }}
          >
            <View style={[styles.actionsModalIconWrap, { backgroundColor: colorScales.gray[100] }]}>
              <Icon name="refresh-cw" size={16} color={colorScales.gray[700]} />
            </View>
            <View style={styles.actionsModalTextWrap}>
              <Text style={styles.actionsModalOptionTitle}>Actualizar</Text>
              <Text style={styles.actionsModalOptionHint}>
                Recargar la lista con los últimos cambios
              </Text>
            </View>
          </Pressable>
        </View>
      </OrgCenteredModal>

      {/* Invite User Modal — espejo web `app-invite-user-modal` (paridad 1:1).
          Solo para enviar la invitación (Nombre, Apellido, Email, Aplicación).
          El form completo (rol/tienda/estado) es solo para edición. */}
      <InviteUserModal
        visible={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onSubmit={handleInviteSubmit}
        loading={inviteMutation.isPending}
      />

      {/* Edit User Modal — espejo web `app-user-edit-modal` (paridad 1:1).
          Para editar el perfil de un usuario. Estructura 2-col grid + sección
          Configuración de Acceso + card de Información del Usuario. */}
      <EditUserModal
        visible={formModalOpen}
        onClose={() => {
          setFormModalOpen(false);
          setEditingUser(null);
        }}
        onSubmit={handleFormSubmit}
        user={editingUser}
        rolesList={rolesOptions}
        storesList={storesOptions}
        loading={updateMutation.isPending}
      />

      {/* Reset Password Form Modal */}
      <UserResetPasswordModal
        visible={resetPasswordModalOpen}
        onClose={() => {
          setResetPasswordModalOpen(false);
          setResetPasswordUser(null);
        }}
        onSubmit={handleResetPasswordSubmit}
        user={resetPasswordUser}
        loading={resetPasswordMutation.isPending}
      />
    </ScrollView>
  );
}

// ─── Skeleton Component for Cards ─────────────────────────────────────────────
function SkeletonCard() {
  return (
    <View style={skeletonStyles.card}>
      <View style={skeletonStyles.body}>
        <View style={skeletonStyles.avatar} />
        <View style={skeletonStyles.titleGroup}>
          <View style={skeletonStyles.title} />
          <View style={skeletonStyles.subtitle} />
        </View>
        <View style={skeletonStyles.badge} />
      </View>
      <View style={skeletonStyles.grid}>
        <View style={skeletonStyles.detail} />
        <View style={skeletonStyles.detail} />
        <View style={skeletonStyles.detail} />
      </View>
      <View style={skeletonStyles.footer} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    padding: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 16,
  },
  body: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colorScales.gray[100] },
  titleGroup: { flex: 1, gap: 6 },
  title: { height: 14, backgroundColor: colorScales.gray[100], borderRadius: 4, width: '60%' },
  subtitle: { height: 11, backgroundColor: colorScales.gray[100], borderRadius: 4, width: '40%' },
  badge: { width: 56, height: 22, backgroundColor: colorScales.gray[100], borderRadius: 99 },
  grid: { flexDirection: 'row', gap: 8 },
  detail: { flex: 1, height: 32, backgroundColor: colorScales.gray[100], borderRadius: 4 },
  footer: { height: 36, backgroundColor: colorScales.gray[50], borderRadius: 4 },
});

// ─── Main Screen Styles ───────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f4f4f4',
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[4],
  },
  statsScroll: { marginHorizontal: -spacing[4] },
  tableCard: {
    gap: spacing[3],
  },
  tableHeader: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    // Espejo del `p-2` que usa la web en su `<div class="p-2 md:px-6 md:py-4 ...">`.
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  tableTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  // Espejo del `<h2 class="text-lg font-semibold text-text-primary">` web
  // (line-height ligeramente más alto para evitar clipping con la estrella
  // de "Primario" en los domain-row-card).
  tableTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  // Espejo del `.inputsearch-wrapper-modern` web mobile:
  //   background var(--color-background), 12px radius, height 40px,
  //   border 1px var(--color-border).
  // Se aplica como override local (SearchBar es shared) sin tocar el componente.
  searchInput: {
    width: '100%',
    height: 40,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  // Espejo del `.options-dropdown-trigger` web mobile responsive
  // (max-width: 1023px). El web colapsa el dropdown a icon-only:
  //   - 40x40 size
  //   - 1px primary border (var(--color-primary))
  //   - 12px radius (var(--radius-md) en web = 0.75rem)
  //   - surface bg (var(--color-surface))
  //   - ícono primary (16-18px)
  // Lo usamos para AMBOS triggers: actions (+) y filter (sliders).
  optionsTrigger: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg, // 12px = 0.75rem (paridad web)
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterTriggerBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTriggerBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: interFonts.bold,
  },
  // ── Users filters modal styles (espejo del `<app-options-dropdown>` web)
  filtersModalFooter: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  filtersModalClearBtn: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  filtersModalClearText: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
  },
  filtersModalApplyBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  filtersModalApplyText: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.bold,
    color: '#FFFFFF',
  },
  filtersModalSection: {
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  filtersModalLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[600],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  filtersModalOptions: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  filtersModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    gap: spacing[2],
  },
  filtersModalOptionActive: {
    backgroundColor: colorScales.green[50],
  },
  filtersModalOptionText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[700],
  },
  filtersModalOptionTextActive: {
    color: colors.primary,
    fontFamily: interFonts.semibold,
  },
  // ── Users actions modal styles (espejo del `<app-options-dropdown>` web
  //    cuando `actionsDisplay="dropdown"`). Lista de acciones globales con
  //    ícono + título + hint descriptivo.
  actionsModalList: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  actionsModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  actionsModalIconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionsModalTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  actionsModalOptionTitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
  },
  actionsModalOptionHint: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  cardList: {
    gap: 12,
  },
  resetInfoText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[600],
    lineHeight: 20,
    marginBottom: spacing[4],
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: spacing[4],
    marginBottom: spacing[6],
  },
  paginationBtn: {
    minWidth: 100,
  },
  paginationText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.medium,
    color: colorScales.gray[700],
  },
});
