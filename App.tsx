import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import {
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold,
} from '@expo-google-fonts/barlow-condensed';
import { Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import HomeScreen from './src/screens/HomeScreen';
import TrackingScreen from './src/screens/TrackingScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ShareScreen from './src/screens/ShareScreen';
import AccountScreen from './src/screens/AccountScreen';
import { colors } from './src/theme';
import { loadProfile } from './src/lib/storage';
import { setUnits } from './src/lib/units';

export type RootStackParamList = {
  Home: undefined;
  Tracking: { sport: 'run' | 'walk' };
  History: undefined;
  Activity: { id: string };
  Share: { id: string };
  Account: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [loaded] = useFonts({
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // the chosen distance unit is applied before the first screen renders, so nothing flashes in km
  const [unitsReady, setUnitsReady] = useState(false);
  useEffect(() => {
    loadProfile()
      .then((p) => setUnits(p.units))
      .catch(() => {})
      .finally(() => setUnitsReady(true));
  }, []);
  if (!loaded || !unitsReady) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={{ ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg } }}>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen
            name="Tracking"
            component={TrackingScreen}
            options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
          />
          <Stack.Screen name="History" component={HistoryScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Activity" component={ActivityScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Share" component={ShareScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="Account" component={AccountScreen} options={{ animation: 'slide_from_right' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
