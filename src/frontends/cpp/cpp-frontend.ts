import { Parser, Language } from "web-tree-sitter";
import * as path from "node:path";
import { LanguageFrontend, GraphPatch } from "../frontend.js";
import { GraphNode, GraphEdge } from "../../graph/schema.js";
import { hashString } from "../../util/hashing.js";
import { resolveWasmPath } from "../../util/wasm-paths.js";
import { serializeNodeMetadata } from "../../graph/semantics.js";
import { inferSemanticTarget, normalizeSemanticTarget } from "../edge-targets.js";

export class CppFrontend implements LanguageFrontend {
  readonly language = "cpp";
  private parser: any = null;
  private initPromise: Promise<void> | null = null;

  supports(path: string): boolean {
    return /\.(cpp|cc|cxx|hpp|hh|hxx|h)$/.test(path);
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.parser) {
        await Parser.init();
        this.parser = new Parser();
        const wasmPath = await resolveWasmPath("tree-sitter-wasms/out/tree-sitter-cpp.wasm");
        const Lang = await Language.load(wasmPath);
        this.parser.setLanguage(Lang);
      }
    })();
    return this.initPromise;
  }

  async parseFile(path: string, content: string): Promise<GraphPatch> {
    try {
      await this.init();
      return this.parseContent(path, content);
    } catch {
      return this.parseContentFallback(path, content);
    }
  }

  private parseContent(filePath: string, content: string): GraphPatch {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

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
      confidence: number = 0.72,
    ) => {
      for (const target of extractCppTypeReferences(snippet)) {
        if (!target || target === fromId) continue;
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

    const processCallNode = (node: any, ownerId: string) => {
      const functionNode = node.childForFieldName("function");
      if (!functionNode) return;

      const calleeText = normalizeSemanticTarget(functionNode.text);
      if (!calleeText) return;

      const lowerCallee = calleeText.toLowerCase();
      const argsNode = node.childForFieldName("arguments");
      const primaryTarget = inferSemanticTarget(calleeText, argsNode?.text ?? calleeText);

      addEdge({
        id: `calls:${filePath}:${ownerId}:${node.startPosition.row}:${node.startPosition.column}`,
        from_id: ownerId,
        to_id: calleeText,
        kind: "calls",
        confidence: 0.8,
        metadata_json: null,
        source_file: filePath,
        source_start_line: node.startPosition.row + 1,
        source_end_line: node.endPosition.row + 1,
      });

      const addSemanticEdge = (kind: GraphEdge["kind"], suffix: string, confidence: number) => {
        if (!primaryTarget) return;
        addEdge({
          id: `${kind}:${filePath}:${ownerId}:${node.startPosition.row}:${node.startPosition.column}:${suffix}`,
          from_id: ownerId,
          to_id: primaryTarget,
          kind,
          confidence,
          metadata_json: null,
          source_file: filePath,
          source_start_line: node.startPosition.row + 1,
          source_end_line: node.endPosition.row + 1,
        });
      };

      if (/(read|get|load|fetch)/.test(lowerCallee)) addSemanticEdge("reads", "reads", 0.55);
      if (/(write|save|set|store|append|update)/.test(lowerCallee)) addSemanticEdge("writes", "writes", 0.55);
      if (/(publish|emit|dispatch|send)/.test(lowerCallee)) addSemanticEdge("publishes", "publishes", 0.6);
      if (/(subscribe|listen|consume|observe)/.test(lowerCallee)) addSemanticEdge("subscribes", "subscribes", 0.6);
      if (/(route|forward|redirect)/.test(lowerCallee)) addSemanticEdge("routes_to", "routes", 0.6);
    };

    const tree = this.parser!.parse(content);
    const rootNode = tree.rootNode;

    const isCompositeTypeDefinition = (node: any): boolean => {
      return node.children.some((child: any) => child.type === "field_declaration_list");
    };

    const traverse = (node: any, parentScope: string | null = null, ownerId: string = fileNodeId) => {
      let currentScope = parentScope;
      let currentOwnerId = ownerId;

      if (node.type === "class_specifier" || node.type === "struct_specifier") {
        if (!isCompositeTypeDefinition(node)) {
          for (const child of node.children) {
            traverse(child, currentScope);
          }
          return;
        }

        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = parentScope ? `${parentScope}::${name}` : name;
          const kind = node.type.split("_")[0]; // class or struct
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
            metadata_json: kind === "class" ? serializeNodeMetadata("class", { abstract: false }) : null,
          });
          currentScope = qualifiedName;
          currentOwnerId = id;

          const baseClause = node.children.find((c: any) => c.type === "base_class_clause");
          if (baseClause) {
            for (const child of baseClause.children) {
              if (child.type === "type_identifier" || child.type === "identifier") {
                const target = normalizeSemanticTarget(child.text);
                addEdge({
                  id: `extends:${id}:${target}`,
                  from_id: id,
                  to_id: target,
                  kind: "extends",
                  confidence: 1.0,
                  metadata_json: null,
                  source_file: filePath,
                  source_start_line: node.startPosition.row + 1,
                  source_end_line: node.endPosition.row + 1,
                });
                addEdge({
                  id: `depends_on:${id}:${target}:base`,
                  from_id: id,
                  to_id: target,
                  kind: "depends_on",
                  confidence: 0.85,
                  metadata_json: null,
                  source_file: filePath,
                  source_start_line: node.startPosition.row + 1,
                  source_end_line: node.endPosition.row + 1,
                });
              }
            }
          }

          emitTypeReferenceEdges(id, node.text, node.startPosition.row + 1, node.endPosition.row + 1, 0.75);

          if (parentScope) {
            addEdge({
              id: `defines:${filePath}:${parentScope}:${id}`,
              from_id: `namespace:${filePath}:${parentScope}`, // simplificaiton
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
      } else if (node.type === "function_definition") {
        const declaratorNode = node.childForFieldName("declarator");
        if (declaratorNode) {
          // A bit simplified, extracting identifier
          const nameNode = declaratorNode.children.find((c: any) => c.type === "identifier" || c.type === "field_identifier" || c.type === "scoped_identifier");
          if (nameNode) {
            const name = nameNode.text;
            const qualifiedName = name.includes("::") ? name : (parentScope ? `${parentScope}::${name}` : name);
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
            currentOwnerId = id;

            if (parentScope) {
              addEdge({
                id: `defines:${filePath}:${parentScope}:${id}`,
                from_id: `class:${filePath}:${parentScope}`,
                to_id: id,
                kind: "defines",
                confidence: 1.0,
                metadata_json: null,
                source_file: filePath,
                source_start_line: node.startPosition.row + 1,
                source_end_line: node.endPosition.row + 1,
              });
            }

            emitTypeReferenceEdges(id, declaratorNode.text, node.startPosition.row + 1, node.endPosition.row + 1);
          }
        }
      } else if (node.type === "call_expression") {
        processCallNode(node, currentOwnerId);
      } else if (node.type === "preproc_include") {
        const pathNode = node.childForFieldName("path");
        if (pathNode) {
          const includeTarget = normalizeIncludeTarget(filePath, pathNode.text);
          addEdge({
            id: `imports:${filePath}:${node.startPosition.row}:${node.startPosition.column}`,
            from_id: fileNodeId,
            to_id: includeTarget,
            kind: "imports",
            confidence: 1.0,
            metadata_json: null,
            source_file: filePath,
            source_start_line: node.startPosition.row + 1,
            source_end_line: node.endPosition.row + 1,
          });
          addEdge({
            id: `depends_on:${filePath}:${node.startPosition.row}:${node.startPosition.column}`,
            from_id: fileNodeId,
            to_id: includeTarget,
            kind: "depends_on",
            confidence: 0.9,
            metadata_json: null,
            source_file: filePath,
            source_start_line: node.startPosition.row + 1,
            source_end_line: node.endPosition.row + 1,
          });
        }
      }

      for (const child of node.children) {
        traverse(child, currentScope, currentOwnerId);
      }
    };

    traverse(rootNode);

    return { nodes, edges };
  }

  private parseContentFallback(filePath: string, content: string): GraphPatch {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
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
      if (nodeIds.has(node.id)) return;
      nodeIds.add(node.id);
      nodes.push(node);
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
    };

    const lines = content.split("\n");
    lines.forEach((line, index) => {
      const classMatch = line.match(/^\s*(class|struct)\s+([A-Za-z_]\w*)(?:\s*:\s*public\s+([A-Za-z_]\w*))?/);
      if (classMatch) {
        const kind = classMatch[1];
        const name = classMatch[2];
        const id = `${kind}:${filePath}:${name}`;
        addNode({
          id,
          language: this.language,
          kind,
          name,
          qualified_name: name,
          file_path: filePath,
          start_line: index + 1,
          end_line: index + 1,
          hash: hashString(line),
          summary: null,
          metadata_json: kind === "class" ? serializeNodeMetadata("class", { abstract: false }) : null,
        });

        if (classMatch[3]) {
          edges.push({
            id: `extends:${id}:${classMatch[3]}`,
            from_id: id,
            to_id: classMatch[3],
            kind: "extends",
            confidence: 1.0,
            metadata_json: null,
            source_file: filePath,
            source_start_line: index + 1,
            source_end_line: index + 1,
          });
        }
      }

      const functionMatch = line.match(/^\s*(?:[\w:<>~]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const)?\s*(?:\{|$)/);
      if (functionMatch && !line.includes("if ") && !line.includes("for ")) {
        const name = functionMatch[1];
        const id = `function:${filePath}:${name}`;
        addNode({
          id,
          language: this.language,
          kind: "function",
          name,
          qualified_name: name,
          file_path: filePath,
          start_line: index + 1,
          end_line: index + 1,
          hash: hashString(line),
          summary: null,
          metadata_json: serializeNodeMetadata("function", { async: false, exported: true }),
        });
      }

      const includeMatch = line.match(/^\s*#include\s+[<"]([^>"]+)[>"]/);
      if (includeMatch) {
        const includeTarget = normalizeIncludeTarget(filePath, includeMatch[1]);
        edges.push({
          id: `imports:${filePath}:${index + 1}`,
          from_id: fileNodeId,
          to_id: includeTarget,
          kind: "imports",
          confidence: 1.0,
          metadata_json: null,
          source_file: filePath,
          source_start_line: index + 1,
          source_end_line: index + 1,
        });
        edges.push({
          id: `depends_on:${filePath}:${index + 1}`,
          from_id: fileNodeId,
          to_id: includeTarget,
          kind: "depends_on",
          confidence: 0.8,
          metadata_json: null,
          source_file: filePath,
          source_start_line: index + 1,
          source_end_line: index + 1,
        });
      }
    });

    return { nodes, edges };
  }
}

function normalizeIncludeTarget(filePath: string, rawInclude: string): string {
  const include = rawInclude.replace(/^["<]/, "").replace(/[">]$/, "");
  if (include.startsWith(".")) {
    return path.resolve(path.dirname(filePath), include);
  }
  if (include.includes("/") && !include.startsWith("<")) {
    return path.resolve(path.dirname(filePath), include);
  }
  return include;
}

function extractCppTypeReferences(snippet: string): string[] {
  const excluded = new Set([
    "class",
    "struct",
    "enum",
    "public",
    "private",
    "protected",
    "virtual",
    "override",
    "const",
    "constexpr",
    "static",
    "inline",
    "typename",
    "template",
    "return",
    "void",
    "int",
    "long",
    "short",
    "float",
    "double",
    "bool",
    "char",
    "unsigned",
    "signed",
    "namespace",
    "signals",
    "slots",
    "emit",
  ]);
  const matches = snippet.match(/\b(?:[A-Z_]\w*(?:::\w+)*|std::\w+)\b/g) ?? [];
  return [...new Set(matches.map((item) => normalizeSemanticTarget(item)).filter((item) => item && !excluded.has(item)))];
}
