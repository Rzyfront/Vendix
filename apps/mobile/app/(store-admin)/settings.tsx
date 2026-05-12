import { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  StyleSheet,
  Switch,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SettingsService } from '@/features/store/services/settings.service';
import type {
  StoreSettings,
  StoreUser,
  StoreRole,
  SettingsPaymentMethod,
  CreateStoreUserDto,
  UpdateStoreUserDto,
  CreateStoreRoleDto,
  UpdateStoreRoleDto,
} from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Avatar } from '@/shared/components/avatar/avatar';
import { Icon } from '@/shared/components/icon/icon';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Modal } from '@/shared/components/modal/modal';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError, toastInfo } from '@/shared/components/toast/toast.store';
import {
  colors,
  colorScales,
  spacing,
  borderRadius,
  typography,
} from '@/shared/theme';

type SettingsTab = 'general' | 'payments' | 'users' | 'roles' | 'appearance' | 'security';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'payments', label: 'Pagos' },
  { key: 'users', label: 'Usuarios' },
  { key: 'roles', label: 'Roles' },
  { key: 'appearance', label: 'Apariencia' },
  { key: 'security', label: 'Seguridad' },
];

// ─── Shared Styles ─────────────────────────────────────────────────────────

const tabBarStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  scroll: {
    paddingHorizontal: spacing[4],
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing[1],
    paddingVertical: spacing[2],
  },
  tab: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabInactive: {
    backgroundColor: colorScales.gray[100],
  },
  tabTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.background,
  },
  tabTextInactive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[600],
  },
});

const sectionStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing[4],
    gap: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing[1],
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  flex1: {
    flex: 1,
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsGridOverride: {
    paddingHorizontal: 0,
    paddingTop: 0,
    marginBottom: spacing[4],
  },
  fab: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[6],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[600],
    alignItems: 'center',
    justifyContent: 'center',
    ...{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  },
  listContent: {
    paddingBottom: spacing[24],
  },
});

const cardStyles = StyleSheet.create({
  card: {
    marginBottom: spacing[3],
  },
  cardBody: {
    padding: spacing[4],
    gap: spacing[2],
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  cardSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  cardDetail: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    marginTop: spacing[1],
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  userInfo: {
    flex: 1,
    gap: spacing[0.5],
  },
  userName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  userEmail: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1],
  },
  toggleLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
  placeholderBox: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  themeOptionLast: {
    borderBottomWidth: 0,
  },
  themeLabel: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[700],
  },
  securitySection: {
    marginBottom: spacing[4],
  },
});

// ─── Tab Bar ────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  return (
    <View style={tabBarStyles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={tabBarStyles.scroll}
        contentContainerStyle={tabBarStyles.tabRow}
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[tabBarStyles.tab, isActive ? tabBarStyles.tabActive : tabBarStyles.tabInactive]}
            >
              <Text style={isActive ? tabBarStyles.tabTextActive : tabBarStyles.tabTextInactive}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── General Tab ────────────────────────────────────────────────────────────

function GeneralTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Partial<StoreSettings>>({
    name: '',
    tax_id: '',
    address: '',
    city: '',
    phone: '',
    email: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: settings, isLoading } = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => SettingsService.getSettings(),
  });

  useState(() => {
    if (settings) {
      setForm((prev) => ({
        ...prev,
        name: settings.name ?? '',
        tax_id: settings.tax_id ?? '',
        address: settings.address ?? '',
        city: settings.city ?? '',
        phone: settings.phone ?? '',
        email: settings.email ?? '',
      }));
    }
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<StoreSettings>) => SettingsService.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-settings'] });
      toastSuccess('Configuración guardada');
    },
    onError: () => toastError('Error al guardar la configuración'),
  });

  const updateField = (key: keyof StoreSettings, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!form.name?.trim()) newErrors.name = 'El nombre es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    updateMutation.mutate({
      name: form.name?.trim(),
      tax_id: form.tax_id?.trim() || undefined,
      address: form.address?.trim() || undefined,
      city: form.city?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      email: form.email?.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <View style={sectionStyles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={sectionStyles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={sectionStyles.content}
      >
        <Text style={sectionStyles.sectionTitle}>Información de la Tienda</Text>
        <Card>
          <Card.Body>
            <Input
              label="Nombre de la Tienda *"
              value={form.name ?? ''}
              onChangeText={(v) => updateField('name', v)}
              error={errors.name}
              placeholder="Mi Tienda"
            />
            <Input
              label="NIT / RUT"
              value={form.tax_id ?? ''}
              onChangeText={(v) => updateField('tax_id', v)}
              placeholder="123456789-0"
            />
            <Input
              label="Dirección"
              value={form.address ?? ''}
              onChangeText={(v) => updateField('address', v)}
              placeholder="Calle 123 #45-67"
            />
            <Input
              label="Ciudad"
              value={form.city ?? ''}
              onChangeText={(v) => updateField('city', v)}
              placeholder="Bogotá"
            />
            <Input
              label="Teléfono"
              value={form.phone ?? ''}
              onChangeText={(v) => updateField('phone', v)}
              placeholder="+57 300 123 4567"
              keyboardType="phone-pad"
            />
            <Input
              label="Email"
              value={form.email ?? ''}
              onChangeText={(v) => updateField('email', v)}
              placeholder="tienda@ejemplo.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </Card.Body>
        </Card>
      </ScrollView>
      <View style={sectionStyles.footer}>
        <Button
          title="Guardar Cambios"
          onPress={handleSubmit}
          loading={updateMutation.isPending}
          fullWidth
        />
      </View>
    </View>
  );
}

// ─── Payments Tab ───────────────────────────────────────────────────────────

