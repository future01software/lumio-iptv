import { useEffect, useState } from "react";
import { useWindowDimensions, Platform } from "react-native";
import {
  detectNativeTV,
  isDesktopEnvironment,
  isNativeTVSync,
  isTVStyleLayout,
} from "@/src/utils/form-factor";

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const shortest = Math.min(width, height);
  const isTablet = shortest >= 600;

  const [isTV, setIsTV] = useState(isNativeTVSync);

  useEffect(() => {
    let active = true;
    detectNativeTV().then((tv) => {
      if (active) setIsTV(tv);
    });
    return () => {
      active = false;
    };
  }, []);

  // Netflix top bar: TV / Apple TV / desktop. Bottom tabs: phones & tablets.
  const isTVStyle = isTVStyleLayout(isTV);
  const isPhone = !isTVStyle && !isTablet;
  const isDesktop = isDesktopEnvironment();

  let posterCols = 3;
  if (isTVStyle) posterCols = 6;
  else if (isTablet) posterCols = 5;
  else if (isLandscape) posterCols = 5;

  return {
    width,
    height,
    isLandscape,
    isTablet,
    isPhone,
    isTV,
    isTVStyle,
    isDesktop,
    posterCols,
  };
}
