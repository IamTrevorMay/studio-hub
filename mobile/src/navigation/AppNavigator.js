import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight } from '../utils/theme';

import DashboardScreen from '../screens/DashboardScreen';
import ProjectsScreen from '../screens/ProjectsScreen';
import ChannelsScreen from '../screens/ChannelsScreen';
import ChannelDetailScreen from '../screens/ChannelDetailScreen';
import MessagesScreen from '../screens/MessagesScreen';
import CalendarScreen from '../screens/CalendarScreen';
import MoreScreen from '../screens/MoreScreen';

const Tab = createBottomTabNavigator();
const ChannelStack = createNativeStackNavigator();

// ── Tab bar icon helper ──
function TabIcon({ label, focused, badge }) {
  return (
    <View style={iconStyles.container}>
      <View style={[iconStyles.dot, focused && iconStyles.dotActive]} />
      {badge > 0 && (
        <View style={iconStyles.badge}>
          <Text style={iconStyles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

// ── Channels stack (list → detail) ──
function ChannelsStackScreen() {
  return (
    <ChannelStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: fontWeight.semibold, fontSize: fontSize.lg },
      }}
    >
      <ChannelStack.Screen name="ChannelsList" component={ChannelsScreen} options={{ title: 'Channels' }} />
      <ChannelStack.Screen
        name="ChannelDetail"
        component={ChannelDetailScreen}
        options={({ route }) => ({ title: `#${route.params.channelName}` })}
      />
    </ChannelStack.Navigator>
  );
}

// ── Main tab navigator ──
export default function AppNavigator() {
  const { unreadNotificationCount, unreadMentionChannelIds } = useAuth();

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: fontWeight.semibold, fontSize: fontSize.lg },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: 4,
          height: 56,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: fontWeight.semibold },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="D" focused={focused} badge={unreadNotificationCount} />,
        }}
      />
      <Tab.Screen
        name="Projects"
        component={ProjectsScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="P" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Channels"
        component={ChannelsStackScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="C" focused={focused} badge={unreadMentionChannelIds.length} />
          ),
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="M" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Cal" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="..." focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

const iconStyles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', width: 24, height: 24 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textTertiary },
  dotActive: { backgroundColor: colors.primary, width: 8, height: 8, borderRadius: 4 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: colors.red,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 9, fontWeight: fontWeight.bold, color: '#fff' },
});
