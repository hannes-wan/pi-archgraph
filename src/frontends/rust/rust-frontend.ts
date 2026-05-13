import { Parser, Language } from "web-tree-sitter";
import { LanguageFrontend, GraphPatch } from "../frontend.js";
import { GraphNode, GraphEdge } from "../../graph/schema.js";
import { hashString } from "../../util/hashing.js";
import { resolveWasmPath } from "../../util/wasm-paths.js";
import { serializeNodeMetadata } from "../../graph/semantics.js";
import { buildDependsOnEdgesFromText, inferSemanticTarget, ImportBinding, normalizeSemanticTarget } from "../edge-targets.js";

export class RustFrontend implements LanguageFrontend {
  readonly language = "rust";
  private parser: any = null;
  private initPromise: Promise<void> | null = null;

  supports(path: string): boolean {
    return path.endsWith(".rs");
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.parser) {
        await Parser.init();
        this.parser = new Parser();
        const wasmPath = await resolveWasmPath("tree-sitter-wasms/out/tree-sitter-rust.wasm");
        const Lang = await Language.load(wasmPath);
        this.parser.setLanguage(Lang);
      }
    })();
    return this.initPromise;
  }

  async parseFile(path: string, content: string): Promise<GraphPatch> {
    await this.init();
    return this.parseContent(path, content);
  }

  private parseContent(filePath: string, content: string): GraphPatch {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const importBindings: ImportBinding[] = [];

    const fileNodeId = `file:${filePath}`;
    nodes.push({
      id: fileNodeId,
      language: this.language,
      kind: "file",
      name: filePath.split("/").pop() || filePath,
      qualified_name: null,
      file_path: filePath,
      start_line: 1,
      end_line: content.split("\n").length,
      hash: null,
      summary: null,
      metadata_json: null,
    });

    const addNode = (node: GraphNode) => {
      if (!nodeIds.has(node.id)) {
        nodes.push(node);
        nodeIds.add(node.id);
        edges.push({
          id: `contains:${fileNodeId}:${node.id}`,
          from_id: fileNodeId,
          to_id: node.id,
          kind: "contains",
          confidence: 1.0,
          metadata_json: null,
          source_file: filePath,
          source_start_line: node.start_line,
          source_end_line: node.end_line,
        });
      }
    };

    const addEdge = (edge: GraphEdge) => {
      edges.push(edge);
    };

    const emitTypeReferenceEdges = (
      fromId: string,
      snippet: string,
      startLine: number,
      endLine: number,
      confidence: number = 0.72
    ) => {
      for (const target of extractRustTypeReferences(snippet)) {
        addEdge({
          id: `references:${fromId}:${target}:${startLine}:${endLine}`,
          from_id: fromId,
          to_id: target,
          kind: "references",
          confidence,
          metadata_json: null,
          source_file: filePath,
          source_start_line: startLine,
          source_end_line: endLine,
        });
        addEdge({
          id: `depends_on:${fromId}:${target}:${startLine}:${endLine}`,
          from_id: fromId,
          to_id: target,
          kind: "depends_on",
          confidence: confidence - 0.05,
          metadata_json: null,
          source_file: filePath,
          source_start_line: startLine,
          source_end_line: endLine,
        });
      }
    };

    const tree = this.parser!.parse(content);
    const rootNode = tree.rootNode;

    const traverse = (node: any, parentScope: string | null = null, ownerId: string = fileNodeId) => {
      let currentScope = parentScope;
      let currentOwnerId = ownerId;

      if (node.type === "struct_item" || node.type === "enum_item" || node.type === "trait_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = parentScope ? `${parentScope}::${name}` : name;
          const kind = node.type.replace("_item", ""); // struct, enum, trait
          const id = `${kind}:${filePath}:${qualifiedName}`;
          
          addNode({
            id,
            language: this.language,
            kind,
            name,
            qualified_name: qualifiedName,
            file_path: filePath,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            hash: hashString(node.text),
            summary: null,
            metadata_json: serializeNodeMetadata(kind, kind === "trait" ? { async: false } : null),
          });
          currentScope = qualifiedName;
          currentOwnerId = id;
          emitTypeReferenceEdges(id, node.text, node.startPosition.row + 1, node.endPosition.row + 1, 0.74);

          if (parentScope) {
            addEdge({
              id: `defines:${filePath}:${parentScope}:${id}`,
              from_id: `module:${filePath}:${parentScope}`,
              to_id: id,
              kind: "defines",
              confidence: 1.0,
              metadata_json: null,
              source_file: filePath,
              source_start_line: node.startPosition.row + 1,
              source_end_line: node.endPosition.row + 1,
            });
          }
        }
      } else if (node.type === "mod_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = parentScope ? `${parentScope}::${name}` : name;
          const id = `module:${filePath}:${qualifiedName}`;

          addNode({
            id,
            language: this.language,
            kind: "module",
            name,
            qualified_name: qualifiedName,
            file_path: filePath,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            hash: hashString(node.text),
            summary: null,
            metadata_json: null,
          });
          currentScope = qualifiedName;
        }
      } else if (node.type === "function_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = parentScope ? `${parentScope}::${name}` : name;
          const id = `function:${filePath}:${qualifiedName}`;

          addNode({
            id,
            language: this.language,
            kind: "function",
            name,
            qualified_name: qualifiedName,
            file_path: filePath,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            hash: hashString(node.text),
            summary: null,
            metadata_json: serializeNodeMetadata("function", { async: false, exported: parentScope === null }),
          });

          if (parentScope) {
            // Function inside impl or trait
            addEdge({
              id: `defines:${filePath}:${parentScope}:${id}`,
              from_id: `impl:${filePath}:${parentScope}`, // Simplification
              to_id: id,
              kind: "defines",
              confidence: 1.0,
              metadata_json: null,
              source_file: filePath,
              source_start_line: node.startPosition.row + 1,
              source_end_line: node.endPosition.row + 1,
            });
          }

          const lowerName = name.toLowerCase();
          if (/^handle_/.test(lowerName) || /^handle/.test(lowerName)) {
            const targetName = inferSemanticTarget(name, name.replace(/^handle_?/, "") || name);
            addEdge({
              id: `handles:${filePath}:${qualifiedName}`,
              from_id: id,
              to_id: targetName,
              kind: "handles",
              confidence: 0.7,
              metadata_json: null,
              source_file: filePath,
              source_start_line: node.startPosition.row + 1,
              source_end_line: node.endPosition.row + 1,
            });
          }

          const dependsOnEdges = buildDependsOnEdgesFromText(
            id,
            node.text,
            importBindings,
            {
              file: filePath,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            },
            `${filePath}:${qualifiedName}`
          );
          dependsOnEdges.forEach(addEdge);
          currentOwnerId = id;
          emitTypeReferenceEdges(id, node.text, node.startPosition.row + 1, node.endPosition.row + 1);
        }
      } else if (node.type === "impl_item") {
        const typeNode = node.childForFieldName("type");
        const traitNode = node.childForFieldName("trait");
        
          if (typeNode) {
          const typeName = typeNode.text;
          currentScope = typeName;
          emitTypeReferenceEdges(`impl:${filePath}:${typeName}`, node.text, node.startPosition.row + 1, node.endPosition.row + 1, 0.68);
          
          if (traitNode) {
            const traitName = traitNode.text;
            addEdge({
              id: `implements:${filePath}:${typeName}:${traitName}`,
              from_id: `struct:${filePath}:${typeName}`, // Assumption
              to_id: traitName,
              kind: "implements",
              confidence: 1.0,
              metadata_json: null,
              source_file: filePath,
              source_start_line: node.startPosition.row + 1,
              source_end_line: node.endPosition.row + 1,
            });
          }
        }
      } else if (node.type === "call_expression") {
        const functionNode = node.childForFieldName("function");
        if (functionNode) {
          const calleeText = functionNode.text;
          const lowerCallee = calleeText.toLowerCase();
          addEdge({
            id: `calls:${filePath}:${node.startPosition.row}:${node.startPosition.column}`,
            from_id: currentOwnerId,
            to_id: calleeText,
            kind: "calls",
            confidence: 0.8,
            metadata_json: null,
            source_file: filePath,
            source_start_line: node.startPosition.row + 1,
            source_end_line: node.endPosition.row + 1,
          });

          const argsNode = node.childForFieldName("arguments");
          const primaryTarget = inferSemanticTarget(calleeText, argsNode?.text ?? calleeText, importBindings);
          const addSemanticEdge = (kind: GraphEdge["kind"], suffix: string, target: string, confidence: number) => {
            addEdge({
              id: `${kind}:${filePath}:${node.startPosition.row}:${node.startPosition.column}:${suffix}`,
              from_id: currentOwnerId,
              to_id: target,
              kind,
              confidence,
              metadata_json: null,
              source_file: filePath,
              source_start_line: node.startPosition.row + 1,
              source_end_line: node.endPosition.row + 1,
            });
          };
          if (/(read|get|load|fetch)/.test(lowerCallee)) addSemanticEdge("reads", "reads", primaryTarget, 0.55);
          if (/(write|save|set|store|append|update)/.test(lowerCallee)) addSemanticEdge("writes", "writes", primaryTarget, 0.55);
          if (/(publish|emit|dispatch|send)/.test(lowerCallee)) addSemanticEdge("publishes", "publishes", primaryTarget, 0.6);
          if (/(subscribe|listen|consume|observe)/.test(lowerCallee)) addSemanticEdge("subscribes", "subscribes", primaryTarget, 0.6);
        }
      } else if (node.type === "field_expression") {
        const fieldTarget = normalizeSemanticTarget(node.text);
        if (fieldTarget && fieldTarget !== currentOwnerId) {
          addEdge({
            id: `references:${filePath}:${currentOwnerId}:${node.startPosition.row}:${node.startPosition.column}:field`,
            from_id: currentOwnerId,
            to_id: fieldTarget,
            kind: "references",
            confidence: 0.5,
            metadata_json: null,
            source_file: filePath,
            source_start_line: node.startPosition.row + 1,
            source_end_line: node.endPosition.row + 1,
          });
        }
      } else if (node.type === "use_declaration") {
        const bindings = extractRustUseBindings(node.text);
        for (const binding of bindings) {
          addEdge({
            id: `imports:${filePath}:${node.startPosition.row}:${node.startPosition.column}:${binding.localName}`,
            from_id: fileNodeId,
            to_id: binding.module,
            kind: "imports",
            confidence: 1.0,
            metadata_json: null,
            source_file: filePath,
            source_start_line: node.startPosition.row + 1,
            source_end_line: node.endPosition.row + 1,
          });
          addEdge({
            id: `depends_on:${filePath}:${node.startPosition.row}:${node.startPosition.column}:${binding.localName}`,
            from_id: fileNodeId,
            to_id: normalizeSemanticTarget(`${binding.module}::${binding.importedName}`),
            kind: "depends_on",
            confidence: 0.9,
            metadata_json: null,
            source_file: filePath,
            source_start_line: node.startPosition.row + 1,
            source_end_line: node.endPosition.row + 1,
          });
          importBindings.push(binding);
        }
      }

      for (const child of node.children) {
        traverse(child, currentScope, currentOwnerId);
      }
    };

    traverse(rootNode);

    return { nodes, edges };
  }
}

