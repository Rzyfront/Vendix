import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
import type { CustomerState, CreateCustomerDto, Customer } from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, borderRadius, typography, colorScales, colors } from '@/shared/theme';

const STATE_OPTIONS: { label: string; value: CustomerState }[] = [
  { label: 'Activo', value: 'active' },
  { label: 'Inactivo', value: 'inactive' },
];

export default function CreateCustomerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [state, setState] = useState<CustomerState>('active');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: existingCustomer, isLoading: loadingCustomer } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => CustomerService.getById(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (existingCustomer) {
      setFirstName(existingCustomer.first_name);
      setLastName(existingCustomer.last_name);
      setEmail(existingCustomer.email);
      setPhone(existingCustomer.phone || '');
      setDocumentNumber(existingCustomer.document_number || '');
      setState(existingCustomer.state);
    }
  }, [existingCustomer]);

  const createMutation = useMutation({
    mutationFn: (data: CreateCustomerDto) => CustomerService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      toastSuccess('Cliente creado exitosamente');
      router.back();
    },
    onError: () => toastError('Error al crear el cliente'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateCustomerDto) => CustomerService.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      toastSuccess('Cliente actualizado exitosamente');
      router.back();
    },
    onError: () => toastError('Error al actualizar el cliente'),
  });

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = 'El nombre es requerido';
    if (!lastName.trim()) newErrors.lastName = 'El apellido es requerido';
    if (!email.trim()) {
      newErrors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Ingresa un email válido';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const dto: CreateCustomerDto = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      document_number: documentNumber.trim() || undefined,
      state,
    };
    if (isEditing) {
      updateMutation.mutate(dto);
    } else {
      createMutation.mutate(dto);
    }
  };

  if (isEditing && loadingCustomer) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContent}>
          <View style={styles.row}>
            <View style={styles.flex1}>
              <Input
                label="Nombre *"
                value={firstName}
                onChangeText={setFirstName}
                error={errors.firstName}
                placeholder="Nombre"
              />
            </View>
            <View style={styles.flex1}>
              <Input
                label="Apellido *"
                value={lastName}
                onChangeText={setLastName}
                error={errors.lastName}
                placeholder="Apellido"
              />
            </View>
          </View>

          <Input
            label="Email *"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            placeholder="email@ejemplo.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Input
            label="Teléfono"
            value={phone}
            onChangeText={setPhone}
            placeholder="+57 300 123 4567"
            keyboardType="phone-pad"
          />

          <Input
            label="Número de documento"
            value={documentNumber}
            onChangeText={setDocumentNumber}
            placeholder="12345678"
          />

          <View style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Estado</Text>
            <View style={styles.rowGap2}>
              {STATE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setState(opt.value)}
                  style={[
                    styles.stateButton,
                    state === opt.value
                      ? styles.stateButtonActive
                      : styles.stateButtonInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.stateButtonText,
                      state === opt.value
                        ? styles.stateTextActive
                        : styles.stateTextInactive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={isEditing ? 'Guardar Cambios' : 'Crear Cliente'}
          onPress={handleSubmit}
          loading={createMutation.isPending || updateMutation.isPending}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  formContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  flex1: {
    flex: 1,
  },
  sectionGap: {
    gap: spacing[2],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  rowGap2: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  stateButton: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  stateButtonActive: {
    backgroundColor: colors.primary,
  },
  stateButtonInactive: {
    backgroundColor: colorScales.gray[100],
  },
  stateButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
  },
  stateTextActive: {
    color: colors.background,
  },
  stateTextInactive: {
    color: colorScales.gray[700],
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
});
