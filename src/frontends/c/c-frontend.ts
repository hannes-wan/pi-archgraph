import { Parser, Language } from "web-tree-sitter";
import { LanguageFrontend, GraphPatch } from "../frontend.js";
import { GraphNode, GraphEdge } from "../../graph/schema.js";
import { hashString } from "../../util/hashing.js";
import { resolveWasmPath } from "../../util/wasm-paths.js";
import { serializeNodeMetadata } from "../../graph/semantics.js";
import { inferSemanticTarget, normalizeSemanticTarget } from "../edge-targets.js";
import * as path from "node:path";

export class CFrontend implements LanguageFrontend {
  readonly language = "c";
  private parser: any = null;
  private initPromise: Promise<void> | null = null;

  supports(path: string): boolean {
    return /\.(c|h)$/i.test(path) && 
           !path.endsWith(".cpp") && 
           !path.endsWith(".hpp") &&
           !path.endsWith(".cc") &&
           !path.endsWith(".hh") &&
           !path.endsWith(".cxx") &&
           !path.endsWith(".hxx");
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.parser) {
        await Parser.init();
        this.parser = new Parser();
        const wasmPath = await resolveWasmPath("tree-sitter-wasms/out/tree-sitter-c.wasm");
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
      for (const target of extractCTypeReferences(snippet)) {
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

    const traverse = (node: any, ownerId: string = fileNodeId) => {
      let currentOwnerId = ownerId;
      if (node.type === "struct_specifier" || node.type === "union_specifier" || node.type === "enum_specifier") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          const kind = node.type.split("_")[0]; // struct, union, enum
          const id = `${kind}:${filePath}:${name}`;
          
          addNode({
            id,
            language: this.language,
            kind,
            name,
            qualified_name: name,
            file_path: filePath,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            hash: hashString(node.text),
            summary: null,
            metadata_json: null,
          });
          currentOwnerId = id;
          emitTypeReferenceEdges(id, node.text, node.startPosition.row + 1, node.endPosition.row + 1, 0.75);
        }
      } else if (node.type === "type_definition") {
        const declaratorNode = node.childForFieldName("declarator");
        if (declaratorNode) {
          const typeNameNode = declaratorNode.type === "type_identifier" 
            ? declaratorNode 
            : declaratorNode.children.find((c: any) => c.type === "type_identifier" || c.type === "identifier");
            
          if (typeNameNode) {
            const name = typeNameNode.text;
            const id = `type:${filePath}:${name}`;
            addNode({
              id,
              language: this.language,
              kind: "type",
              name,
              qualified_name: name,
              file_path: filePath,
              start_line: node.startPosition.row + 1,
              end_line: node.endPosition.row + 1,
              hash: hashString(node.text),
              summary: null,
              metadata_json: serializeNodeMetadata("function", { async: false, exported: true }),
            });
            currentOwnerId = id;
            emitTypeReferenceEdges(id, node.text, node.startPosition.row + 1, node.endPosition.row + 1, 0.7);
          }
        }
      } else if (node.type === "function_definition") {
        const declaratorNode = node.childForFieldName("declarator");
        if (declaratorNode) {
          const nameNode = declaratorNode.children.find((c: any) => c.type === "identifier");
          if (nameNode) {
            const name = nameNode.text;
            const id = `function:${filePath}:${name}`;

            addNode({
              id,
              language: this.language,
              kind: "function",
              name,
              qualified_name: name,
              file_path: filePath,
              start_line: node.startPosition.row + 1,
              end_line: node.endPosition.row + 1,
              hash: hashString(node.text),
              summary: null,
              metadata_json: null,
            });
            currentOwnerId = id;
            emitTypeReferenceEdges(id, declaratorNode.text, node.startPosition.row + 1, node.endPosition.row + 1);
          }
        }
      } else if (node.type === "call_expression") {
        const functionNode = node.childForFieldName("function");
        if (functionNode) {
          const calleeText = normalizeSemanticTarget(functionNode.text);
          if (!calleeText) {
            for (const child of node.children) {
              traverse(child, currentOwnerId);
            }
            return;
          }
          const lowerCallee = calleeText.toLowerCase();
          const argsNode = node.childForFieldName("arguments");
          const primaryTarget = inferSemanticTarget(calleeText, argsNode?.text ?? calleeText);
          addEdge({
            id: `calls:${filePath}:${currentOwnerId}:${node.startPosition.row}:${node.startPosition.column}`,
            from_id: currentOwnerId,
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
              id: `${kind}:${filePath}:${currentOwnerId}:${node.startPosition.row}:${node.startPosition.column}:${suffix}`,
              from_id: currentOwnerId,
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
        }
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
        traverse(child, currentOwnerId);
      }
    };

    traverse(rootNode);

    return { nodes, edges };
  }
}

function normalizeIncludeTarget(filePath: string, rawInclude: string): string {
  const include = rawInclude.replace(/^["<]/, "").replace(/[">]$/, "");
  if (include.startsWith(".")) {
    return path.resolve(path.dirname(filePath), include);
  }
  if (include.includes("/")) {
    return path.resolve(path.dirname(filePath), include);
  }
  return include;
}

function extractCTypeReferences(snippet: string): string[] {
  const excluded = new Set([
    "struct",
    "union",
    "enum",
    "typedef",
    "const",
    "static",
    "inline",
    "extern",
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
    "size_t",
  ]);

  const matches = snippet.match(/\b[A-Z_]\w*\b/g) ?? [];
  return [...new Set(matches.map((item) => normalizeSemanticTarget(item)).filter((item) => item && !excluded.has(item)))];
}
