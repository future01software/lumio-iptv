import { Tabs, useFocusEffect, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, StyleSheet, View, Text, findNodeHandle, BackHandler, ToastAndroid } from "react-native";
import { BlurView } from "expo-blur";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { useProfiles } from "@/src/store/profile-store";
import { colors, spacing, font, screenBackground } from "@/src/theme/tokens";
import { forwardRef, useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { useResponsive } from "@/src/hooks/use-responsive";
import { ProfileAvatar } from "@/src/components/profile/ProfileAvatar";
import { ProfileSwitcher } from "@/src/components/profile/ProfileSwitcher";
import { FocusPressable } from "@/src/components/FocusPressable";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

const isTVRail = Platform.OS !== "web";
const RAIL_COLLAPSED = 68;
const RAIL_EXPANDED = 208;
// TVs crop a few percent off every edge (overscan); keep the rail clear of it.
const TV_SAFE_LEFT = 24;

type RailFocus = { onFocus?: () => void; onBlur?: () => void };
type RailNav = { nextFocusDown?: number | null; nextFocusUp?: number | null; hasTVPreferredFocus?: boolean };

const RailButton = forwardRef<View, {
  icon: ComponentProps<typeof Ionicons>["name"]; label: string; active?: boolean; expanded: boolean;
  onPress: () => void; testID?: string;
} & RailFocus & RailNav>(function RailButton(
  { icon, label, active, expanded, onPress, testID, onFocus, onBlur, nextFocusDown, nextFocusUp, hasTVPreferredFocus },
  ref,
) {
  const { accentColor } = useTheme();
  return (
    <FocusPressable
      ref={ref}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      testID={testID}
      {...({ nextFocusDown: nextFocusDown ?? undefined, nextFocusUp: nextFocusUp ?? undefined, hasTVPreferredFocus } as any)}
      style={({ hovered, focused }: any) => [
        styles.railButtonRow,
        // On TV the active tab is only a soft tint until the remote is on it, so the
        // solid accent pill always marks where focus is (no extra white ring needed).
        active && { backgroundColor: isTVRail && !focused ? accentColor + "55" : accentColor },
        (hovered || focused) && !active && { backgroundColor: "rgba(255,255,255,0.12)" },
      ]}
    >
      {({ focused }: any) => {
        const solid = active && (!isTVRail || focused);
        return (
          <>
            <View style={styles.railIconSlot}>
              <Ionicons name={icon} size={22} color={solid ? "#000" : active ? "#fff" : "#9CA3AF"} />
            </View>
            {expanded && (
              <Text style={[styles.railLabel, active && { fontWeight: "700" }, solid && { color: "#000" }]} numberOfLines={1}>{label}</Text>
            )}
          </>
        );
      }}
    </FocusPressable>
  );
});

/** Nuvio-style navigation rail: collapsed to icon-only (68px, matches Nuvio's real
 * DesktopSidebarCollapsedWidth), expands to 208px with labels on hover (Nuvio: 192px
 * DesktopSidebarExpandedWidth) and shrinks back when the pointer leaves.
 *
 * Uses plain onMouseEnter/onMouseLeave (not Pressable's onHoverIn/onHoverOut, which map to
 * the bubbling onMouseOver/onMouseOut) - the rail nests many interactive RailButtons, and
 * bubbling hover events flicker on/off as the pointer crosses between them. mouseenter/
 * mouseleave don't bubble, so hover state stays true for the whole container regardless of
 * which child the pointer is over.
 *
 * On Android TV there is no pointer: the rail expands while any of its buttons holds the
 * remote's focus (like NuvioTV's sidebar) and collapses once focus moves into the content.
 */
function Sidebar({ onExpandedChange, shift }: { onExpandedChange?: (v: boolean) => void; shift?: SharedValue<number> }) {
  // Expanded state lives here, not in TabsLayout: lifting it re-rendered the whole tab
  // navigator (and the heavy Home screen) every time focus entered or left the rail,
  // which is what made the rail stutter on TV. Only desktop needs to tell the parent,
  // to slide the content over.
  const [hovered, setHoveredState] = useState(false);
  const setHovered = (v: boolean) => {
    setHoveredState(v);
    onExpandedChange?.(v);
    // TV: push the content over on the UI thread; no React re-render of the tabs.
    if (shift) {
      shift.value = withTiming(v ? RAIL_EXPANDED - RAIL_COLLAPSED : 0, { duration: 160, reduceMotion: ReduceMotion.Never });
    }
  };
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const activeProfile = useProfiles((s) => s.active());
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const navItems = [
    { name: "index", path: "/", icon: "home", label: t("tab.home") },
    { name: "live", path: "/live", icon: "tv", label: t("tab.live") },
    { name: "movies", path: "/movies", icon: "film", label: t("tab.movies") },
    { name: "series", path: "/series", icon: "albums", label: t("tab.series") },
  ] as const;

  const isTV = Platform.OS !== "web";
  const activeKey =
    pathname === "/search" ? "search"
    : pathname === "/more" || pathname === "/(tabs)/more" ? "settings"
    : navItems.find((i) => pathname === i.path || pathname === `/(tabs)${i.path === "/" ? "/index" : i.path}`)?.name ?? "index";

  // Moving focus between two rail buttons fires blur then focus; only collapse if no
  // rail button has picked the focus back up by the next tick.
  const focusCount = useRef(0);
  // Focus moving between two rail buttons blurs one before focusing the next, so the
  // count briefly hits 0; `inRail` only clears once the delayed collapse confirms focus
  // really left, which is what tells "entering from the content" apart.
  const inRail = useRef(false);
  // When the remote enters the rail from the content, Android lands on whichever button
  // is geometrically nearest (often Settings at the bottom). Send it to the active tab,
  // the way NuvioTV's sidebar does, by flipping that button's hasTVPreferredFocus on.
  const [preferred, setPreferred] = useState<string | null>(null);
  useEffect(() => {
    if (!preferred) return;
    const t = setTimeout(() => setPreferred(null), 50);
    return () => clearTimeout(t);
  }, [preferred]);
  const railFocus = (key: string): RailFocus => ({
    onFocus: () => {
      const entering = !inRail.current;
      inRail.current = true;
      focusCount.current += 1;
      setHovered(true);
      if (isTV && entering && key !== activeKey) setPreferred(activeKey);
    },
    onBlur: () => {
      focusCount.current = Math.max(0, focusCount.current - 1);
      setTimeout(() => {
        if (focusCount.current === 0) {
          inRail.current = false;
          setHovered(false);
        }
      }, 0);
    },
  });

  // The gap between the last tab and Settings is wider than the gap to the content, so
  // D-pad down from "Diziler" jumped into the page. Wire the two together explicitly.
  const lastNavRef = useRef<View>(null);
  const settingsRef = useRef<View>(null);
  const [tags, setTags] = useState<{ last?: number | null; settings?: number | null }>({});
  useEffect(() => {
    // nextFocus* only exists on Android TV; react-native-web throws on findNodeHandle.
    if (Platform.OS === "web") return;
    setTags({ last: findNodeHandle(lastNavRef.current), settings: findNodeHandle(settingsRef.current) });
  }, []);

  // Collapse after navigating (Nuvio does the same): otherwise the expanded rail
  // stays floating over the newly opened screen until the mouse leaves it.
  useEffect(() => {
    setHovered(false);
  }, [pathname]);


  return (
    <View
      style={[
        styles.sidebarContainer,
        {
          width: (hovered ? RAIL_EXPANDED : RAIL_COLLAPSED) + (isTV ? TV_SAFE_LEFT : 0),
          paddingLeft: 12 + (isTV ? TV_SAFE_LEFT : 0),
          ...(Platform.OS === "web" && {
            transitionProperty: "width",
            transitionDuration: "160ms",
            transitionTimingFunction: "ease-out",
          }),
        } as any,
      ]}
      // @ts-ignore - web-only, see comment above
      onMouseEnter={() => setHovered(true)}
      // @ts-ignore
      onMouseLeave={() => setHovered(false)}
    >
      <FocusPressable
        onPress={() => setSwitcherOpen(true)}
        {...railFocus("profile")}
        style={({ focused }: any) => [styles.railButtonRow, focused && { backgroundColor: "rgba(255,255,255,0.12)" }]}
        testID="rail-profile"
      >
        <View style={styles.railIconSlot}>
          <ProfileAvatar avatar={activeProfile?.avatar} color={activeProfile?.color} size={32} />
        </View>
        {hovered && <Text style={styles.railLabel} numberOfLines={1}>{activeProfile?.name || "Profil"}</Text>}
      </FocusPressable>

      <View style={styles.sidebarNav}>
        <RailButton
          icon="search"
          label="Ara"
          active={pathname === "/search"}
          expanded={hovered}
          onPress={() => router.push("/search")}
          testID="rail-search"
          {...railFocus("search")}
          hasTVPreferredFocus={preferred === "search"}
        />
        {navItems.map((item) => {
          const isActive = pathname === item.path || pathname === `/(tabs)${item.path === "/" ? "/index" : item.path}`;
          return (
            <RailButton
              key={item.name}
              ref={item.name === "series" ? lastNavRef : undefined}
              nextFocusDown={item.name === "series" ? tags.settings : undefined}
              hasTVPreferredFocus={preferred === item.name}
              icon={item.icon}
              label={item.label}
              active={isActive}
              expanded={hovered}
              onPress={() => router.replace(item.path as any)}
              testID={`rail-${item.name}`}
              {...railFocus(item.name)}
            />
          );
        })}
      </View>

      <RailButton
        ref={settingsRef}
        nextFocusUp={tags.last}
        hasTVPreferredFocus={preferred === "settings"}
        icon="settings-outline"
        label={t("tab.settings")}
        active={pathname === "/more" || pathname === "/(tabs)/more"}
        expanded={hovered}
        onPress={() => router.push("/more")}
        testID="rail-settings"
        {...railFocus("settings")}
      />
      <ProfileSwitcher visible={switcherOpen} anchorLeft={RAIL_COLLAPSED + 8 + (isTV ? TV_SAFE_LEFT : 0)} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}

/**
 * Back on the top-level tabs. They are the root of the stack, so Android's default was to
 * close the app - on a TV remote that's where Back is pressed most ("go back a menu").
 * Other tabs go to Home; on Home the first press only warns, a second one within 2s exits.
 * Only active while the tabs are on screen, so detail pages and the player keep normal Back.
 */
function useTabsBack() {
  const pathname = usePathname();
  const router = useRouter();
  const lastPress = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (pathname !== "/" && pathname !== "/index") {
          router.replace("/");
          return true;
        }
        const now = Date.now();
        if (now - lastPress.current < 2000) return false; // let Android close the app
        lastPress.current = now;
        ToastAndroid.show("Çıkmak için Geri tuşuna tekrar basın", ToastAndroid.SHORT);
        return true;
      });
      return () => sub.remove();
    }, [pathname, router]),
  );
}

