import { View, Text, type ViewProps } from 'react-native';
import { Card } from '../card/card';

interface StatsCardProps extends ViewProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: number; positive: boolean };
  className?: string;
}

export function StatsCard({
  label,
  value,
  icon,
  trend,
  className = '',
  ...props
}: StatsCardProps) {
  return (
    <Card className={`p-4 ${className}`} {...props}>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-gray-500 font-medium">{label}</Text>
        {icon && (
          <View className="w-8 h-8 rounded-full bg-primary-50 items-center justify-center">
            {icon}
          </View>
        )}
      </View>
      <Text className="text-2xl font-bold text-gray-900 mt-2">{value}</Text>
      {trend && (
        <View className="flex-row items-center mt-1">
          <Text
            className={`text-sm font-medium ${
              trend.positive ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {trend.positive ? '+' : ''}
            {trend.value}%
          </Text>
          <Text className="text-sm text-gray-400 ml-1">vs last period</Text>
        </View>
      )}
    </Card>
  );
}
