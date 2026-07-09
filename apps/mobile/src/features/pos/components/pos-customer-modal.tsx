import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, Alert, KeyboardAvoidingView, Platform, Keyboard, Dimensions } from 'react-native';
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

type TabMode = 'search' | 'create';

interface NewCustomerForm {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  document_type: string;
  document_number: string;
}

const documentTypeOptions = [
  { value: 'CC', label: 'Cédula de Ciudadanía' },
  { value: 'NIT', label: 'NIT' },
  { value: 'CE', label: 'Cédula de Extranjería' },
  { value: 'PP', label: 'Pasaporte' },
  { value: 'TI', label: 'Tarjeta de Identidad' },
];

const emptyForm: NewCustomerForm = {
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  document_type: '',
  document_number: '',
};

export function PosCustomerModal({ visible, onClose, onSelectCustomer }: PosCustomerModalProps) {
  const [activeTab, setActiveTab] = useState<TabMode>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [documentLookupQuery, setDocumentLookupQuery] = useState('');
  const [lookupResult, setLookupResult] = useState<any | null>(null);
  const [lookupPerformed, setLookupPerformed] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>(emptyForm);
  const [showDocTypeDropdown, setShowDocTypeDropdown] = useState(false);

  const queryClient = useQueryClient();

  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['pos-customers-search', searchQuery],
    queryFn: () => CustomerService.searchCustomers(searchQuery || 'a', 20),
    enabled: activeTab === 'search' && visible && searchQuery.length >= 2,
  });

  const { data: recentCustomers = [] } = useQuery({
    queryKey: ['pos-customers-recent'],
    queryFn: () => CustomerService.list({ limit: 20 }),
    enabled: activeTab === 'search' && visible && searchQuery.length < 2,
  });

  const lookupMutation = useMutation({
    mutationFn: (doc: string) => CustomerService.searchCustomers(doc, 1),
    onSuccess: (data) => {
      const customers = Array.isArray(data) ? data : data.data || [];
      setLookupResult(customers.length > 0 ? customers[0] : null);
      setLookupPerformed(true);
    },
    onError: () => {
      setLookupResult(null);
      setLookupPerformed(true);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => CustomerService.create(data),
  });

  const handleDocumentLookup = useCallback(() => {
    if (!documentLookupQuery || documentLookupQuery.length < 5) {
      Alert.alert('Error', 'Ingrese un documento válido (mínimo 5 caracteres)');
      return;
    }
    setLookupPerformed(false);
    setLookupResult(null);
    lookupMutation.mutate(documentLookupQuery.trim());
  }, [documentLookupQuery]);

  const handleSearch = useCallback((text: string) => {
    setSearchQuery(text);
    if (text.length >= 2) {
      setSearchPerformed(true);
    } else {
      setSearchPerformed(false);
    }
  }, []);

  const handleSelectCustomer = useCallback((customer: any) => {
    onSelectCustomer(customer);
    handleClose();
  }, [onSelectCustomer]);

  const handleClose = useCallback(() => {
    onClose();
    setActiveTab('search');
    setSearchQuery('');
    setDocumentLookupQuery('');
    setLookupResult(null);
    setLookupPerformed(false);
    setSearchPerformed(false);
    setNewCustomer(emptyForm);
  }, [onClose]);

  const handleCreate = useCallback(() => {
    if (!newCustomer.first_name.trim()) {
      Alert.alert('Error', 'El nombre es obligatorio');
      return;
    }
    if (!newCustomer.email.trim()) {
      Alert.alert('Error', 'El email es obligatorio');
      return;
    }
    if (!newCustomer.document_number.trim()) {
      Alert.alert('Error', 'El número de documento es obligatorio');
      return;
    }

    createMutation.mutate(
      {
        email: newCustomer.email.trim(),
        first_name: newCustomer.first_name.trim(),
        last_name: newCustomer.last_name.trim() || undefined,
        phone: newCustomer.phone.trim() || undefined,
        document_type: newCustomer.document_type || undefined,
        document_number: newCustomer.document_number.trim(),
      },
      {
        onSuccess: (customer) => {
          toastSuccess('Cliente creado exitosamente');
          queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
          onSelectCustomer(customer);
          onClose();
          setActiveTab('search');
          setSearchQuery('');
          setDocumentLookupQuery('');
          setLookupResult(null);
          setLookupPerformed(false);
          setSearchPerformed(false);
          setNewCustomer(emptyForm);
        },
        onError: (err) => {
          console.error('Error creating customer:', err);
          toastError('Error al crear el cliente');
        },
      },
    );
  }, [newCustomer, queryClient, onSelectCustomer, onClose]);

  const handleCreateFromLookup = useCallback(() => {
    setNewCustomer((prev) => ({
      ...prev,
      document_number: documentLookupQuery.trim(),
    }));
    setActiveTab('create');
  }, [documentLookupQuery]);

  const visibleCustomers = searchQuery.length >= 2
    ? (Array.isArray(searchResults) ? searchResults : searchResults.data || [])
    : (Array.isArray(recentCustomers) ? recentCustomers : recentCustomers.data || []);

  const isFormValid = newCustomer.first_name.trim() && newCustomer.email.trim() && newCustomer.document_number.trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Pressable
            style={styles.container}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.surface}>
            {/* Header */}
            <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Icon name="user" size={20} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>
                {activeTab === 'search' ? 'Buscar Cliente' : 'Crear Cliente Rápido'}
              </Text>
              <Text style={styles.headerSubtitle}>
                {activeTab === 'search'
                  ? 'Busca un cliente existente o crea uno nuevo'
                  : 'Agrega un nuevo cliente para la venta actual'}
              </Text>
            </View>
          </View>
          <Pressable onPress={handleClose} style={styles.closeBtn}>
            <Icon name="x" size={20} color={colorScales.gray[400]} />
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, activeTab === 'search' && styles.tabActive]}
            onPress={() => setActiveTab('search')}
          >
            <Text style={[styles.tabText, activeTab === 'search' && styles.tabTextActive]}>
              Buscar
            </Text>
            {activeTab === 'search' && <View style={styles.tabIndicator} />}
          </Pressable>
          <Pressable
            style={[styles.tab, activeTab === 'create' && styles.tabActive]}
            onPress={() => setActiveTab('create')}
          >
            <Text style={[styles.tabText, activeTab === 'create' && styles.tabTextActive]}>
              Crear
            </Text>
            {activeTab === 'create' && <View style={styles.tabIndicator} />}
          </Pressable>
        </View>

        {/* Content */}
        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
          {/* SEARCH TAB */}
          {activeTab === 'search' && (
            <View style={styles.searchContent}>
              {/* Document Quick Lookup */}
              <View style={styles.lookupSection}>
                <Text style={styles.lookupLabel}>Búsqueda rápida por documento</Text>
                <View style={styles.lookupRow}>
                  <View style={styles.lookupInputWrapper}>
                    <TextInput
                      style={styles.lookupInput}
                      value={documentLookupQuery}
                      onChangeText={setDocumentLookupQuery}
                      placeholder="Ingrese cédula o NIT..."
                      placeholderTextColor={colorScales.gray[400]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={handleDocumentLookup}
                    />
                  </View>
                  <Pressable
                    style={[
                      styles.lookupBtn,
                      (!documentLookupQuery || documentLookupQuery.length < 5) && styles.lookupBtnDisabled,
                    ]}
                    onPress={handleDocumentLookup}
                    disabled={!documentLookupQuery || documentLookupQuery.length < 5}
                  >
                    <Icon name="search" size={16} color="#FFFFFF" />
                    <Text style={styles.lookupBtnText}>Buscar</Text>
                  </Pressable>
                </View>

                {/* Lookup Result: Found */}
                {lookupPerformed && lookupResult && !lookupMutation.isPending && (
                  <View style={styles.lookupResult}>
                    <View>
                      <Text style={styles.lookupResultName}>
                        {lookupResult.first_name} {lookupResult.last_name}
                      </Text>
                      <Text style={styles.lookupResultEmail}>{lookupResult.email}</Text>
                      {lookupResult.document_number && (
                        <Text style={styles.lookupResultDoc}>
                          {lookupResult.document_type || 'Doc'}: {lookupResult.document_number}
                        </Text>
                      )}
                    </View>
                    <Pressable
                      style={styles.lookupSelectBtn}
                      onPress={() => handleSelectCustomer(lookupResult)}
                    >
                      <Text style={styles.lookupSelectBtnText}>Seleccionar</Text>
                    </Pressable>
                  </View>
                )}

                {/* Lookup Result: Not Found */}
                {lookupPerformed && !lookupResult && !lookupMutation.isPending && (
                  <View style={styles.lookupNotFound}>
                    <Text style={styles.lookupNotFoundText}>
                      No se encontró cliente con este documento
                    </Text>
                    <Pressable style={styles.lookupCreateBtn} onPress={handleCreateFromLookup}>
                      <Icon name="user-plus" size={14} color={colors.primary} />
                      <Text style={styles.lookupCreateBtnText}>Crear con este documento</Text>
                    </Pressable>
                  </View>
                )}

                {lookupMutation.isPending && (
                  <Text style={styles.loadingText}>Buscando...</Text>
                )}
              </View>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>o buscar por nombre</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Name Search */}
              <View style={styles.nameSearchWrapper}>
                <Icon name="search" size={18} color={colorScales.gray[400]} />
                <TextInput
                  style={styles.nameSearchInput}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  placeholder="Buscar por nombre, email o documento..."
                  placeholderTextColor={colorScales.gray[400]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Search Results */}
              {searchPerformed && visibleCustomers.length > 0 && (
                <View style={styles.resultsSection}>
                  <Text style={styles.resultsLabel}>Resultados de búsqueda:</Text>
                  <View style={styles.resultsList}>
                    {visibleCustomers.map((customer: any) => (
                      <Pressable
                        key={customer.id}
                        style={styles.customerItem}
                        onPress={() => handleSelectCustomer(customer)}
                      >
                        <View>
                          <Text style={styles.customerName}>
                            {customer.first_name} {customer.last_name}
                          </Text>
                          <Text style={styles.customerEmail}>{customer.email}</Text>
                          {customer.document_number && (
                            <Text style={styles.customerDoc}>
                              Doc: {customer.document_number}
                            </Text>
                          )}
                        </View>
                        <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {/* No Results */}
              {searchPerformed && visibleCustomers.length === 0 && !searchLoading && (
                <View style={styles.emptyState}>
                  <Icon name="user-x" size={48} color={colorScales.gray[300]} />
                  <Text style={styles.emptyText}>
                    No se encontraron clientes con esos criterios
                  </Text>
                  <Pressable
                    style={styles.emptyCreateBtn}
                    onPress={() => setActiveTab('create')}
                  >
                    <Icon name="user-plus" size={16} color={colors.primary} />
                    <Text style={styles.emptyCreateBtnText}>Crear Nuevo Cliente</Text>
                  </Pressable>
                </View>
              )}

              {/* Quick Create Option */}
              {!searchPerformed && (
                <View style={styles.quickCreate}>
                  <Text style={styles.quickCreateText}>¿No quieres buscar?</Text>
                  <Pressable
                    style={styles.quickCreateBtn}
                    onPress={() => setActiveTab('create')}
                  >
                    <Icon name="user-plus" size={16} color={colors.primary} />
                    <Text style={styles.quickCreateBtnText}>Crear Cliente Rápido</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {/* CREATE TAB */}
          {activeTab === 'create' && (
            <View style={styles.createContent}>
              {/* Email */}
              <View style={styles.field}>
                <Text style={styles.label}>EMAIL <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={newCustomer.email}
                  onChangeText={(email) => setNewCustomer((prev) => ({ ...prev, email }))}
                  placeholder="cliente@ejemplo.com"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Name + Last Name */}
              <View style={styles.row}>
                <View style={[styles.field, styles.fieldHalf]}>
                  <Text style={styles.label}>NOMBRE <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={newCustomer.first_name}
                    onChangeText={(first_name) => setNewCustomer((prev) => ({ ...prev, first_name }))}
                    placeholder="Juan"
                    placeholderTextColor={colorScales.gray[400]}
                    autoCapitalize="sentences"
                  />
                </View>
                <View style={[styles.field, styles.fieldHalf]}>
                  <Text style={styles.label}>APELLIDO</Text>
                  <TextInput
                    style={styles.input}
                    value={newCustomer.last_name}
                    onChangeText={(last_name) => setNewCustomer((prev) => ({ ...prev, last_name }))}
                    placeholder="Pérez"
                    placeholderTextColor={colorScales.gray[400]}
                    autoCapitalize="sentences"
                  />
                </View>
              </View>

              {/* Phone */}
              <View style={styles.field}>
                <Text style={styles.label}>TELÉFONO</Text>
                <TextInput
                  style={styles.input}
                  value={newCustomer.phone}
                  onChangeText={(phone) => setNewCustomer((prev) => ({ ...prev, phone }))}
                  placeholder="+54 9 11 1234-5678"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Document Type + Number */}
              <View style={styles.row}>
                <View style={[styles.field, styles.fieldHalf]}>
                  <Text style={styles.label}>TIPO DOC.</Text>
                  <Pressable
                    style={styles.selectInput}
                    onPress={() => {
                      Keyboard.dismiss();
                      setShowDocTypeDropdown(!showDocTypeDropdown);
                    }}
                  >
                    <Text style={newCustomer.document_type ? styles.selectText : styles.selectPlaceholder}>
                      {newCustomer.document_type
                        ? documentTypeOptions.find((o) => o.value === newCustomer.document_type)?.label || 'Seleccionar'
                        : 'Seleccionar'}
                    </Text>
                    <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                  {/* Document type dropdown */}
                  {showDocTypeDropdown && (
                    <View style={styles.dropdown}>
                      {documentTypeOptions.map((option) => (
                        <Pressable
                          key={option.value}
                          style={styles.dropdownItem}
                          onPress={() => {
                            setNewCustomer((prev) => ({ ...prev, document_type: option.value }));
                            setShowDocTypeDropdown(false);
                          }}
                        >
                          <Text style={[
                            styles.dropdownItemText,
                            newCustomer.document_type === option.value && styles.dropdownItemTextActive,
                          ]}>
                            {option.label}
                          </Text>
                          {newCustomer.document_type === option.value && (
                            <Icon name="check" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <View style={[styles.field, styles.fieldHalf]}>
                  <Text style={styles.label}>NÚMERO <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={newCustomer.document_number}
                    onChangeText={(document_number) => setNewCustomer((prev) => ({ ...prev, document_number }))}
                    placeholder="12345678"
                    placeholderTextColor={colorScales.gray[400]}
                  />
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Footer for Create Tab */}
        {activeTab === 'create' && (
          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[
                styles.createBtn,
                (!isFormValid || createMutation.isPending) && styles.createBtnDisabled,
              ]}
              onPress={handleCreate}
              disabled={!isFormValid || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Text style={styles.createBtnText}>Creando...</Text>
              ) : (
                <>
                  <Icon name="save" size={16} color="#FFFFFF" />
                  <Text style={styles.createBtnText}>Crear Cliente</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  container: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '85%',
  },
  surface: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    flex: 1,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  tab: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
    position: 'relative',
  },
  tabActive: {},
  tabText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.primary,
  },
  content: {
    flex: 1,
  },
  searchContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  lookupSection: {
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.green[200],
    gap: spacing[3],
  },
  lookupLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  lookupRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  lookupInputWrapper: {
    flex: 1,
  },
  lookupInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  lookupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  lookupBtnDisabled: {
    opacity: 0.5,
  },
  lookupBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  lookupResult: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  lookupResultName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  lookupResultEmail: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  lookupResultDoc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  lookupSelectBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  lookupSelectBtnText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  lookupNotFound: {
    alignItems: 'center',
    gap: spacing[2],
  },
  lookupNotFoundText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  lookupCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  lookupCreateBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  loadingText: {
    textAlign: 'center',
    paddingVertical: spacing[2],
    color: colorScales.gray[500],
    fontSize: typography.fontSize.sm,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colorScales.gray[200],
  },
  dividerText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  nameSearchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    gap: spacing[2],
  },
  nameSearchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
  },
  resultsSection: {
    gap: spacing[2],
  },
  resultsLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  resultsList: {
    maxHeight: 200,
    gap: spacing[2],
  },
  customerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  customerName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  customerEmail: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  customerDoc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing[8],
    gap: spacing[3],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
  emptyCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
  },
  emptyCreateBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  quickCreate: {
    alignItems: 'center',
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    gap: spacing[2],
  },
  quickCreateText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  quickCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
  },
  quickCreateBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  createContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  field: {
    gap: spacing[1.5],
  },
  fieldHalf: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  required: {
    color: colors.error,
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
  selectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    backgroundColor: colorScales.gray[50],
  },
  selectText: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  selectPlaceholder: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 10,
    marginTop: 4,
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dropdownItemText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  dropdownItemTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
    gap: spacing[3],
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: colorScales.gray[800],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  createBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
