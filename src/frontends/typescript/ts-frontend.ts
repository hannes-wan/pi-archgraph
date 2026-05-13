import { Project, Node, SyntaxKind, SourceFile, TypeAliasDeclaration, EnumDeclaration, PropertyDeclaration, GetAccessorDeclaration, SetAccessorDeclaration, ConstructorDeclaration, ParameterDeclaration } from "ts-morph";
import { LanguageFrontend, GraphPatch } from "../frontend.js";
import { GraphNode, GraphEdge } from "../../graph/schema.js";
import { hashString } from "../../util/hashing.js";
import { serializeNodeMetadata } from "../../graph/semantics.js";
import { buildDependsOnEdgesFromText, inferSemanticTarget, ImportBinding } from "../edge-targets.js";

export class TypeScriptFrontend implements LanguageFrontend {
  readonly language = "typescript";

  private project: Project | null = null;

  supports(path: string): boolean {
    return path.endsWith(".ts") || path.endsWith(".tsx");
  }

  async parseFile(path: string, content: string): Promise<GraphPatch> {
    if (!this.project) {
      this.project = new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
          target: 7, // ES2020
          module: 99, // ESNext
        },
      });
    }

    let sourceFile = this.project.getSourceFile(path);
    if (!sourceFile) {
      sourceFile = this.project.addSourceFileAtPath(path);
    }

    return this.indexSourceFile(sourceFile);
  }

  private indexSourceFile(sourceFile: SourceFile): GraphPatch {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    const filePath = sourceFile.getFilePath();
    const fileNodeId = `file:${filePath}`;

    // Add file node
    nodes.push({
      id: fileNodeId,
      language: this.language,
      kind: "file",
      name: sourceFile.getBaseName(),
      qualified_name: null,
      file_path: filePath,
      start_line: 1,
      end_line: sourceFile.getEndLineNumber(),
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

    // Track symbol-to-node mappings for imports/calls resolution
    const symbolToNode = new Map<string, string>();
    const importBindings: ImportBinding[] = [];

    // Collect imports first
    sourceFile.getImportDeclarations().forEach((importDecl) => {
      const moduleSpec = importSpecToString(importDecl);
      if (moduleSpec) {
        const namedImports = importDecl.getNamedImports();
        namedImports.forEach((named) => {
          importBindings.push({
            module: moduleSpec,
            importedName: named.getName(),
            localName: named.getAliasNode()?.getText() ?? named.getName(),
          });
        });
        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport) {
          importBindings.push({
            module: moduleSpec,
            importedName: "default",
            localName: defaultImport.getText(),
          });
        }
        addEdge({
          id: `imports:${filePath}:${importDecl.getStartLineNumber()}:${importDecl.getStart()}`,
          from_id: fileNodeId,
          to_id: moduleSpec,
          kind: "imports",
          confidence: 1.0,
          metadata_json: null,
          source_file: filePath,
          source_start_line: importDecl.getStartLineNumber(),
          source_end_line: importDecl.getEndLineNumber(),
        });
        addEdge({
          id: `depends_on:${filePath}:${importDecl.getStartLineNumber()}:${importDecl.getStart()}`,
          from_id: fileNodeId,
          to_id: moduleSpec,
          kind: "depends_on",
          confidence: 0.9,
          metadata_json: null,
          source_file: filePath,
          source_start_line: importDecl.getStartLineNumber(),
          source_end_line: importDecl.getEndLineNumber(),
        });
      }
    });

    // Process top-level declarations
    sourceFile.forEachChild((node) => {
      if (Node.isClassDeclaration(node)) {
        this.processClassDeclaration(node, filePath, addNode, addEdge, symbolToNode, importBindings);
      } else if (Node.isFunctionDeclaration(node)) {
        this.processFunctionDeclaration(node, filePath, addNode, addEdge, symbolToNode, importBindings);
      } else if (Node.isInterfaceDeclaration(node)) {
        this.processInterfaceDeclaration(node, filePath, addNode, addEdge, symbolToNode, importBindings);
      } else if (Node.isTypeAliasDeclaration(node)) {
        this.processTypeAliasDeclaration(node, filePath, addNode);
      } else if (Node.isEnumDeclaration(node)) {
        this.processEnumDeclaration(node, filePath, addNode);
      } else if (Node.isVariableStatement(node)) {
        this.processVariableStatement(node, filePath, addNode);
      }
    });

    return { nodes, edges };
  }

  private processClassDeclaration(
    node: import("ts-morph").ClassDeclaration,
    filePath: string,
    addNode: (n: GraphNode) => void,
    addEdge: (e: GraphEdge) => void,
    symbolToNode: Map<string, string>,
    importBindings: ImportBinding[]
  ): void {
    const name = node.getName();
    if (!name || !node.isExported()) return;

    const classId = `class:${filePath}:${name}`;
    addNode({
      id: classId,
      language: this.language,
      kind: "class",
      name,
      qualified_name: name,
      file_path: filePath,
      start_line: node.getStartLineNumber(),
      end_line: node.getEndLineNumber(),
      hash: hashString(node.getText()),
      summary: null,
      metadata_json: serializeNodeMetadata("class", { abstract: node.isAbstract() }),
    });

    symbolToNode.set(name, classId);

    // Extends edge
    const extendsType = node.getExtends();
    if (extendsType) {
      const baseName = extendsType.getText();
      addEdge({
        id: `extends:${classId}:${baseName}`,
        from_id: classId,
        to_id: baseName,
        kind: "extends",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: node.getStartLineNumber(),
        source_end_line: node.getEndLineNumber(),
      });
    }

    // Implements edges
    const implementsTypes = node.getImplements();
    implementsTypes.forEach((implType) => {
      const interfaceName = implType.getText();
      addEdge({
        id: `implements:${classId}:${interfaceName}`,
        from_id: classId,
        to_id: interfaceName,
        kind: "implements",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: node.getStartLineNumber(),
        source_end_line: node.getEndLineNumber(),
      });
    });

    // Process class members
    this.processClassMembers(node, name, filePath, addNode, addEdge, symbolToNode, importBindings);
    this.buildDependsOnEdges(classId, node.getText(), importBindings, filePath, node.getStartLineNumber(), node.getEndLineNumber(), addEdge);
  }

  private processClassMembers(
    classNode: import("ts-morph").ClassDeclaration,
    className: string,
    filePath: string,
    addNode: (n: GraphNode) => void,
    addEdge: (e: GraphEdge) => void,
    symbolToNode: Map<string, string>,
    importBindings: ImportBinding[]
  ): void {
    const classId = `class:${filePath}:${className}`;

    classNode.getMethods().forEach((method) => {
      const methodName = method.getName();
      const qualifiedName = `${className}.${methodName}`;
      const methodId = `method:${filePath}:${qualifiedName}`;
      addNode({
        id: methodId,
        language: this.language,
        kind: "method",
        name: methodName,
        qualified_name: qualifiedName,
        file_path: filePath,
        start_line: method.getStartLineNumber(),
        end_line: method.getEndLineNumber(),
        hash: hashString(method.getText()),
        summary: null,
        metadata_json: serializeNodeMetadata("method", { async: method.isAsync(), exported: false }),
      });

      symbolToNode.set(qualifiedName, methodId);
      addEdge({
        id: `defines:${classId}:${methodId}`,
        from_id: classId,
        to_id: methodId,
        kind: "defines",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: method.getStartLineNumber(),
        source_end_line: method.getEndLineNumber(),
      });

      // Process method calls
      this.processCallExpressions(method, filePath, methodId, addEdge, importBindings);
      this.buildDependsOnEdges(methodId, method.getText(), importBindings, filePath, method.getStartLineNumber(), method.getEndLineNumber(), addEdge);
    });

    classNode.getProperties().forEach((prop) => {
      const propName = prop.getName();
      const qualifiedName = `${className}.${propName}`;
      const propId = `property:${filePath}:${qualifiedName}`;
      addNode({
        id: propId,
        language: this.language,
        kind: "property",
        name: propName,
        qualified_name: qualifiedName,
        file_path: filePath,
        start_line: prop.getStartLineNumber(),
        end_line: prop.getEndLineNumber(),
        hash: hashString(prop.getText()),
        summary: null,
        metadata_json: null,
      });

      symbolToNode.set(qualifiedName, propId);
      addEdge({
        id: `defines:${classId}:${propId}`,
        from_id: classId,
        to_id: propId,
        kind: "defines",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: prop.getStartLineNumber(),
        source_end_line: prop.getEndLineNumber(),
      });
    });

    // Getter/setter
    classNode.getGetAccessors().forEach((getter) => {
      const getterName = getter.getName() ?? "get";
      const qualifiedName = `${className}.get${capitalize(getterName)}`;
      const getterId = `getter:${filePath}:${qualifiedName}`;
      addNode({
        id: getterId,
        language: this.language,
        kind: "getter",
        name: getterName,
        qualified_name: qualifiedName,
        file_path: filePath,
        start_line: getter.getStartLineNumber(),
        end_line: getter.getEndLineNumber(),
        hash: hashString(getter.getText()),
        summary: null,
        metadata_json: serializeNodeMetadata("method", { async: false, exported: false }),
      });

      symbolToNode.set(qualifiedName, getterId);
      addEdge({
        id: `defines:${classId}:${getterId}`,
        from_id: classId,
        to_id: getterId,
        kind: "defines",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: getter.getStartLineNumber(),
        source_end_line: getter.getEndLineNumber(),
      });
    });

    classNode.getSetAccessors().forEach((setter) => {
      const setterName = setter.getName() ?? "set";
      const qualifiedName = `${className}.set${capitalize(setterName)}`;
      const setterId = `setter:${filePath}:${qualifiedName}`;
      addNode({
        id: setterId,
        language: this.language,
        kind: "setter",
        name: setterName,
        qualified_name: qualifiedName,
        file_path: filePath,
        start_line: setter.getStartLineNumber(),
        end_line: setter.getEndLineNumber(),
        hash: hashString(setter.getText()),
        summary: null,
        metadata_json: serializeNodeMetadata("method", { async: false, exported: false }),
      });

      symbolToNode.set(qualifiedName, setterId);
      addEdge({
        id: `defines:${classId}:${setterId}`,
        from_id: classId,
        to_id: setterId,
        kind: "defines",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: setter.getStartLineNumber(),
        source_end_line: setter.getEndLineNumber(),
      });
    });

    // Constructor
    const ctor = classNode.getConstructors()[0];
    if (ctor) {
      const ctorId = `constructor:${filePath}:${className}`;
      addNode({
        id: ctorId,
        language: this.language,
        kind: "constructor",
        name: "constructor",
        qualified_name: `${className}.constructor`,
        file_path: filePath,
        start_line: ctor.getStartLineNumber(),
        end_line: ctor.getEndLineNumber(),
        hash: hashString(ctor.getText()),
        summary: null,
        metadata_json: serializeNodeMetadata("method", { async: false, exported: false }),
      });

      symbolToNode.set(`${className}.constructor`, ctorId);
      addEdge({
        id: `defines:${classId}:${ctorId}`,
        from_id: classId,
        to_id: ctorId,
        kind: "defines",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: ctor.getStartLineNumber(),
        source_end_line: ctor.getEndLineNumber(),
      });

      this.processCallExpressions(ctor, filePath, ctorId, addEdge, importBindings);
      this.buildDependsOnEdges(ctorId, ctor.getText(), importBindings, filePath, ctor.getStartLineNumber(), ctor.getEndLineNumber(), addEdge);
    }
  }

  private processFunctionDeclaration(
    node: import("ts-morph").FunctionDeclaration,
    filePath: string,
    addNode: (n: GraphNode) => void,
    addEdge: (e: GraphEdge) => void,
    symbolToNode: Map<string, string>,
    importBindings: ImportBinding[]
  ): void {
    const name = node.getName();
    if (!name || !node.isExported()) return;

    const id = `function:${filePath}:${name}`;
    addNode({
      id,
      language: this.language,
      kind: "function",
      name,
      qualified_name: name,
      file_path: filePath,
      start_line: node.getStartLineNumber(),
      end_line: node.getEndLineNumber(),
      hash: hashString(node.getText()),
      summary: null,
      metadata_json: serializeNodeMetadata("function", { async: node.isAsync(), exported: true }),
    });

    symbolToNode.set(name, id);
    this.processCallExpressions(node, filePath, id, addEdge, importBindings);
    this.buildDependsOnEdges(id, node.getText(), importBindings, filePath, node.getStartLineNumber(), node.getEndLineNumber(), addEdge);
  }

  private processInterfaceDeclaration(
    node: import("ts-morph").InterfaceDeclaration,
    filePath: string,
    addNode: (n: GraphNode) => void,
    addEdge: (e: GraphEdge) => void,
    symbolToNode: Map<string, string>,
    importBindings: ImportBinding[]
  ): void {
    const name = node.getName();
    if (!node.isExported()) return;

    const interfaceId = `interface:${filePath}:${name}`;
    addNode({
      id: interfaceId,
      language: this.language,
      kind: "interface",
      name,
      qualified_name: name,
      file_path: filePath,
      start_line: node.getStartLineNumber(),
      end_line: node.getEndLineNumber(),
      hash: hashString(node.getText()),
      summary: null,
      metadata_json: null,
    });

    symbolToNode.set(name, interfaceId);

    // Extends edges for interfaces
    const extendsTypes = node.getExtends();
    extendsTypes.forEach((extType) => {
      const baseName = extType.getText();
      addEdge({
        id: `extends:${interfaceId}:${baseName}`,
        from_id: interfaceId,
        to_id: baseName,
        kind: "extends",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: node.getStartLineNumber(),
        source_end_line: node.getEndLineNumber(),
      });
    });

    // Index interface methods with qualified_name
    node.getMethods().forEach((method) => {
      const methodName = method.getName();
      const qualifiedName = `${name}.${methodName}`;
      const methodId = `method:${filePath}:${qualifiedName}`;
      addNode({
        id: methodId,
        language: this.language,
        kind: "method",
        name: methodName,
        qualified_name: qualifiedName,
        file_path: filePath,
        start_line: method.getStartLineNumber(),
        end_line: method.getEndLineNumber(),
        hash: hashString(method.getText()),
        summary: null,
        metadata_json: serializeNodeMetadata("method", { async: false, exported: true }),
      });

      symbolToNode.set(qualifiedName, methodId);
      addEdge({
        id: `defines:${interfaceId}:${methodId}`,
        from_id: interfaceId,
        to_id: methodId,
        kind: "defines",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: method.getStartLineNumber(),
        source_end_line: method.getEndLineNumber(),
      });
      this.buildDependsOnEdges(methodId, method.getText(), importBindings, filePath, method.getStartLineNumber(), method.getEndLineNumber(), addEdge);
    });

    // Index interface properties
    node.getProperties().forEach((prop) => {
      const propName = prop.getName();
      const qualifiedName = `${name}.${propName}`;
      const propId = `property:${filePath}:${qualifiedName}`;
      addNode({
        id: propId,
        language: this.language,
        kind: "property",
        name: propName,
        qualified_name: qualifiedName,
        file_path: filePath,
        start_line: prop.getStartLineNumber(),
        end_line: prop.getEndLineNumber(),
        hash: hashString(prop.getText()),
        summary: null,
        metadata_json: null,
      });

      symbolToNode.set(qualifiedName, propId);
      addEdge({
        id: `defines:${interfaceId}:${propId}`,
        from_id: interfaceId,
        to_id: propId,
        kind: "defines",
        confidence: 1.0,
        metadata_json: null,
        source_file: filePath,
        source_start_line: prop.getStartLineNumber(),
        source_end_line: prop.getEndLineNumber(),
      });
    });

    this.buildDependsOnEdges(interfaceId, node.getText(), importBindings, filePath, node.getStartLineNumber(), node.getEndLineNumber(), addEdge);
  }

  private processTypeAliasDeclaration(
    node: import("ts-morph").TypeAliasDeclaration,
    filePath: string,
    addNode: (n: GraphNode) => void
  ): void {
    const name = node.getName();
    if (!node.isExported()) return;

    const id = `type:${filePath}:${name}`;
    addNode({
      id,
      language: this.language,
      kind: "type",
      name,
      qualified_name: name,
      file_path: filePath,
      start_line: node.getStartLineNumber(),
      end_line: node.getEndLineNumber(),
      hash: hashString(node.getText()),
      summary: null,
      metadata_json: null,
    });
  }

  private processEnumDeclaration(
    node: import("ts-morph").EnumDeclaration,
    filePath: string,
    addNode: (n: GraphNode) => void
  ): void {
    const name = node.getName();
    if (!node.isExported()) return;

    const enumId = `enum:${filePath}:${name}`;
    addNode({
      id: enumId,
      language: this.language,
      kind: "enum",
      name,
      qualified_name: name,
      file_path: filePath,
      start_line: node.getStartLineNumber(),
      end_line: node.getEndLineNumber(),
      hash: hashString(node.getText()),
      summary: null,
      metadata_json: null,
    });

    // Index enum members
    node.getMembers().forEach((member) => {
      const memberName = member.getName();
      const qualifiedName = `${name}.${memberName}`;
      const memberId = `enum-member:${filePath}:${qualifiedName}`;
      addNode({
        id: memberId,
        language: this.language,
        kind: "enum-member",
        name: memberName,
        qualified_name: qualifiedName,
        file_path: filePath,
        start_line: member.getStartLineNumber(),
        end_line: member.getEndLineNumber(),
        hash: hashString(member.getText()),
        summary: null,
        metadata_json: null,
      });
    });
  }

  private processVariableStatement(
    node: import("ts-morph").VariableStatement,
    filePath: string,
    addNode: (n: GraphNode) => void
  ): void {
    if (!node.isExported()) return;

    node.getDeclarations().forEach((decl) => {
      const name = decl.getName();
      const id = `variable:${filePath}:${name}`;
      addNode({
        id,
        language: this.language,
        kind: "variable",
        name,
        qualified_name: name,
        file_path: filePath,
        start_line: decl.getStartLineNumber(),
        end_line: decl.getEndLineNumber(),
        hash: hashString(decl.getText()),
        summary: null,
        metadata_json: null,
      });
    });
  }

  private processCallExpressions(
    node: import("ts-morph").Node,
    filePath: string,
    callerId: string,
    addEdge: (e: GraphEdge) => void,
    importBindings: ImportBinding[]
  ): void {
    const callExprs = node.getDescendantsOfKind(SyntaxKind.CallExpression);
    callExprs.forEach((call) => {
      const expr = call.getExpression();
      const calleeText = expr.getText();
      const args = call.getArguments().map((arg) => arg.getText());
      const primaryTarget = inferSemanticTarget(calleeText, args[0], importBindings);
      const sourceStartLine = call.getStartLineNumber();
      const sourceEndLine = call.getEndLineNumber();

      // Only track simple identifier calls (not method chains)
      if (Node.isIdentifier(expr)) {
        addEdge({
          id: `calls:${filePath}:${generateCallId(call)}`,
          from_id: callerId,
          to_id: calleeText,
          kind: "calls",
          confidence: 0.8,
          metadata_json: null,
          source_file: filePath,
          source_start_line: sourceStartLine,
          source_end_line: sourceEndLine,
        });
      }

      const lowerCallee = calleeText.toLowerCase();
      const maybeAddSemanticEdge = (kind: GraphEdge["kind"], suffix: string, target: string, confidence: number) => {
        addEdge({
          id: `${kind}:${filePath}:${generateCallId(call)}:${suffix}`,
          from_id: callerId,
          to_id: target,
          kind,
          confidence,
          metadata_json: null,
          source_file: filePath,
          source_start_line: sourceStartLine,
          source_end_line: sourceEndLine,
        });
      };

      if (/(read|get|load|fetch)/.test(lowerCallee)) {
        maybeAddSemanticEdge("reads", "reads", primaryTarget, 0.55);
      }
      if (/(write|save|set|store|append|update)/.test(lowerCallee)) {
        maybeAddSemanticEdge("writes", "writes", primaryTarget, 0.55);
      }
      if (/(publish|emit|dispatch|send)/.test(lowerCallee)) {
        maybeAddSemanticEdge("publishes", "publishes", primaryTarget, 0.6);
      }
      if (/(subscribe|listen|consume|observe)/.test(lowerCallee)) {
        maybeAddSemanticEdge("subscribes", "subscribes", primaryTarget, 0.6);
      }
      if (/(route|forward|redirect)/.test(lowerCallee)) {
        maybeAddSemanticEdge("routes_to", "routes", primaryTarget, 0.6);
      }
    });
  }

  private buildDependsOnEdges(
    ownerId: string,
    ownerText: string,
    importBindings: ImportBinding[],
    filePath: string,
    startLine: number,
    endLine: number,
    addEdge: (e: GraphEdge) => void
  ): void {
    const edges = buildDependsOnEdgesFromText(ownerId, ownerText, importBindings, {
      file: filePath,
      startLine,
      endLine,
    }, `${filePath}:${ownerId}`);
    edges.forEach(addEdge);
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function importSpecToString(importDecl: import("ts-morph").ImportDeclaration): string | null {
  const moduleSpec = importDecl.getModuleSpecifier();
  if (!moduleSpec) return null;

  const text = moduleSpec.getText();
  // Remove quotes
  return text.slice(1, -1);
}

function generateCallId(call: import("ts-morph").CallExpression): string {
  const start = call.getStartLineNumber();
  const startCol = call.getStart();
  return `${start}:${startCol}`;
}