function PaymentsTab() {
  const queryClient = useQueryClient();
  const { data: methods, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => SettingsService.getPaymentMethods(),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => SettingsService.togglePaymentMethod(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    },
    onError: () => toastError('Error al cambiar estado del método de pago'),
  });

  if (isLoading) {
    return (
      <View style={sectionStyles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={sectionStyles.container}>
      <FlatList
        data={methods ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sectionStyles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View style={sectionStyles.content}>
            <Text style={sectionStyles.sectionTitle}>Métodos de Pago</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin métodos de pago"
            description="No hay métodos de pago configurados"
            icon="credit-card"
          />
        }
        renderItem={({ item }) => (
          <View style={[sectionStyles.content, { marginTop: 0 }]}>
            <Card style={cardStyles.card}>
              <Card.Body style={cardStyles.cardBody}>
                <View style={cardStyles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={cardStyles.cardTitle}>{item.name}</Text>
                    <Badge label={item.type} variant="info" size="sm" />
                  </View>
                  <Switch
                    value={item.enabled}
                    onValueChange={() => toggleMutation.mutate(item.id)}
                    trackColor={{
                      false: colorScales.gray[200],
                      true: colorScales.green[600],
                    }}
                    thumbColor={colors.background}
                  />
                </View>
              </Card.Body>
            </Card>
          </View>
        )}
      />
    </View>
  );
}

// ─── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<StoreUser | null>(null);
  const [showConfirmToggle, setShowConfirmToggle] = useState<StoreUser | null>(null);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['settings-users', search],
    queryFn: () => SettingsService.getUsers({ search: search || undefined }),
  });

  const users = data?.data ?? [];
  const totalUsers = data?.pagination?.total ?? 0;
  const activeUsers = users.filter((u) => u.state === 'active').length;

  const toggleUserMutation = useMutation({
    mutationFn: (id: string) => SettingsService.toggleUserState(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
      toastSuccess('Estado del usuario actualizado');
      setShowConfirmToggle(null);
    },
    onError: () => toastError('Error al cambiar estado'),
  });

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
  }, []);

  const renderUser = useCallback(
    ({ item }: { item: StoreUser }) => {
      const fullName = `${item.first_name} ${item.last_name}`;
      return (
        <View style={sectionStyles.content} key={item.id}>
          <Card style={cardStyles.card}>
            <Card.Body style={cardStyles.cardBody}>
              <View style={cardStyles.userHeader}>
                <Avatar name={fullName} size="md" />
                <View style={cardStyles.userInfo}>
                  <Text style={cardStyles.userName} numberOfLines={1}>
                    {fullName}
                  </Text>
                  <Text style={cardStyles.userEmail} numberOfLines={1}>
                    {item.email}
                  </Text>
                </View>
              </View>
              <View style={cardStyles.badgeRow}>
                {item.role_name && <Badge label={item.role_name} variant="info" size="sm" />}
                <Badge
                  label={item.state === 'active' ? 'Activo' : 'Inactivo'}
                  variant={item.state === 'active' ? 'success' : 'default'}
                  size="sm"
                />
              </View>
              <View style={cardStyles.actionsRow}>
                <Button
                  title="Editar"
                  size="sm"
                  variant="outline"
                  onPress={() => setEditingUser(item)}
                />
                <Button
                  title={item.state === 'active' ? 'Desactivar' : 'Activar'}
                  size="sm"
                  variant={item.state === 'active' ? 'secondary' : 'primary'}
                  onPress={() => setShowConfirmToggle(item)}
                />
              </View>
            </Card.Body>
          </Card>
        </View>
      );
    },
    [],
  );

  return (
    <View style={sectionStyles.container}>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={sectionStyles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View style={sectionStyles.content}>
            <StatsGrid
              style={sectionStyles.statsGridOverride}
              items={[
                {
                  label: 'Total Usuarios',
                  value: String(totalUsers),
                  icon: <Icon name="users" size={14} color={colorScales.green[600]} />,
                },
                {
                  label: 'Activos',
                  value: String(activeUsers),
                  icon: <Icon name="user-check" size={14} color={colorScales.green[600]} />,
                },
              ]}
            />
            <SearchBar
              value={search}
              onChangeText={handleSearch}
              onClear={() => handleSearch('')}
              placeholder="Buscar usuarios..."
            />
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin usuarios"
              description="No hay usuarios en esta tienda"
              icon="users"
            />
          )
        }
      />
      <Pressable onPress={() => setShowCreateModal(true)} style={sectionStyles.fab}>
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>

      <CreateUserModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
      <EditUserModal
        visible={!!editingUser}
        user={editingUser}
        onClose={() => setEditingUser(null)}
      />
      <ConfirmDialog
        visible={!!showConfirmToggle}
        onClose={() => setShowConfirmToggle(null)}
        onConfirm={() => showConfirmToggle && toggleUserMutation.mutate(showConfirmToggle.id)}
        title={showConfirmToggle?.state === 'active' ? 'Desactivar usuario' : 'Activar usuario'}
        message={`¿Estás seguro de que deseas ${showConfirmToggle?.state === 'active' ? 'desactivar' : 'activar'} a ${showConfirmToggle?.first_name} ${showConfirmToggle?.last_name}?`}
        confirmLabel={showConfirmToggle?.state === 'active' ? 'Desactivar' : 'Activar'}
        loading={toggleUserMutation.isPending}
      />
    </View>
  );
}

function CreateUserModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: CreateStoreUserDto) => SettingsService.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
      toastSuccess('Usuario creado exitosamente');
      onClose();
    },
    onError: () => toastError('Error al crear usuario'),
  });

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = 'El nombre es requerido';
    if (!lastName.trim()) newErrors.lastName = 'El apellido es requerido';
    if (!email.trim()) {
      newErrors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Ingresa un email válido';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    createMutation.mutate({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      send_invite: sendInvite,
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Crear Usuario"
      showFooter
      footer={
        <Button
          title="Crear Usuario"
          onPress={handleSubmit}
          loading={createMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
          label="Nombre *"
          value={firstName}
          onChangeText={setFirstName}
          error={errors.firstName}
          placeholder="Nombre"
        />
        <Input
          label="Apellido *"
          value={lastName}
          onChangeText={setLastName}
          error={errors.lastName}
          placeholder="Apellido"
        />
        <Input
          label="Email *"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          placeholder="usuario@ejemplo.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <View style={cardStyles.toggleRow}>
          <Text style={cardStyles.toggleLabel}>Enviar invitación por email</Text>
          <Switch
            value={sendInvite}
            onValueChange={setSendInvite}
            trackColor={{
              false: colorScales.gray[200],
              true: colorScales.green[600],
            }}
            thumbColor={colors.background}
          />
        </View>
      </View>
    </Modal>
  );
}

function EditUserModal({
  visible,
  user,
  onClose,
}: {
  visible: boolean;
  user: StoreUser | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useState(() => {
    if (user) {
      setFirstName(user.first_name);
      setLastName(user.last_name);
      setEmail(user.email);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStoreUserDto }) =>
      SettingsService.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
      toastSuccess('Usuario actualizado');
      onClose();
    },
    onError: () => toastError('Error al actualizar usuario'),
  });

  const handleSubmit = () => {
    if (!user) return;
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = 'El nombre es requerido';
    if (!lastName.trim()) newErrors.lastName = 'El apellido es requerido';
    if (!email.trim()) newErrors.email = 'El email es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    updateMutation.mutate({
      id: user.id,
      data: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
      },
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Editar Usuario"
      showFooter
      footer={
        <Button
          title="Guardar Cambios"
          onPress={handleSubmit}
          loading={updateMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
          label="Nombre *"
          value={firstName}
          onChangeText={setFirstName}
          error={errors.firstName}
          placeholder="Nombre"
        />
        <Input
          label="Apellido *"
          value={lastName}
          onChangeText={setLastName}
          error={errors.lastName}
          placeholder="Apellido"
        />
        <Input
          label="Email *"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          placeholder="usuario@ejemplo.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>
    </Modal>
  );
}

// ─── Roles Tab ──────────────────────────────────────────────────────────────

function RolesTab() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<StoreRole | null>(null);
  const [deletingRole, setDeletingRole] = useState<StoreRole | null>(null);

  const { data: roles, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['settings-roles'],
    queryFn: () => SettingsService.getRoles(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => SettingsService.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-roles'] });
      toastSuccess('Rol eliminado');
      setDeletingRole(null);
    },
    onError: () => toastError('Error al eliminar rol'),
  });

  const renderRole = useCallback(
    ({ item }: { item: StoreRole }) => (
      <View style={sectionStyles.content} key={item.id}>
        <Card style={cardStyles.card}>
          <Card.Body style={cardStyles.cardBody}>
            <View style={cardStyles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={cardStyles.cardTitle}>{item.name}</Text>
                {item.description && (
                  <Text style={cardStyles.cardSubtitle} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
                <Text style={cardStyles.cardDetail}>
                  {item.user_count} usuario{item.user_count !== 1 ? 's' : ''}
                </Text>
              </View>
              {item.is_default && (
                <Badge label="Predeterminado" variant="success" size="sm" />
              )}
            </View>
            <View style={cardStyles.actionsRow}>
              <Button
                title="Editar"
                size="sm"
                variant="outline"
                onPress={() => setEditingRole(item)}
              />
              {!item.is_default && (
                <Button
                  title="Eliminar"
                  size="sm"
                  variant="destructive"
                  onPress={() => setDeletingRole(item)}
                />
              )}
            </View>
          </Card.Body>
        </Card>
      </View>
    ),
    [],
  );

  return (
    <View style={sectionStyles.container}>
      <FlatList
        data={roles ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderRole}
        contentContainerStyle={sectionStyles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View style={sectionStyles.content}>
            <Text style={sectionStyles.sectionTitle}>Roles</Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin roles"
              description="No hay roles configurados"
              icon="shield"
            />
          )
        }
      />
      <Pressable onPress={() => setShowCreateModal(true)} style={sectionStyles.fab}>
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>

      <CreateRoleModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
      <EditRoleModal
        visible={!!editingRole}
        role={editingRole}
        onClose={() => setEditingRole(null)}
      />
      <ConfirmDialog
        visible={!!deletingRole}
        onClose={() => setDeletingRole(null)}
        onConfirm={() => deletingRole && deleteMutation.mutate(deletingRole.id)}
        title="Eliminar rol"
        message={`¿Estás seguro de que deseas eliminar el rol "${deletingRole?.name}"?`}
        confirmLabel="Eliminar"
        destructive
        loading={deleteMutation.isPending}
      />
    </View>
  );
}

function CreateRoleModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: CreateStoreRoleDto) => SettingsService.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-roles'] });
      toastSuccess('Rol creado exitosamente');
      onClose();
    },
    onError: () => toastError('Error al crear rol'),
  });

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'El nombre es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Crear Rol"
      showFooter
      footer={
        <Button
          title="Crear Rol"
          onPress={handleSubmit}
          loading={createMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
          label="Nombre *"
          value={name}
          onChangeText={setName}
          error={errors.name}
          placeholder="Nombre del rol"
        />
        <Input
          label="Descripción"
          value={description}
          onChangeText={setDescription}
          placeholder="Descripción del rol"
          multiline
          numberOfLines={3}
        />
      </View>
    </Modal>
  );
}

