import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
import type { CreateCustomerDto } from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, typography, colorScales, colors } from '@/shared/theme';

const SNAKE_TO_CAMEL: Record<string, string> = {
  first_name: 'firstName',
  last_name: 'lastName',
  document_number: 'documentNumber',
  email: 'email',
  phone: 'phone',
};

function parseApiError(err: unknown): { fieldErrors: Record<string, string>; summary: string } {
  const fieldErrors: Record<string, string> = {};
  let summary = 'Error al crear el cliente';

  const anyErr = err as { response?: { data?: { message?: unknown; details?: { validationErrors?: unknown } } }; message?: string };
  const data = anyErr?.response?.data;
  if (!data) {
    summary = anyErr?.message || summary;
    return { fieldErrors, summary };
  }

  const validationErrors = data?.details?.validationErrors;
  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    for (const raw of validationErrors) {
      const msg = String(raw);
      const snake = msg.match(/^(\w+)\b/)?.[1] ?? '';
      const camel = SNAKE_TO_CAMEL[snake];
      if (camel && !fieldErrors[camel]) fieldErrors[camel] = msg;
    }
    summary = validationErrors.length === 1 ? String(validationErrors[0]) : 'Revisa los campos marcados';
    return { fieldErrors, summary };
  }

  const message = data?.message;
  if (typeof message === 'string' && message.trim()) summary = message;
  else if (Array.isArray(message) && message.length > 0) summary = String(message[0]);
  return { fieldErrors, summary };
}

export default function CreateCustomerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: CreateCustomerDto) => CustomerService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      toastSuccess('Cliente creado exitosamente');
      router.back();
    },
    onError: (err) => {
      const { fieldErrors, summary } = parseApiError(err);
      setErrors((prev) => ({ ...prev, ...fieldErrors }));
      toastError(summary);
    },
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
    if (!documentNumber.trim()) newErrors.documentNumber = 'El documento es requerido';
    if (phone.trim() && !/^[\d+#*\s()-]+$/.test(phone.trim())) {
      newErrors.phone = 'El teléfono solo admite números y + # * ( ) -';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    setErrors({});
    if (!validate()) {
      toastError('Revisa los campos marcados');
      return;
    }
    const dto: CreateCustomerDto = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      document_number: documentNumber.trim(),
    };
    createMutation.mutate(dto);
  };

  const clearFieldError = (field: string) => {
    if (errors[field]) setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

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
                onChangeText={(v) => { setFirstName(v); clearFieldError('firstName'); }}
                error={errors.firstName}
                placeholder="Nombre"
              />
            </View>
            <View style={styles.flex1}>
              <Input
                label="Apellido *"
                value={lastName}
                onChangeText={(v) => { setLastName(v); clearFieldError('lastName'); }}
                error={errors.lastName}
                placeholder="Apellido"
              />
            </View>
          </View>

          <Input
            label="Email *"
            value={email}
            onChangeText={(v) => { setEmail(v); clearFieldError('email'); }}
            error={errors.email}
            placeholder="email@ejemplo.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Input
            label="Teléfono"
            value={phone}
            onChangeText={(v) => { setPhone(v); clearFieldError('phone'); }}
            error={errors.phone}
            placeholder="+57 300 123 4567"
            keyboardType="phone-pad"
          />

          <Input
            label="Número de documento *"
            value={documentNumber}
            onChangeText={(v) => { setDocumentNumber(v); clearFieldError('documentNumber'); }}
            error={errors.documentNumber}
            placeholder="12345678"
          />

          {Object.keys(errors).length > 0 && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerTitle}>Revisa los siguientes campos:</Text>
              {Object.values(errors).map((msg, i) => (
                <Text key={i} style={styles.errorBannerItem}>• {msg}</Text>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Crear Cliente"
          onPress={handleSubmit}
          loading={createMutation.isPending}
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
  errorBanner: {
    backgroundColor: colorScales.red[50],
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
    padding: spacing[3],
    gap: spacing[1],
  },
  errorBannerTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.error,
    marginBottom: spacing[1],
  },
  errorBannerItem: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
});
