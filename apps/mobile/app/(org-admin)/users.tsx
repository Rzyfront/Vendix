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

          {/* Inactivate/Disable */}
          <Pressable
            style={({ pressed }) => [cardStyles.actionBtn, cardStyles.actionDanger, pressed && { opacity: 0.75 }]}
            onPress={onDelete}
            hitSlop={4}
          >
            <Icon name="trash-2" size={16} color="#ef4444" />
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
  const [pickerOpen, setPickerOpen] = useState<'state' | 'role' | null>(null);

  // Modal and Confirm dialog states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);

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
    mutationFn: async (body: InviteUserInput) => {
      const roleId = body.roles?.[0];
      const role = rolesResponse?.find((r) => String(r.id) === String(roleId));
      const app = role?.code === 'org_admin' ? 'ORG_ADMIN' : 'STORE_ADMIN';

      const inviteRes = await OrgUsersService.invite({
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone,
        app,
      });

      const userId = String(inviteRes.user_id);

      await OrgUsersService.updateConfiguration(userId, {
        app,
        roles: roleId ? [Number(roleId)] : [],
        store_ids: body.default_store_id ? [Number(body.default_store_id)] : [],
        panel_ui: {},
      });

      return inviteRes;
    },
    onSuccess: () => {
      toastSuccess('Invitación enviada exitosamente.');
      queryClient.invalidateQueries({ queryKey: ['org-users-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-users-stats'] });
      setFormModalOpen(false);
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

  const handleFormSubmit = (data: InviteUserInput | UpdateUserInput) => {
    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, body: data as UpdateUserInput });
    } else {
      inviteMutation.mutate(data as InviteUserInput);
    }
  };

  const handleConfirmAction = () => {
    const { type, user } = confirmAction;
    if (!user) return;

    if (type === 'delete') {
      deleteMutation.mutate(user.id);
    }
  };

  const handleResetPasswordSubmit = (body: any) => {
    if (resetPasswordUser) {
      resetPasswordMutation.mutate({ id: resetPasswordUser.id, body });
    }
  };

  // KPI Grid items mapping
  const statsItems = useMemo(() => {
    const total = stats?.total_usuarios ?? 0;
    const active = stats?.activos ?? 0;
    const invited = stats?.pendientes ?? 0;
    const suspended = stats?.suspendidos ?? 0;

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
        description: `${total ? Math.round((active / total) * 100) : 0}% del total`,
        iconBg: 'rgba(34, 197, 94, 0.12)',
        iconColor: '#22c55e',
      },
      {
        label: 'Invitados',
        value: invited,
        icon: 'mail',
        description: `${total ? Math.round((invited / total) * 100) : 0}% del total`,
        iconBg: 'rgba(245, 158, 11, 0.12)',
        iconColor: '#f59e0b',
      },
      {
        label: 'Suspendidos',
        value: suspended,
        icon: 'user-x',
        description: `${total ? Math.round((suspended / total) * 100) : 0}% del total`,
        iconBg: 'rgba(239, 68, 68, 0.12)',
        iconColor: '#ef4444',
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
      {/* ── Page Header ── */}
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.pageTitle}>Usuarios</Text>
          <Text style={styles.pageSubtitle}>Administración del equipo</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
          onPress={() => {
            setEditingUser(null);
            setFormModalOpen(true);
          }}
        >
          <Icon name="plus" size={16} color="#fff" />
          <Text style={styles.addBtnText}>Invitar</Text>
        </Pressable>
      </View>

      {/* ── Stats KPI Cards ── */}
      <View style={styles.statsScroll}>
        <StatsGrid items={statsItems} />
      </View>

      {/* ── Table / List Container ── */}
      <View style={styles.tableCard}>
        {/* Header con Buscador y Filtros */}
        <View style={styles.tableHeader}>
          <View style={styles.tableTitleRow}>
            <Text style={styles.tableTitle}>Miembros ({totalUsers})</Text>
            <Pressable style={styles.refreshBtn} onPress={onRefresh}>
              <Icon name="refresh-cw" size={14} color={colorScales.gray[600]} />
            </Pressable>
          </View>

          {/* Search bar */}
          <View style={styles.searchRow}>
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

          {/* Filters triggers */}
          <View style={styles.filterRow}>
            {/* Filter by state */}
            <Pressable style={styles.filterChip} onPress={() => setPickerOpen('state')}>
              <Text style={styles.filterChipText}>
                {filterState ? `Estado: ${USER_STATE_LABELS[filterState]}` : 'Todos los Estados'}
              </Text>
              <Icon name="chevron-down" size={12} color={colorScales.gray[600]} />
            </Pressable>

            {/* Filter by role */}
            <Pressable style={styles.filterChip} onPress={() => setPickerOpen('role')}>
              <Text style={styles.filterChipText}>
                {filterRole ? `Rol: ${filterRole}` : 'Todos los Roles'}
              </Text>
              <Icon name="chevron-down" size={12} color={colorScales.gray[600]} />
            </Pressable>

            {/* Clear filters button */}
            {hasFilters && (
              <Pressable style={styles.clearAllBtn} onPress={handleClearFilters}>
                <Icon name="x" size={12} color={colorScales.gray[600]} />
                <Text style={styles.clearAllText}>Limpiar</Text>
              </Pressable>
            )}
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
                  : () => {
                      setEditingUser(null);
                      setFormModalOpen(true);
                    }
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
                  setConfirmAction({
                    type: 'delete',
                    user: u,
                  });
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
      <ConfirmDialog
        visible={confirmAction.type === 'delete'}
        onClose={() => setConfirmAction({ type: null, user: null })}
        onConfirm={handleConfirmAction}
        title="Eliminar usuario"
        message={
          confirmAction.user
            ? `¿Estás seguro de que deseas eliminar al usuario "${confirmAction.user.first_name} ${confirmAction.user.last_name}"?\n\nEsta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        loading={deleteMutation.isPending}
      />

      {/* Filter Pickers */}
      <OptionPickerModal
        visible={pickerOpen === 'state'}
        title="Estado del usuario"
        options={FILTER_STATE_OPTIONS}
        selected={filterState}
        onSelect={setFilterState}
        onClose={() => setPickerOpen(null)}
      />
      <OptionPickerModal
        visible={pickerOpen === 'role'}
        title="Rol del usuario"
        options={filterRoleOptions}
        selected={filterRole}
        onSelect={setFilterRole}
        onClose={() => setPickerOpen(null)}
      />

      {/* Invite / Edit User Form Modal */}
      <UserFormModal
        visible={formModalOpen}
        onClose={() => {
          setFormModalOpen(false);
          setEditingUser(null);
        }}
        onSubmit={handleFormSubmit}
        user={editingUser}
        rolesList={rolesOptions}
        storesList={storesOptions}
        loading={inviteMutation.isPending || updateMutation.isPending}
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
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageHeaderText: { flex: 1 },
  pageTitle: {
    fontSize: typography.fontSize.xl,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
  },
  pageSubtitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 999,
    gap: spacing[1],
  },
  addBtnPressed: { opacity: 0.85 },
  addBtnText: {
    color: '#fff',
    fontFamily: interFonts.semibold,
    fontSize: typography.fontSize.sm,
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
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
  },
  tableTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  tableTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  searchRow: { marginBottom: spacing[3] },
  searchInput: { width: '100%' },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.md,
    gap: spacing[1],
  },
  filterChipText: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.medium,
    color: colorScales.gray[700],
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  clearAllText: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.medium,
    color: colorScales.gray[600],
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
