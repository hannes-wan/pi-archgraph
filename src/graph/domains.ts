import * as path from "node:path";

const KNOWN_DOMAIN_SEGMENTS = [
  "runtime",
  "tools",
  "graph",
  "parsing",
  "orchestration",
  "indexing",
  "protocol",
  "core",
  "media",
  "ui",
  "app",
  "frontend",
  "frontends",
  "backend",
];

export function inferDomain(filePath: string): string {
  const parts = filePath.split(path.sep).filter(Boolean);
  for (const segment of parts.reverse()) {
    if (KNOWN_DOMAIN_SEGMENTS.includes(segment)) {
      return segment;
    }
  }

  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex >= 0 && srcIndex + 1 < parts.length) {
    return parts[srcIndex + 1];
  }

  return "workspace";
}

export function inferSubsystem(filePath: string): string {
  const parts = filePath.split(path.sep).filter(Boolean);
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex >= 0) {
    return parts.slice(srcIndex, Math.min(parts.length, srcIndex + 3)).join("/");
  }

  return parts.slice(Math.max(parts.length - 3, 0)).join("/");
}

export function buildClusterId(domain: string, subsystem: string): string {
  return `${domain}:${subsystem}`;
}
