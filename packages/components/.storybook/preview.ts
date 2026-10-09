// Self-hosted fonts: the family names ("Inter", "JetBrains Mono") match the
// type tokens, so stories render in the real faces rather than a fallback.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "../tailwind.css";
// activate the default theme scope so stories render themed and ThemeProof can read resolved colours
if (typeof document !== "undefined") document.documentElement.dataset.theme = "default";
export default { parameters: {} };
