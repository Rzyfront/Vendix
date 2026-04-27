import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { AuthService } from '@/core/auth/auth.service';
import { isValidEmail } from '@/core/utils/validators';
import { colors, authStyles as s } from '@/shared/styles/auth.styles';
import { Icon } from '@/shared/components/icon/icon';

export default function LoginScreen() {
  const router = useRouter();
  const [vlink, setVlink] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    if (!vlink.trim()) {
      setError('Por favor ingresa tu V-LINK (organización)');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Por favor ingresa un correo electrónico válido');
      return;
    }
    if (password.length < 1) {
      setError('Por favor ingresa tu contraseña');
      return;
    }
    setIsLoading(true);
    try {
      const response = await AuthService.login({
        email,
        password,
        ...(vlink ? { organization_slug: vlink } : {}),
      });
      const appType = response.user_settings?.app_type;
      if (appType === 'VENDIX_ADMIN') {
        router.replace('/(super-admin)/dashboard');
      } else if (appType === 'ORG_ADMIN') {
        router.replace('/(org-admin)/dashboard');
      } else {
        router.replace('/(store-admin)/dashboard');
      }
    } catch (err: unknown) {
      const resp = (err as any)?.response?.data;
      const raw = resp?.message || (err as any)?.message || 'Error al iniciar sesión. Intenta de nuevo.';
      const message = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(', ') : JSON.stringify(raw);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={s.logoContainer}>
          <Image
            source={require('@/assets/vlogo.png')}
            style={{ width: 64, height: 64, resizeMode: 'contain' }}
          />
          <Text style={s.brandText}>Vendix Platform</Text>
        </View>

        {/* Title */}
        <View style={s.titleContainer}>
          <Text style={s.title}>Iniciar Sesión</Text>
          <Text style={s.subtitle}>en Vendix Platform</Text>
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
            placeholder="Nombre o ID de tu organización"
            value={vlink}
            onChangeText={setVlink}
            editable={!isLoading}
          />

          <InputField
            label="EMAIL"
            placeholder="usuario@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />

          <InputField
            label="CONTRASEÑA"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            editable={!isLoading}
            rightIcon={
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.text.muted} />
              </TouchableOpacity>
            }
          />

          <TouchableOpacity
            style={[s.button, isLoading && s.buttonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.buttonText}>Iniciar Sesión</Text>
            )}
          </TouchableOpacity>

          <View style={s.linkContainer}>
            <Link href="/(auth)/forgot-password" asChild>
              <TouchableOpacity>
                <Text style={s.linkText}>¿Olvidaste tu contraseña?</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>

        {/* Back Link */}
        <View style={s.backLinkContainer}>
          <Link href="/" asChild>
            <TouchableOpacity>
              <Text style={s.backLinkText}>← Volver al inicio</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Register Link */}
        <View style={s.registerRow}>
          <Text style={s.registerText}>¿Necesitas una cuenta? </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity>
              <Text style={s.registerLinkText}>Regístrate</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Acceso a Vendix Platform</Text>
          <Text style={s.footerText}>Powered by Vendix</Text>
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
  keyboardType,
  autoCapitalize,
  autoCorrect,
  editable,
  rightIcon,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'phone-pad' | 'default';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
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
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rightIcon && <View style={s.inputRightIcon}>{rightIcon}</View>}
      </View>
    </View>
  );
}