function extractRustUseBindings(statement: string): ImportBinding[] {
  const trimmed = statement.trim().replace(/^use\s+/, "").replace(/;$/, "");
  if (!trimmed) return [];

  const braceMatch = trimmed.match(/^(.*)::\{(.+)\}$/);
  if (braceMatch) {
    const prefix = braceMatch[1];
    return braceMatch[2]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => parseRustUseBinding(`${prefix}::${item}`));
  }

  return [parseRustUseBinding(trimmed)];
}

function parseRustUseBinding(pathText: string): ImportBinding {
  const aliasMatch = pathText.match(/^(.*?)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
  const importPath = aliasMatch?.[1]?.trim() ?? pathText.trim();
  const localName = aliasMatch?.[2] ?? importPath.split("::").pop() ?? importPath;
  const parts = importPath.split("::");
  const importedName = parts.pop() ?? importPath;
  const module = parts.join("::") || importedName;

  return {
    module,
    importedName,
    localName,
  };
}

function extractRustTypeReferences(snippet: string): string[] {
  const excluded = new Set([
    "Self",
    "Option",
    "Result",
    "Vec",
    "String",
    "Box",
    "Arc",
    "Rc",
    "Some",
    "None",
    "Ok",
    "Err",
  ]);
  const matches = snippet.match(/\b(?:[A-Z][A-Za-z0-9_]*|[a-z_][A-Za-z0-9_]*::[A-Z][A-Za-z0-9_]*)\b/g) ?? [];
  return [...new Set(matches.map((item) => normalizeSemanticTarget(item)).filter((item) => item && !excluded.has(item)))];
}
