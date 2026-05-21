import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, Alert } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

interface PosCustomerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: any) => void;
}

export function PosCustomerModal({ visible, onClose, onSelectCustomer }: PosCustomerModalProps) {
  const [mode, setMode] = useState<'menu' | 'search' | 'create'>('menu');
  const [searchQuery, setSearchQuery] = useState('');
  const [newCustomer, setNewCustomer] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    document_number: '',
  });

  const queryClient = useQueryClient();

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['pos-customers-search', searchQuery],
    queryFn: () => CustomerService.searchCustomers(searchQuery || 'a', 20),
    enabled: mode === 'search' && visible,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => CustomerService.create(data),
    onSuccess: (customer) => {
      toastSuccess('Cliente creado exitosamente');
      queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
      onSelectCustomer(customer);
      onClose();
      setMode('menu');
      setNewCustomer({ first_name: '', last_name: '', email: '', phone: '', document_number: '' });
    },
    onError: () => {
      toastError('Error al crear el cliente');
    },
  });

  const handleCreate = () => {
    if (!newCustomer.first_name.trim()) {
      Alert.alert('Error', 'El nombre es obligatorio');
      return;
    }

    createMutation.mutate({
      first_name: newCustomer.first_name.trim(),
      last_name: newCustomer.last_name.trim() || 'Cliente',
      email: newCustomer.email.trim() || undefined,
      phone: newCustomer.phone.trim() || undefined,
      document_number: newCustomer.document_number.trim() || undefined,
    });
  };

  const handleClose = () => {
    onClose();
    setMode('menu');
    setSearchQuery('');
    setNewCustomer({ first_name: '', last_name: '', email: '', phone: '', document_number: '' });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          {mode !== 'menu' && (
            <Pressable onPress={() => setMode('menu')} style={styles.backBtn}>
              <Icon name="arrow-left" size={24} color={colorScales.gray[700]} />
            </Pressable>
          )}
          <Text style={styles.title}>
            {mode === 'menu' ? 'Cliente' : mode === 'search' ? 'Buscar Cliente' : 'Crear Cliente Rápido'}
          </Text>
          <Pressable onPress={handleClose} style={styles.closeBtn}>
            <Icon name="x" size={24} color={colorScales.gray[700]} />
          </Pressable>
        </View>

        {/* Menu Mode */}
        {mode === 'menu' && (
          <View style={styles.menuContainer}>
            <Pressable
              style={styles.menuOption}
              onPress={() => setMode('search')}
            >
              <View style={styles.menuIcon}>
                <Icon name="search" size={24} color={colors.primary} />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>Buscar cliente</Text>
                <Text style={styles.menuDescription}>Buscar un cliente existente</Text>
              </View>
              <Icon name="chevron-right" size={20} color={colorScales.gray[400]} />
            </Pressable>

            <Pressable
              style={styles.menuOption}
              onPress={() => setMode('create')}
            >
              <View style={styles.menuIcon}>
                <Icon name="user-plus" size={24} color={colors.primary} />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>Crear cliente rápido</Text>
                <Text style={styles.menuDescription}>Crear un nuevo cliente rápidamente</Text>
              </View>
              <Icon name="chevron-right" size={20} color={colorScales.gray[400]} />
            </Pressable>
          </View>
        )}

        {/* Search Mode */}
        {mode === 'search' && (
          <View style={styles.content}>
            <View style={styles.searchWrapper}>
              <Icon name="search" size={18} color={colorScales.gray[400]} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Buscar por nombre, email o documento..."
                placeholderTextColor={colorScales.gray[400]}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <ScrollView style={styles.resultsList}>
              {isLoading ? (
                <Text style={styles.loadingText}>Buscando...</Text>
              ) : (customers as any[]).length === 0 ? (
                <Text style={styles.emptyText}>No se encontraron clientes</Text>
              ) : (
                (customers as any[]).map((customer) => (
                  <Pressable
                    key={customer.id}
                    style={styles.customerItem}
                    onPress={() => {
                      onSelectCustomer(customer);
                      handleClose();
                    }}
                  >
                    <View style={styles.customerAvatar}>
                      <Text style={styles.customerInitials}>
                        {customer.first_name?.[0]}{customer.last_name?.[0]}
                      </Text>
                    </View>
                    <View style={styles.customerInfo}>
                      <Text style={styles.customerName}>
                        {customer.first_name} {customer.last_name}
                      </Text>
                      <Text style={styles.customerEmail}>{customer.email}</Text>
                    </View>
                    <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        )}

        {/* Create Mode */}
        {mode === 'create' && (
          <ScrollView style={styles.content}>
            <View style={styles.field}>
              <Text style={styles.label}>Nombre *</Text>
              <TextInput
                style={styles.input}
                value={newCustomer.first_name}
                onChangeText={(first_name) => setNewCustomer((prev) => ({ ...prev, first_name }))}
                placeholder="Nombre del cliente"
                placeholderTextColor={colorScales.gray[400]}
                autoCapitalize="sentences"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Apellido</Text>
              <TextInput
                style={styles.input}
                value={newCustomer.last_name}
                onChangeText={(last_name) => setNewCustomer((prev) => ({ ...prev, last_name }))}
                placeholder="Apellido opcional"
                placeholderTextColor={colorScales.gray[400]}
                autoCapitalize="sentences"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={newCustomer.email}
                onChangeText={(email) => setNewCustomer((prev) => ({ ...prev, email }))}
                placeholder="email@ejemplo.com"
                placeholderTextColor={colorScales.gray[400]}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Teléfono</Text>
              <TextInput
                style={styles.input}
                value={newCustomer.phone}
                onChangeText={(phone) => setNewCustomer((prev) => ({ ...prev, phone }))}
                placeholder="Número de teléfono"
                placeholderTextColor={colorScales.gray[400]}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Documento</Text>
              <TextInput
                style={styles.input}
                value={newCustomer.document_number}
                onChangeText={(document_number) => setNewCustomer((prev) => ({ ...prev, document_number }))}
                placeholder="Número de documento"
                placeholderTextColor={colorScales.gray[400]}
              />
            </View>
          </ScrollView>
        )}

        {/* Footer for Create Mode */}
        {mode === 'create' && (
          <View style={styles.footer}>
            <Pressable
              style={[styles.createBtn, createMutation.isPending && styles.createBtnDisabled]}
              onPress={handleCreate}
              disabled={createMutation.isPending}
            >
              <Text style={styles.createBtnText}>
                {createMutation.isPending ? 'Creando...' : 'Crear Cliente'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuContainer: {
    padding: spacing[4],
    gap: spacing[3],
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    gap: spacing[3],
  },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  menuDescription: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  content: {
    flex: 1,
    padding: spacing[4],
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
  },
  resultsList: {
    flex: 1,
  },
  loadingText: {
    textAlign: 'center',
    paddingVertical: spacing[8],
    color: colorScales.gray[500],
    fontSize: typography.fontSize.base,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacing[8],
    color: colorScales.gray[500],
    fontSize: typography.fontSize.base,
  },
  customerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    gap: spacing[3],
  },
  customerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerInitials: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  customerEmail: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  field: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
  },
  input: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colorScales.gray[50],
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  createBtnDisabled: {
    opacity: 0.6,
  },
  createBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
