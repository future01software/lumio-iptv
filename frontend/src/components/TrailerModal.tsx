import React from "react";
import { Modal, View, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, radius, colors } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";

let WebView: any = null;
try {
  WebView = require("react-native-webview").WebView;
} catch {
  WebView = null;
}

type Props = {
  visible: boolean;
  youtubeKey: string | null;
  onClose: () => void;
};

/** Embedded YouTube trailer playback - iframe on web (react-native-webview has no web
 * implementation), react-native-webview on native. */
export function TrailerModal({ visible, youtubeKey, onClose }: Props) {
  const { accentColor } = useTheme();
  if (!visible || !youtubeKey) return null;
  const embedUrl = `https://www.youtube.com/embed/${youtubeKey}?autoplay=1&playsinline=1&rel=0`;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.player}>
          {Platform.OS === "web"
            ? React.createElement("iframe", {
                src: embedUrl,
                style: { width: "100%", height: "100%", border: "none" },
                allow: "autoplay; encrypted-media; picture-in-picture",
                allowFullScreen: true,
              })
            : WebView
            ? (
              <WebView
                source={{ uri: embedUrl }}
                style={styles.webview}
                allowsFullscreenVideo
                mediaPlaybackRequiresUserAction={false}
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.loading}>
                    <ActivityIndicator color={accentColor} size="large" />
                  </View>
                )}
              />
            )
            : (
              <View style={styles.loading}>
                <ActivityIndicator color={accentColor} size="large" />
              </View>
            )}
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12} testID="trailer-close">
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  player: { width: "100%", maxWidth: 960, aspectRatio: 16 / 9, backgroundColor: "#000", borderRadius: radius.md, overflow: "hidden" },
  webview: { flex: 1, backgroundColor: "#000" },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  closeBtn: {
    position: "absolute", top: 10, right: 10, width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
  },
});
