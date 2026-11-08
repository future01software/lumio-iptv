/** Upper-case Turkish label for a content kind, as shown under the player title. */
export function kindLabel(kind?: string | null): string {
  switch (kind) {
    case "movie":
      return "FİLM";
    case "series":
      return "DİZİ";
    case "live":
      return "CANLI";
    default:
      return kind ? kind.toLocaleUpperCase("tr-TR") : "";
  }
}
