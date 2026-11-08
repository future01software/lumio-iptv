import React, { useEffect } from 'react';
import { StyleSheet, Platform } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming, 
  withDelay,
  runOnJS,
  Easing,
  ReduceMotion,
} from 'react-native-reanimated';

// Many Android TV boxes ship with system animations switched off (animator scale 0),
// which Reanimated treats as "reduce motion" and jumps straight to the end - the intro
// then never plays. It's a one-off ~2s brand moment, so always run it.
const NEVER = ReduceMotion.Never;

interface Props {
  isAppReady: boolean;
  onFinish: () => void;
}

export const AnimatedIntro: React.FC<Props> = ({ isAppReady, onFinish }) => {
  const letterOpacity = useSharedValue(0);
  const letterScale = useSharedValue(0.5);
  const containerOpacity = useSharedValue(1);

  const [minTimePassed, setMinTimePassed] = React.useState(false);
  // On Android the app behind the overlay is still mounting when isAppReady flips, and
  // on low-end TV boxes that pegs the UI thread (200-400ms frames) so the whole zoom-out
  // collapses into a couple of frames. Wait until that work has settled first.
  const [settled, setSettled] = React.useState(Platform.OS === 'web');
  const [exiting, setExiting] = React.useState(false);
  const finishedRef = React.useRef(false);
  // Parent passes a fresh inline onFinish each render; keep finishOnce stable so
  // the exit effect below doesn't restart (and re-arm its timer) on every render.
  const onFinishRef = React.useRef(onFinish);
  onFinishRef.current = onFinish;
  const finishOnce = React.useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishRef.current();
  }, []);

  useEffect(() => {
    // 1. Pop in immediately on mount
    letterOpacity.value = withTiming(1, { duration: 1000, easing: Easing.out(Easing.exp), reduceMotion: NEVER });
    letterScale.value = withTiming(1, { duration: 1500, easing: Easing.out(Easing.exp), reduceMotion: NEVER });

    // Animasyonun içeri girme (pop-in) süresi yaklaşık 1000ms. 
    // Bu yüzden en az 1200ms beklemeliyiz ki 'l' harfi görünebilsin.
    const timer = setTimeout(() => setMinTimePassed(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isAppReady || settled) return;
    // A plain timer, not InteractionManager: Home keeps an interaction handle open while
    // it streams its rows in, which left runAfterInteractions (and this overlay) hanging.
    // The delay lets the first screen's heavy initial mount finish before the zoom starts.
    const timer = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(timer);
  }, [isAppReady, settled]);

  // Last-resort guard: whatever happens, never leave the full-screen overlay up.
  useEffect(() => {
    const timer = setTimeout(finishOnce, 8000);
    return () => clearTimeout(timer);
  }, [finishOnce]);

  useEffect(() => {
    // 2. Netflix style massive zoom-out and fade when app is fully ready
    if (isAppReady && minTimePassed && settled) {
      setExiting(true);
      // Scale up massively towards the screen (slower)
      letterScale.value = withTiming(35, { duration: 1600, easing: Easing.in(Easing.exp), reduceMotion: NEVER });
      // Fade out the letter (slower)
      letterOpacity.value = withTiming(0, { duration: 1400, easing: Easing.in(Easing.exp), reduceMotion: NEVER });
      
      // Fade out the black background container shortly after the zoom starts
      containerOpacity.value = withDelay(
        700, 
        withTiming(0, { duration: 1000, reduceMotion: NEVER }, (finished) => {
          if (finished) {
            runOnJS(finishOnce)();
          }
        }),
        NEVER
      );
      // Reanimated on web runs on requestAnimationFrame, which Chromium stops
      // while the window is hidden/occluded - the fade then freezes and its
      // completion callback may never fire, leaving this full-screen overlay
      // on top of the app. Always remove it on a plain timer as well.
      const fallback = setTimeout(finishOnce, 2000);
      return () => clearTimeout(fallback);
    }
  }, [isAppReady, minTimePassed, settled, finishOnce]);

  const letterStyle = useAnimatedStyle(() => {
    return {
      opacity: letterOpacity.value,
      transform: [{ scale: letterScale.value }],
    };
  });

  const containerStyle = useAnimatedStyle(() => {
    return {
      opacity: containerOpacity.value,
    };
  });

  return (
    // Once the exit starts the overlay must never swallow clicks, even mid-fade.
    <Animated.View style={[styles.container, containerStyle]} pointerEvents={exiting ? "none" : "auto"}>
      {/* Rasterize the glowing letter once and scale that GPU texture: re-drawing a
          text shadow at up to 35x every frame drops the zoom-out to a frame or two on
          low-end Android TV boxes, so the animation looked like it never played. */}
      <Animated.View style={letterStyle} renderToHardwareTextureAndroid shouldRasterizeIOS>
        <Animated.Text style={styles.letter}>l</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  letter: {
    fontSize: 220,
    fontWeight: '900',
    color: '#E50914', // Netflix Red
    fontFamily: 'System',
    includeFontPadding: false,
    textShadowColor: 'rgba(229, 9, 20, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 30,
  }
});
