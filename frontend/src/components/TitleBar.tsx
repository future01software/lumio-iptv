import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/theme-store';

export function TitleBar() {
  const { accentColor } = useTheme();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sadece Web / Electron ortamında render et
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  const electronAPI = (window as any).electronAPI;
  if (!electronAPI) {
    return null; // Eğer electronAPI yoksa (sadece web tarayıcısıysa) titlebar göstermeye gerek yok
  }

  useEffect(() => {
    electronAPI.onWindowMaximizeChange((maximized: boolean) => {
      setIsMaximized(maximized);
    });
    electronAPI.onFullscreenChange((fullscreen: boolean) => {
      setIsFullscreen(fullscreen);
    });
  }, []);

  if (isFullscreen) {
    return null;
  }

  // macOS çizer kendi pencere düğmelerini (sol üst), bu yüzden onlara yer bırak
  const isMac = electronAPI.platform === 'darwin';

  return (
    <View style={styles.container}>
      {/* Drag region */}
      <View style={[styles.dragRegion, isMac && styles.dragRegionMac]}>
        <Text style={[styles.title, { color: accentColor }]}>Lumio IPTV</Text>
      </View>

      {/* Window Controls (No Drag) */}
      {!isMac && (
      <View style={styles.controls}>
        <Pressable 
          style={({ hovered }) => [styles.controlButton, hovered && styles.hovered]} 
          onPress={() => electronAPI.windowControl('minimize')}
        >
          <Ionicons name="remove" size={16} color="#FFF" />
        </Pressable>
        <Pressable 
          style={({ hovered }) => [styles.controlButton, hovered && styles.hovered]} 
          onPress={() => electronAPI.windowControl('maximize')}
        >
          <Ionicons name={isMaximized ? "copy-outline" : "square-outline"} size={14} color="#FFF" />
        </Pressable>
        <Pressable 
          style={({ hovered }) => [styles.controlButton, styles.closeButton, hovered && styles.closeHovered]} 
          onPress={() => electronAPI.windowControl('close')}
        >
          <Ionicons name="close" size={16} color="#FFF" />
        </Pressable>
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 32,
    backgroundColor: '#0a0a0a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 9999,
  },
  dragRegion: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    paddingLeft: 16,
    // @ts-ignore
    appRegion: 'drag', // Electron spesifik
  },
  dragRegionMac: {
    paddingLeft: 80,
  },
  title: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  controls: {
    flexDirection: 'row',
    height: '100%',
    // @ts-ignore
    appRegion: 'no-drag',
  },
  controlButton: {
    width: 46,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hovered: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  closeButton: {
    // Kapanma butonu hover rengi (kırmızımsı)
  },
  closeHovered: {
    backgroundColor: '#E81123',
  }
});
