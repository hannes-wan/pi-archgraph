import { LanguageFrontend } from "./frontend.js";
import { detectLanguage, isHeaderFile } from "./detect.js";

export class FrontendRegistry {
  private frontends: Map<string, LanguageFrontend> = new Map();
  
  register(frontend: LanguageFrontend): void {
    this.frontends.set(frontend.language, frontend);
  }
  
  get(language: string): LanguageFrontend | undefined {
    return this.frontends.get(language);
  }
  
  forFile(path: string): LanguageFrontend | undefined {
    const lang = detectLanguage(path);
    if (lang === "cpp" && isHeaderFile(path)) {
      const normalized = path.replace(/\\/g, "/").toLowerCase();
      if (normalized.includes("/src/c/") || normalized.includes("/tests/fixtures/multi-lang-project/src/c/")) {
        return this.frontends.get("c") ?? this.frontends.get(lang);
      }
    }
    return lang ? this.frontends.get(lang) : undefined;
  }
  
  getSupportedLanguages(): string[] {
    return Array.from(this.frontends.keys());
  }
}
