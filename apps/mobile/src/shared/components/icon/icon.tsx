import { View } from 'react-native';
import {
  ShoppingCart,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  User,
  Mail,
  Phone,
  Building2,
  Store,
  Package,
  Receipt,
  Warehouse,
  Users,
  FileText,
  Calculator,
  Wallet,
  BarChart3,
  Settings,
  Shield,
  Bot,
  Activity,
  CreditCard,
  Home,
  LogOut,
  Check,
} from 'lucide-react-native';
import { colors } from '@/shared/theme/colors';

const iconMap: Record<string, typeof ShoppingCart> = {
  'shopping-cart': ShoppingCart,
  'key-round': KeyRound,
  lock: Lock,
  eye: Eye,
  'eye-off': EyeOff,
  'arrow-left': ArrowLeft,
  user: User,
  mail: Mail,
  phone: Phone,
  building: Building2,
  store: Store,
  package: Package,
  receipt: Receipt,
  warehouse: Warehouse,
  users: Users,
  'file-text': FileText,
  calculator: Calculator,
  wallet: Wallet,
  'bar-chart': BarChart3,
  settings: Settings,
  shield: Shield,
  bot: Bot,
  activity: Activity,
  'credit-card': CreditCard,
  home: Home,
  logout: LogOut,
  check: Check,
};

interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 24, color = colors.text.primary }: IconProps) {
  const LucideIcon = iconMap[name];
  if (!LucideIcon) {
    return <View style={{ width: size, height: size }} />;
  }
  return <LucideIcon size={size} color={color} strokeWidth={2} />;
}