export default function TabsLayout() {
  useTabsBack();
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const { isTVStyle, isTV } = useResponsive();
  const isWeb = Platform.OS === 'web';
  // Desktop and TV share the Nuvio rail; phones/tablets keep the bottom tab bar.
  const showRail = isWeb || isTV;
  const [railHovered, setRailHovered] = useState(false);
  const railShift = useSharedValue(0);
  const shiftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: railShift.value }] }));

  return (
    <View style={{ flex: 1, backgroundColor: screenBackground, flexDirection: showRail ? "row" : "column", overflow: "hidden" }}>
      {/* Only a fixed collapsed-width slot takes part in layout. When the rail
          expands, the content is pushed right with a GPU transform instead of a
          width change: nothing gets covered, and the screens (with their big
          poster grids) are never re-laid-out mid-animation, which made it stutter. */}
      {showRail && (
        <View style={{ width: RAIL_COLLAPSED + (isWeb ? 0 : TV_SAFE_LEFT), zIndex: 50 }}>
          <Sidebar onExpandedChange={isWeb ? setRailHovered : undefined} shift={isWeb ? undefined : railShift} />
        </View>
      )}
      <Animated.View
        style={[
          { flex: 1 },
          // TV: pushed by a Reanimated shared value on the UI thread (see Sidebar), so
          // entering/leaving the rail never re-renders the tabs and their screens.
          !isWeb && shiftStyle,
          isWeb &&
            ({
              transform: [{ translateX: railHovered ? RAIL_EXPANDED - RAIL_COLLAPSED : 0 }],
              transitionProperty: "transform",
              transitionDuration: "160ms",
              transitionTimingFunction: "ease-out",
            } as any),
        ]}
      >
        <Tabs
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: screenBackground },
            tabBarActiveTintColor: accentColor,
            tabBarInactiveTintColor: "#9CA3AF",
            tabBarStyle: (isTVStyle || showRail) ? { display: "none" } : {
              position: "absolute",
              borderTopWidth: 0,
              backgroundColor: Platform.OS === "android" ? "rgba(10,10,10,0.95)" : "transparent",
              elevation: 0,
              height: 88,
              paddingTop: 8,
              width: "100%",
              maxWidth: 600,
              alignSelf: "center",
            },
            tabBarBackground: () =>
              (isTVStyle || showRail) ? null : Platform.OS === "ios" ? (
                <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,10,0.95)" }]} />
              ),
            tabBarLabelStyle: { fontSize: 11, fontWeight: "600", marginTop: 2 },
          }}
        >
        <Tabs.Screen name="index" options={{ title: t("tab.home"), tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
        <Tabs.Screen name="live" options={{ title: t("tab.live"), tabBarIcon: ({ color, size }) => <Ionicons name="tv" size={size} color={color} /> }} />
        <Tabs.Screen name="movies" options={{ title: t("tab.movies"), tabBarIcon: ({ color, size }) => <Ionicons name="film" size={size} color={color} /> }} />
        <Tabs.Screen name="series" options={{ title: t("tab.series"), tabBarIcon: ({ color, size }) => <Ionicons name="albums" size={size} color={color} /> }} />
        <Tabs.Screen name="more" options={{ title: t("tab.more"), tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" size={size} color={color} /> }} />
      </Tabs>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebarContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#050505',
    borderRightWidth: 1,
    borderRightColor: '#1A1A1A',
    paddingVertical: 20,
    paddingHorizontal: 12,
    overflow: 'hidden',
    zIndex: 10,
  },
  sidebarNav: {
    flex: 1,
    gap: 6,
    marginTop: 24,
  },
  railButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 12,
    marginBottom: 6,
  },
  railIconSlot: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railLabel: {
    color: '#fff',
    fontSize: font.base,
    fontWeight: '600',
    marginLeft: 2,
  },
});
