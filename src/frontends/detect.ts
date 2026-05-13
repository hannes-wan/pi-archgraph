// Language detection based on file extension
const EXTENSION_MAP: Record<string, string> = {
  // TypeScript
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",

  // JavaScript
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",

  // Rust
  ".rs": "rust",

  // Python
  ".py": "python",

  // C++
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c++": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".h": "cpp", // .h files default to C++ for compatibility

  // C
  ".c": "c",
};

export function detectLanguage(path: string): string | null {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

export function isSupported(path: string): boolean {
  return detectLanguage(path) !== null;
}

export function isHeaderFile(path: string): boolean {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return [".h", ".hpp", ".hh", ".hxx"].includes(ext);
}
