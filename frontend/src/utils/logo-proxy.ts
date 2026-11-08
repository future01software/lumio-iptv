import CryptoJS from "crypto-js";
import { API, USE_LOCAL_PROVIDER } from "@/src/services/backend";

function base64UrlEncode(input: string): string {
  const base64 = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(input));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Routes a channel logo through our own backend instead of loading it directly.
 * Several free logo hosts (lyngsat-logo.com and similar) 403 a direct hotlink from
 * the app because it sends no Referer they recognize; the backend retries with the
 * image's own origin as Referer, which satisfies that check for most of them.
 */
export function buildLogoProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  // Native builds have no backend to proxy through: load the logo directly.
  if (USE_LOCAL_PROVIDER) return url;
  return `${API}/logo-proxy?u=${base64UrlEncode(url)}`;
}
