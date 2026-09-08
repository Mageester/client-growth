export const REPORT_THEME_OPTIONS = [
  {
    id: "studio",
    label: "Studio",
    description: "Warm paper, calm contrast, and the current Orbit look.",
    accent: "#217572",
    paper: "#fffefa",
    ink: "#18272f",
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "A considered paper-and-ink treatment for a more premium read.",
    accent: "#a4533c",
    paper: "#fffdf8",
    ink: "#302923",
  },
  {
    id: "signal",
    label: "Signal",
    description: "Crisp blue accents and a clear, modern presentation.",
    accent: "#315f9f",
    paper: "#fbfdff",
    ink: "#182a3d",
  },
] as const;

export type ReportTheme = (typeof REPORT_THEME_OPTIONS)[number]["id"];

export const DEFAULT_REPORT_THEME: ReportTheme = "studio";

export function isReportTheme(value: unknown): value is ReportTheme {
  return REPORT_THEME_OPTIONS.some((theme) => theme.id === value);
}

export function normalizeReportTheme(value: unknown): ReportTheme {
  return isReportTheme(value) ? value : DEFAULT_REPORT_THEME;
}

export function reportThemeOption(theme: unknown) {
  const normalized = normalizeReportTheme(theme);
  return REPORT_THEME_OPTIONS.find((option) => option.id === normalized)!;
}
