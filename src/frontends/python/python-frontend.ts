import { Parser, Language } from "web-tree-sitter";
import { LanguageFrontend, GraphPatch } from "../frontend.js";
import { GraphNode, GraphEdge } from "../../graph/schema.js";
import { hashString } from "../../util/hashing.js";
import { resolveWasmPath } from "../../util/wasm-paths.js";
import { serializeNodeMetadata } from "../../graph/semantics.js";
import { buildDependsOnEdgesFromText, inferSemanticTarget, ImportBinding, normalizeSemanticTarget } from "../edge-targets.js";

export class PythonFrontend implements LanguageFrontend {
  readonly language = "python";
  private parser: any = null;
  private initPromise: Promise<void> | null = null;

  supports(path: string): boolean {
    return path.endsWith(".py");
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.parser) {
        await Parser.init();
        this.parser = new Parser();
        const wasmPath = await resolveWasmPath("tree-sitter-wasms/out/tree-sitter-python.wasm");
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
      confidence: number = 0.7
    ) => {
      for (const target of extractPythonTypeReferences(snippet)) {
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

    // Traverse AST
    const traverse = (node: any, parentScope: string | null = null, ownerId: string = fileNodeId) => {
      let currentScope = parentScope;
      let currentOwnerId = ownerId;

      if (node.type === "class_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = parentScope ? `${parentScope}.${name}` : name;
          const classId = `class:${filePath}:${qualifiedName}`;
          
          addNode({
            id: classId,
            language: this.language,
            kind: "class",
            name,
            qualified_name: qualifiedName,
            file_path: filePath,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            hash: hashString(node.text),
            summary: null,
            metadata_json: serializeNodeMetadata("class", { abstract: false }),
          });
          currentScope = qualifiedName;
          currentOwnerId = classId;
          emitTypeReferenceEdges(classId, node.text, node.startPosition.row + 1, node.endPosition.row + 1, 0.72);

          // Inheritance
          const superclassesNode = node.childForFieldName("superclasses");
          if (superclassesNode) {
            // Find all identifiers or attributes inside superclasses
            for (const child of superclassesNode.children) {
              if (child.type === "identifier" || child.type === "attribute") {
                addEdge({
                  id: `extends:${classId}:${child.text}`,
                  from_id: classId,
                  to_id: child.text,
                  kind: "extends",
                  confidence: 1.0,
                  metadata_json: null,
                  source_file: filePath,
                  source_start_line: node.startPosition.row + 1,
                  source_end_line: node.endPosition.row + 1,
                });
              }
            }
          }

          if (parentScope) {
            addEdge({
              id: `defines:class:${filePath}:${parentScope}:${classId}`,
              from_id: `class:${filePath}:${parentScope}`,
              to_id: classId,
              kind: "defines",
              confidence: 1.0,
              metadata_json: null,
              source_file: filePath,
              source_start_line: node.startPosition.row + 1,
              source_end_line: node.endPosition.row + 1,
            });
          }
        }
      } else if (node.type === "function_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = parentScope ? `${parentScope}.${name}` : name;
          const isMethod = parentScope !== null;
          const funcId = `${isMethod ? 'method' : 'function'}:${filePath}:${qualifiedName}`;

          addNode({
            id: funcId,
            language: this.language,
            kind: isMethod ? "method" : "function",
            name,
            qualified_name: qualifiedName,
            file_path: filePath,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            hash: hashString(node.text),
            summary: null,
            metadata_json: serializeNodeMetadata(isMethod ? "method" : "function", { async: false, exported: !isMethod }),
          });

          if (parentScope) {
            addEdge({
              id: `defines:class:${filePath}:${parentScope}:${funcId}`,
              from_id: `class:${filePath}:${parentScope}`,
              to_id: funcId,
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
              from_id: funcId,
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
            funcId,
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
          currentOwnerId = funcId;
          emitTypeReferenceEdges(funcId, node.text, node.startPosition.row + 1, node.endPosition.row + 1);
        }
      } else if (node.type === "call") {
        const functionNode = node.childForFieldName("function");
        if (functionNode) {
          const calleeText = functionNode.text;
          const lowerCallee = calleeText.toLowerCase();
          const argsNode = node.childForFieldName("arguments");
          const primaryTarget = inferSemanticTarget(calleeText, argsNode?.children.find((child: any) =>
            child.type !== "(" && child.type !== ")" && child.type !== ","
          )?.text ?? calleeText, importBindings);

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
      } else if (node.type === "attribute") {
        const attrTarget = normalizeSemanticTarget(node.text);
        if (attrTarget && attrTarget !== currentOwnerId) {
          addEdge({
            id: `references:${filePath}:${currentOwnerId}:${node.startPosition.row}:${node.startPosition.column}:attribute`,
            from_id: currentOwnerId,
            to_id: attrTarget,
            kind: "references",
            confidence: 0.5,
            metadata_json: null,
            source_file: filePath,
            source_start_line: node.startPosition.row + 1,
            source_end_line: node.endPosition.row + 1,
          });
        }
      } else if (node.type === "import_statement" || node.type === "import_from_statement") {
        const bindings = extractPythonImportBindings(node.text);
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

function extractPythonImportBindings(statement: string): ImportBinding[] {
  const trimmed = statement.trim();

  const fromMatch = trimmed.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+(.+)$/);
  if (fromMatch) {
    const module = fromMatch[1];
    const imported = fromMatch[2].split(",").map((item) => item.trim()).filter(Boolean);
    return imported.map((item) => {
      const aliasMatch = item.match(/^([A-Za-z0-9_\.]+)\s+as\s+([A-Za-z0-9_]+)$/);
      const importedName = aliasMatch?.[1] ?? item;
      const localName = aliasMatch?.[2] ?? importedName.split(".").pop() ?? importedName;
      return {
        module,
        importedName: importedName.split(".").pop() ?? importedName,
        localName,
      };
    });
  }

  const importMatch = trimmed.match(/^import\s+(.+)$/);
  if (!importMatch) return [];

  return importMatch[1].split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const aliasMatch = item.match(/^([A-Za-z0-9_\.]+)\s+as\s+([A-Za-z0-9_]+)$/);
    const module = aliasMatch?.[1] ?? item;
    const localName = aliasMatch?.[2] ?? module.split(".").pop() ?? module;
    return {
      module,
      importedName: module.split(".").pop() ?? module,
      localName,
    };
  });
}

function extractPythonTypeReferences(snippet: string): string[] {
  const excluded = new Set([
    "True",
    "False",
    "None",
    "self",
    "cls",
    "Optional",
    "List",
    "Dict",
    "Set",
    "Tuple",
  ]);
  const matches = snippet.match(/\b[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)?\b/g) ?? [];
  return [...new Set(matches.map((item) => normalizeSemanticTarget(item)).filter((item) => item && !excluded.has(item)))];
}
