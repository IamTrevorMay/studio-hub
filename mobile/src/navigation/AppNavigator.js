import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize } from '../utils/theme';

import DashboardScreen from '../screens/DashboardScreen';
import ProjectsScreen from '../screens/ProjectsScreen';
import ChannelsScreen from '../screens/ChannelsScreen';
import ChannelDetailScreen from '../screens/ChannelDetailScreen';
import MessagesScreen from '../screens/MessagesScreen';
import MessageDetailScreen from '../screens/MessageDetailScreen';
import CalendarScreen from '../screens/CalendarScreen';
import MoreScreen from '../screens/MoreScreen';
import AssetsScreen from '../screens/AssetsScreen';
import ReviewsScreen from '../screens/ReviewsScreen';
import ReviewDetailScreen from '../screens/ReviewDetailScreen';
import CreateScreen from '../screens/CreateScreen';
import ConceptDetailScreen from '../screens/ConceptDetailScreen';
import DocumentEditorScreen from '../screens/DocumentEditorScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import ResearchScreen from '../screens/ResearchScreen';
import GoalsScreen from '../screens/GoalsScreen';

const Tab = createBottomTabNavigator();
const ChannelStack = createNativeStackNavigator();
const MessageStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();

// ── SVG tab icons ──

function GridIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="3" width="7" height="7" rx="1" />
      <Rect x="14" y="3" width="7" height="7" rx="1" />
      <Rect x="3" y="14" width="7" height="7" rx="1" />
      <Rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  );
}

function FolderIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Svg>
  );
}

function HashIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9h16" />
      <Path d="M4 15h16" />
      <Path d="M10 3L8 21" />
      <Path d="M16 3l-2 18" />
    </Svg>
  );
}

function ChatIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  );
}

function CalendarIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <Path d="M16 2v4" />
      <Path d="M8 2v4" />
      <Path d="M3 10h18" />
    </Svg>
  );
}

function DotsIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx="5" cy="12" r="2" />
      <Circle cx="12" cy="12" r="2" />
      <Circle cx="19" cy="12" r="2" />
    </Svg>
  );
}

// ── Badge overlay ──
function TabIconWithBadge({ children, badge }) {
  return (
    <View style={iconStyles.container}>
      {children}
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
        headerTitleStyle: { fontWeight: '600', fontSize: fontSize.lg },
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

// ── Messages stack (list → detail) ──
function MessagesStackScreen() {
  return (
    <MessageStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600', fontSize: fontSize.lg },
      }}
    >
      <MessageStack.Screen name="MessagesList" component={MessagesScreen} options={{ title: 'Messages' }} />
      <MessageStack.Screen
        name="MessageDetail"
        component={MessageDetailScreen}
        options={({ route }) => ({ title: route.params.conversationName })}
      />
    </MessageStack.Navigator>
  );
}

// ── More stack (menu → sub-screens) ──
function MoreStackScreen() {
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600', fontSize: fontSize.lg },
      }}
    >
      <MoreStack.Screen name="MoreMenu" component={MoreScreen} options={{ title: 'More' }} />
      <MoreStack.Screen name="Assets" component={AssetsScreen} options={{ title: 'Assets' }} />
      <MoreStack.Screen name="Reviews" component={ReviewsScreen} options={{ title: 'Reviews' }} />
      <MoreStack.Screen
        name="ReviewDetail"
        component={ReviewDetailScreen}
        options={({ route }) => ({ title: route.params?.title || 'Review' })}
      />
      <MoreStack.Screen name="Create" component={CreateScreen} options={{ title: 'Create' }} />
      <MoreStack.Screen
        name="ConceptDetail"
        component={ConceptDetailScreen}
        options={({ route }) => ({ title: route.params?.name || 'Concept' })}
      />
      <MoreStack.Screen
        name="DocumentEditor"
        component={DocumentEditorScreen}
        options={({ route }) => ({ title: route.params?.title || 'Editor' })}
      />
      <MoreStack.Screen name="Analytics" component={AnalyticsScreen} options={{ title: 'Analytics' }} />
      <MoreStack.Screen name="Research" component={ResearchScreen} options={{ title: 'Research' }} />
      <MoreStack.Screen name="Goals" component={GoalsScreen} options={{ title: 'Goals' }} />
    </MoreStack.Navigator>
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
        headerTitleStyle: { fontWeight: '600', fontSize: fontSize.lg },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: 4,
          height: 56,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ color }) => (
            <TabIconWithBadge badge={unreadNotificationCount}>
              <GridIcon color={color} />
            </TabIconWithBadge>
          ),
        }}
      />
      <Tab.Screen
        name="Projects"
        component={ProjectsScreen}
        options={{
          tabBarIcon: ({ color }) => <FolderIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Channels"
        component={ChannelsStackScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <TabIconWithBadge badge={unreadMentionChannelIds.length}>
              <HashIcon color={color} />
            </TabIconWithBadge>
          ),
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesStackScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => <ChatIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          tabBarIcon: ({ color }) => <CalendarIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreStackScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => <DotsIcon color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

const iconStyles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', width: 28, height: 28 },
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
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
});
