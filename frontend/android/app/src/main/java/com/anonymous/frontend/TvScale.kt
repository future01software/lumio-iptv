package com.anonymous.frontend

import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager

/**
 * Makes every TV lay the UI out on the same 1600x900dp canvas.
 *
 * Android TV boxes pick wildly different densities for the same panel (a 1080p box may
 * report 320dpi = 960x540dp, 240dpi = 1280x720dp or 160dpi = 1920x1080dp), so the same
 * screen looks huge on one box and tiny on another. On TVs we override the density so the
 * window is always 1600x900dp (1280x720 reads too large from the couch, 1920x1080 too
 * small) - scaled to whatever the real resolution is. Phones and tablets are left untouched.
 *
 * The override is a Configuration (densityDpi only) on the Application and Activity base
 * contexts. An earlier version poked DisplayMetrics fields directly: Android resets those on
 * every configuration change (e.g. the startup landscape lock) and React Native reads density
 * from several contexts at different times, so layout (dp) and drawing (dp -> px) used
 * different densities and the UI rendered at ~2x, mostly off-screen. The system re-applies a
 * configuration override itself.
 */
object TvScale {
  private const val CANVAS_W = 1600f
  private const val CANVAS_H = 900f
  /** Text reads small from the couch on the 1600x900 canvas; enlarge text only, not layout. */
  private const val TV_TEXT_BOOST = 1.12f

  /**
   * Reads the UI mode from the context's own configuration rather than UiModeManager: in
   * attachBaseContext the base context isn't attached to a display yet, and on Android 16+
   * UiModeManager.getCurrentModeType() then crashes (NPE in Context.getDisplayId()), so the
   * app wouldn't start at all on new phones.
   */
  fun isTv(context: Context): Boolean {
    val mode = context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK
    if (mode == Configuration.UI_MODE_TYPE_TELEVISION) return true
    return context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
  }

  /**
   * Override carrying densityDpi and a boosted fontScale (the user's font size setting x
   * TV_TEXT_BOOST; every other field undefined, so orientation etc. keep following the
   * system), or null when not on a TV.
   */
  fun overrideConfiguration(base: Context): Configuration? = try {
    tvConfiguration(base)
  } catch (e: Exception) {
    // Scaling is cosmetic; never let it stop the app from launching.
    null
  }

  private fun tvConfiguration(base: Context): Configuration? {
    if (!isTv(base)) return null
    val (w, h) = realSize(base)
    if (w <= 0 || h <= 0) return null
    val density = minOf(maxOf(w, h) / CANVAS_W, minOf(w, h) / CANVAS_H)
    val dpi = (density * DisplayMetrics.DENSITY_DEFAULT).toInt()
    if (dpi <= 0) return null
    return Configuration().apply {
      fontScale = base.resources.configuration.fontScale * TV_TEXT_BOOST
      densityDpi = dpi
    }
  }

  /** The Application's base context with the TV density applied. */
  fun wrap(base: Context): Context {
    val config = overrideConfiguration(base) ?: return base
    return base.createConfigurationContext(config)
  }

  private fun realSize(context: Context): Pair<Float, Float> {
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val b = wm.maximumWindowMetrics.bounds
      b.width().toFloat() to b.height().toFloat()
    } else {
      val dm = DisplayMetrics()
      @Suppress("DEPRECATION")
      wm.defaultDisplay.getRealMetrics(dm)
      dm.widthPixels.toFloat() to dm.heightPixels.toFloat()
    }
  }
}
