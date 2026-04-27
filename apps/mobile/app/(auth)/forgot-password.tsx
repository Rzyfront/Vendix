import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { AuthService } from '@/core/auth/auth.service';
import { isValidEmail } from '@/core/utils/validators';
import { colors, authStyles as s } from '@/shared/styles/auth.styles';
import { Icon } from '@/shared/components/icon/icon';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [vlink, setVlink] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!isValidEmail(email)) {
      setError('Por favor ingresa un correo electrónico válido');
      return;
    }
    setIsLoading(true);
    try {
      await AuthService.forgotPassword({ email });
      setSuccess(true);
    } catch (err: unknown) {
      const message =
        (err as any)?.response?.data?.message ||
        (err as any)?.message ||
        'Error al enviar el correo. Intenta de nuevo.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.successContainer}>
            <View style={s.successIcon}>
              <Icon name="check" size={32} color={colors.primary} />
            </View>
            <Text style={s.successTitle}>Correo Enviado</Text>
            <Text style={s.successSubtitle}>
              Hemos enviado las instrucciones de recuperación a tu correo electrónico.
            </Text>
            <View style={s.card}>
              <TouchableOpacity
                style={s.button}
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.8}
              >
                <Text style={s.buttonText}>Volver a Iniciar Sesión</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Icon */}
        <View style={s.logoContainer}>
          <View style={s.iconContainer}>
            <Icon name="key-round" size={28} color={colors.primary} />
          </View>
          <Text style={s.brandText}>Vendix</Text>
        </View>

        {/* Title */}
        <View style={s.titleContainer}>
          <Text style={s.title}>Recuperar Contraseña</Text>
          <Text style={s.subtitle}>
            Ingresa tu Vlink y email para recibir instrucciones.
          </Text>
        </View>

        {/* Form Card */}
        <View style={s.card}>
          {error && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <InputField
            label="V-LINK"
            placeholder="mi-organizacion"
            value={vlink}
            onChangeText={setVlink}
            editable={!isLoading}
          />

          <InputField
            label="EMAIL DE PROPIETARIO"
            placeholder="propietario@empresa.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />

          <TouchableOpacity
            style={[s.button, isLoading && s.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.buttonText}>Enviar Instrucciones</Text>
            )}
          </TouchableOpacity>

          <View style={s.linkContainer}>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={s.linkText}>← Volver a Iniciar Sesión</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  editable,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'email-address' | 'phone-pad' | 'default';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  editable?: boolean;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text style={s.inputLabel}>{label}</Text>
      <View
        style={[
          s.inputContainer,
          focused && s.inputContainerFocused,
        ]}
      >
        <TextInput
          style={s.input}
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </View>
  );
}
