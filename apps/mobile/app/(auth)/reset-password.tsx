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
import { colors, authStyles as s } from '@/shared/styles/auth.styles';
import { Icon } from '@/shared/components/icon/icon';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setIsLoading(true);
    try {
      await AuthService.resetPassword({ newPassword, token: '' });
      setSuccess(true);
    } catch (err: unknown) {
      const message =
        (err as any)?.response?.data?.message ||
        (err as any)?.message ||
        'Error al restablecer la contraseña. Intenta de nuevo.';
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
            <Text style={s.successTitle}>Contraseña Actualizada</Text>
            <Text style={s.successSubtitle}>
              Tu contraseña ha sido restablecida exitosamente.
            </Text>
            <View style={s.card}>
              <TouchableOpacity
                style={s.button}
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.8}
              >
                <Text style={s.buttonText}>Iniciar Sesión</Text>
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
            <Icon name="lock" size={28} color={colors.primary} />
          </View>
          <Text style={s.brandText}>Vendix</Text>
        </View>

        {/* Title */}
        <View style={s.titleContainer}>
          <Text style={s.title}>Restablecer Contraseña</Text>
          <Text style={s.subtitle}>Ingresa tu nueva contraseña.</Text>
        </View>

        {/* Form Card */}
        <View style={s.card}>
          {error && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <InputField
            label="NUEVA CONTRASEÑA"
            placeholder="••••••••"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showNewPassword}
            helperText="Mín. 8 caracteres, 1 mayúscula, 1 número y 1 especial"
            editable={!isLoading}
            rightIcon={
              <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
                <Icon name={showNewPassword ? 'eye-off' : 'eye'} size={20} color={colors.text.muted} />
              </TouchableOpacity>
            }
          />

          <InputField
            label="CONFIRMAR NUEVA CONTRASEÑA"
            placeholder="••••••••"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
            editable={!isLoading}
            rightIcon={
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                <Icon name={showConfirmPassword ? 'eye-off' : 'eye'} size={20} color={colors.text.muted} />
              </TouchableOpacity>
            }
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
              <Text style={s.buttonText}>Restablecer Contraseña</Text>
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
  secureTextEntry,
  helperText,
  editable,
  rightIcon,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  helperText?: string;
  editable?: boolean;
  rightIcon?: React.ReactNode;
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
          secureTextEntry={secureTextEntry}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rightIcon && <View style={s.inputRightIcon}>{rightIcon}</View>}
      </View>
      {helperText && (
        <Text style={s.helperText}>{helperText}</Text>
      )}
    </View>
  );
}