function EditRoleModal({
  visible,
  role,
  onClose,
}: {
  visible: boolean;
  role: StoreRole | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useState(() => {
    if (role) {
      setName(role.name);
      setDescription(role.description ?? '');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStoreRoleDto }) =>
      SettingsService.updateRole(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-roles'] });
      toastSuccess('Rol actualizado');
      onClose();
    },
    onError: () => toastError('Error al actualizar rol'),
  });

  const handleSubmit = () => {
    if (!role) return;
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'El nombre es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    updateMutation.mutate({
      id: role.id,
      data: {
        name: name.trim(),
        description: description.trim() || undefined,
      },
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Editar Rol"
      showFooter
      footer={
        <Button
          title="Guardar Cambios"
          onPress={handleSubmit}
          loading={updateMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
          label="Nombre *"
          value={name}
          onChangeText={setName}
          error={errors.name}
          placeholder="Nombre del rol"
        />
        <Input
          label="Descripción"
          value={description}
          onChangeText={setDescription}
          placeholder="Descripción del rol"
          multiline
          numberOfLines={3}
        />
      </View>
    </Modal>
  );
}

// ─── Appearance Tab ─────────────────────────────────────────────────────────

function AppearanceTab() {
  const [selectedTheme, setSelectedTheme] = useState<'light' | 'dark' | 'system'>('system');

  const themeOptions: { key: 'light' | 'dark' | 'system'; label: string }[] = [
    { key: 'light', label: 'Claro' },
    { key: 'dark', label: 'Oscuro' },
    { key: 'system', label: 'Sistema' },
  ];

  return (
    <View style={sectionStyles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={sectionStyles.content}
      >
        <Text style={sectionStyles.sectionTitle}>Logo</Text>
        <Card>
          <Card.Body>
            <View style={cardStyles.placeholderBox}>
              <Icon name="store" size={32} color={colorScales.gray[400]} />
            </View>
            <Button
              title="Cambiar Logo"
              variant="outline"
              fullWidth
              onPress={() => toastInfo('Función próximamente')}
            />
          </Card.Body>
        </Card>

        <Text style={sectionStyles.sectionTitle}>Tema</Text>
        <Card>
          <Card.Body>
            {themeOptions.map((option, index) => (
              <Pressable
                key={option.key}
                onPress={() => {
                  setSelectedTheme(option.key);
                  toastInfo('Función próximamente');
                }}
                style={[
                  cardStyles.themeOption,
                  index === themeOptions.length - 1 && cardStyles.themeOptionLast,
                ]}
              >
                <Text style={cardStyles.themeLabel}>{option.label}</Text>
                <Switch
                  value={selectedTheme === option.key}
                  onValueChange={() => {
                    setSelectedTheme(option.key);
                    toastInfo('Función próximamente');
                  }}
                  trackColor={{
                    false: colorScales.gray[200],
                    true: colorScales.green[600],
                  }}
                  thumbColor={colors.background}
                />
              </Pressable>
            ))}
          </Card.Body>
        </Card>
      </ScrollView>
    </View>
  );
}

// ─── Security Tab ───────────────────────────────────────────────────────────

function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [twoFactor, setTwoFactor] = useState(false);

  const handleChangePassword = () => {
    const newErrors: Record<string, string> = {};
    if (!currentPassword) newErrors.currentPassword = 'Contraseña actual requerida';
    if (!newPassword) newErrors.newPassword = 'Nueva contraseña requerida';
    if (newPassword && newPassword.length < 8) newErrors.newPassword = 'Mínimo 8 caracteres';
    if (newPassword !== confirmPassword) newErrors.confirmPassword = 'Las contraseñas no coinciden';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    toastSuccess('Contraseña actualizada');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <View style={sectionStyles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={sectionStyles.content}
      >
        <Text style={sectionStyles.sectionTitle}>Cambiar Contraseña</Text>
        <Card>
          <Card.Body>
            <Input
              label="Contraseña Actual"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              error={errors.currentPassword}
              placeholder="••••••••"
              secureTextEntry
            />
            <Input
              label="Nueva Contraseña"
              value={newPassword}
              onChangeText={setNewPassword}
              error={errors.newPassword}
              placeholder="••••••••"
              secureTextEntry
            />
            <Input
              label="Confirmar Contraseña"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={errors.confirmPassword}
              placeholder="••••••••"
              secureTextEntry
            />
            <Button
              title="Actualizar Contraseña"
              onPress={handleChangePassword}
              fullWidth
            />
          </Card.Body>
        </Card>

        <Text style={sectionStyles.sectionTitle}>Seguridad Adicional</Text>
        <Card>
          <Card.Body>
            <View style={cardStyles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={cardStyles.cardTitle}>Autenticación de dos factores</Text>
                <Text style={cardStyles.cardSubtitle}>
                  Agrega una capa extra de seguridad a tu cuenta
                </Text>
              </View>
              <Switch
                value={twoFactor}
                onValueChange={() => {
                  setTwoFactor(!twoFactor);
                  toastInfo('Función próximamente');
                }}
                trackColor={{
                  false: colorScales.gray[200],
                  true: colorScales.green[600],
                }}
                thumbColor={colors.background}
              />
            </View>
          </Card.Body>
        </Card>

        <Text style={sectionStyles.sectionTitle}>Sesión Actual</Text>
        <Card>
          <Card.Body>
            <View style={cardStyles.toggleRow}>
              <View>
                <Text style={cardStyles.cardTitle}>Dispositivo actual</Text>
                <Text style={cardStyles.cardSubtitle}>App Móvil</Text>
              </View>
              <Badge label="Activo" variant="success" size="sm" />
            </View>
          </Card.Body>
        </Card>
      </ScrollView>
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const renderTab = useCallback(() => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab />;
      case 'payments':
        return <PaymentsTab />;
      case 'users':
        return <UsersTab />;
      case 'roles':
        return <RolesTab />;
      case 'appearance':
        return <AppearanceTab />;
      case 'security':
        return <SecurityTab />;
    }
  }, [activeTab]);

  return (
    <View style={screenStyles.root}>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      {renderTab()}
    </View>
  );
}

const screenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
