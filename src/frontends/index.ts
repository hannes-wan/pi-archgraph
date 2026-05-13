// Core interfaces
export { type LanguageFrontend, type GraphPatch } from "./frontend.js";

// Language detection
export { detectLanguage, isSupported, isHeaderFile } from "./detect.js";

// Frontend registry
export { FrontendRegistry } from "./registry.js";

// TypeScript frontend
export { TypeScriptFrontend } from "./typescript/index.js";

// C++ frontend
export { CppFrontend } from "./cpp/index.js";

// Rust frontend
export { RustFrontend } from "./rust/index.js";

// Python frontend
export { PythonFrontend } from "./python/index.js";

// C frontend
export { CFrontend } from "./c/index.js";

// Frontend manager - auto-registers all languages
import { TypeScriptFrontend } from "./typescript/index.js";
import { CppFrontend } from "./cpp/index.js";
import { RustFrontend } from "./rust/index.js";
import { PythonFrontend } from "./python/index.js";
import { CFrontend } from "./c/index.js";
import { FrontendRegistry } from "./registry.js";

export function createFrontendManager(): FrontendRegistry {
  const registry = new FrontendRegistry();

  // Register all built-in frontends
  registry.register(new TypeScriptFrontend());
  registry.register(new CppFrontend());
  registry.register(new RustFrontend());
  registry.register(new PythonFrontend());
  registry.register(new CFrontend());

  return registry;
}
