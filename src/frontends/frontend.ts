import { GraphNode, GraphEdge } from "../graph/schema.js";

export interface GraphPatch {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LanguageFrontend {
  language: string;
  
  supports(path: string): boolean;
  
  parseFile(
    path: string,
    content: string
  ): Promise<GraphPatch>;
}
