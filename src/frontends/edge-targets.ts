import { GraphEdge } from "../graph/schema.js";

export interface ImportBinding {
  module: string;
  importedName: string;
  localName: string;
}

export function normalizeSemanticTarget(rawTarget: string): string {
  return rawTarget
    .trim()
    .replace(/^["'`]/, "")
    .replace(/["'`]$/, "")
    .replace(/^await\s+/, "")
    .replace(/^new\s+/, "")
    .replace(/^this\./, "")
    .replace(/^this->/, "")
    .replace(/^self\./, "")
    .replace(/^self->/, "")
    .replace(/^crate::/, "")
    .replace(/^super::/, "")
    .replace(/^&/, "")
    .replace(/^::/, "")
    .replace(/\(\)/g, "")
    .replace(/->/g, ".")
    .replace(/::\{.*\}$/, "")
    .replace(/\(.*\)$/, "")
    .trim();
}

export function extractSymbolCandidates(rawTarget: string): string[] {
  const normalized = normalizeSemanticTarget(rawTarget);
  if (!normalized) return [];

  const candidates = new Set<string>([normalized]);
  const dotParts = normalized.split(".");
  const scopeParts = normalized.split("::");
  const slashParts = normalized.split("/");

  if (dotParts.length > 1) candidates.add(dotParts[dotParts.length - 1]);
  if (scopeParts.length > 1) candidates.add(scopeParts[scopeParts.length - 1]);
  if (slashParts.length > 1) candidates.add(slashParts[slashParts.length - 1]);

  return [...candidates].filter(Boolean);
}

export function inferSemanticTarget(
  calleeText: string,
  rawTarget?: string,
  bindings: ImportBinding[] = []
): string {
  const normalized = normalizeSemanticTarget(rawTarget && rawTarget.length > 0 ? rawTarget : calleeText);
  const fallback = normalizeSemanticTarget(calleeText);
  return resolveBindingTarget(normalized || fallback, bindings) ?? (normalized || fallback);
}

export function buildDependsOnEdgesFromText(
  ownerId: string,
  ownerText: string,
  bindings: ImportBinding[],
  source: { file: string; startLine: number; endLine: number },
  idPrefix: string
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const emitted = new Set<string>();

  for (const binding of bindings) {
    const localPattern = new RegExp(`\\b${escapeRegExp(binding.localName)}\\b`);
    if (!localPattern.test(ownerText)) continue;

    const target = inferSemanticTarget(
      binding.localName,
      binding.importedName && binding.importedName !== binding.localName
        ? `${binding.module}::${binding.importedName}`
        : `${binding.module}::${binding.localName}`,
      bindings
    );
    const edgeId = `depends_on:${idPrefix}:${binding.localName}:${binding.importedName}`;
    if (emitted.has(edgeId)) continue;
    emitted.add(edgeId);

    edges.push({
      id: edgeId,
      from_id: ownerId,
      to_id: target,
      kind: "depends_on",
      confidence: 0.85,
      metadata_json: null,
      source_file: source.file,
      source_start_line: source.startLine,
      source_end_line: source.endLine,
    });
  }

  return edges;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveBindingTarget(target: string, bindings: ImportBinding[]): string | null {
  if (!target || bindings.length === 0) return null;

  const directBinding = bindings.find((binding) => binding.localName === target || target.endsWith(`::${binding.importedName}`));
  if (directBinding) {
    const suffix = target.endsWith(`::${directBinding.importedName}`)
      ? target.slice(target.lastIndexOf(`::${directBinding.importedName}`) + `::${directBinding.importedName}`.length)
      : target.slice(directBinding.localName.length);
    return `${normalizeBindingTarget(directBinding)}${suffix}`;
  }

  for (const binding of bindings) {
    if (!target.startsWith(binding.localName)) continue;
    const boundary = target.charAt(binding.localName.length);
    if (boundary !== "." && boundary !== ":" && boundary !== "") continue;
    const suffix = target.slice(binding.localName.length);
    return `${normalizeBindingTarget(binding)}${suffix}`;
  }

  return null;
}

function normalizeBindingTarget(binding: ImportBinding): string {
  const imported = binding.importedName && binding.importedName !== binding.localName
    ? binding.importedName
    : binding.localName;
  return normalizeSemanticTarget(`${binding.module}::${imported}`);
}
