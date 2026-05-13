import Database from "better-sqlite3";
import { GraphNode } from "./schema.js";
import { GraphTraversal } from "./traversal.js";
import { RECOMMENDABLE_NODE_KINDS } from "./semantics.js";
import { buildClusterId, inferDomain, inferSubsystem } from "./domains.js";

export interface NodeCentrality {
  node: GraphNode;
  fan_in: number;
  fan_out: number;
  centrality: number;
  decision_score: number;
}

export interface DomainSummary {
  domain: string;
  file_count: number;
  node_count: number;
  hub_count: number;
}

export interface OverviewAnalysis {
  countsByKind: Array<{ kind: string; count: number }>;
  languages: Array<{ language: string; count: number }>;
  centralNodes: NodeCentrality[];
  criticalFiles: Array<{
    path: string;
    fan_in: number;
    fan_out: number;
    centrality: number;
    domain: string | null;
    subsystem: string | null;
  }>;
  recommendations: NodeCentrality[];
  domains: DomainSummary[];
}

export interface FileTopology {
  path: string;
  fan_in: number;
  fan_out: number;
  centrality: number;
  domain: string | null;
  subsystem: string | null;
  cluster_id: string | null;
}

interface FileClusterLabel {
  domain: string;
  subsystem: string;
  cluster_id: string;
}

interface WeightedFileEdge {
  from_path: string;
  to_path: string;
  weight: number;
  kind: string;
}

const THIRD_PARTY_PATH_SEGMENTS = [
  "thirdparty",
  "third-party",
  "3rdparty",
  "vendor",
  "external",
  "extern",
  "deps",
  "dependencies",
  "submodules",
  "generated",
];

function isThirdPartyPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return THIRD_PARTY_PATH_SEGMENTS.some((segment) => normalized.includes(`/${segment}/`));
}

export class GraphAnalyzer {
  readonly traversal: GraphTraversal;

  constructor(private readonly db: Database.Database) {
    this.traversal = new GraphTraversal(db);
  }

  analyzeOverview(): OverviewAnalysis {
    const countsByKind = this.db.prepare(`
      SELECT kind, COUNT(*) as count
      FROM nodes
      GROUP BY kind
      ORDER BY count DESC
    `).all() as Array<{ kind: string; count: number }>;

    const languages = this.db.prepare(`
      SELECT language, COUNT(*) as count
      FROM nodes
      WHERE language IS NOT NULL
      GROUP BY language
      ORDER BY count DESC
    `).all() as Array<{ language: string; count: number }>;

    const rankedNodes = this.rankNodes();
    const workspaceRankedNodes = rankedNodes.filter((item) => !isThirdPartyPath(item.node.file_path));
    const rankedFiles = this.rankFiles();
    const workspaceRankedFiles = rankedFiles.filter((file) => !isThirdPartyPath(file.path));
    const centralNodes = (workspaceRankedNodes.length > 0 ? workspaceRankedNodes : rankedNodes).slice(0, 10);
    const criticalFiles = (workspaceRankedFiles.length > 0 ? workspaceRankedFiles : rankedFiles).slice(0, 5);
    const recommendations = rankedNodes.filter((item) => this.isRecommendable(item.node)).slice(0, 5);
    const domains = this.summarizeDomains();

    return {
      countsByKind,
      languages,
      centralNodes,
      criticalFiles,
      recommendations,
      domains,
    };
  }

  rankNodes(): NodeCentrality[] {
    const nodes = this.db.prepare(`
      SELECT *
      FROM nodes
      WHERE kind NOT IN ('file', 'variable', 'type', 'enum', 'message', 'queue', 'topic')
    `).all() as GraphNode[];

    return nodes
      .map((node) => {
        const fan_in = this.traversal.fanIn(node.id);
        const fan_out = this.traversal.fanOut(node.id);
        const centrality = fan_in * 3 + fan_out;
        const decision_score = this.decisionScore(node, centrality);
        return { node, fan_in, fan_out, centrality, decision_score };
      })
      .filter((item) => item.centrality > 0)
      .sort((a, b) => {
        if (b.decision_score !== a.decision_score) return b.decision_score - a.decision_score;
        if (b.fan_in !== a.fan_in) return b.fan_in - a.fan_in;
        if (b.centrality !== a.centrality) return b.centrality - a.centrality;
        return a.node.name.localeCompare(b.node.name);
      });
  }

  rankFiles(): Array<{
    path: string;
    fan_in: number;
    fan_out: number;
    centrality: number;
    domain: string | null;
    subsystem: string | null;
  }> {
    return this.analyzeFileTopology().map((file) => ({
      path: file.path,
      fan_in: file.fan_in,
      fan_out: file.fan_out,
      centrality: file.centrality,
      domain: file.domain,
      subsystem: file.subsystem,
    })).sort((a, b) => {
      const aScore = this.fileDecisionScore(a);
      const bScore = this.fileDecisionScore(b);
      if (bScore !== aScore) return bScore - aScore;
      if (b.fan_in !== a.fan_in) return b.fan_in - a.fan_in;
      return b.centrality - a.centrality;
    });
  }

  summarizeDomains(): DomainSummary[] {
    const domains = new Map<string, DomainSummary>();
    const fileTopologies = this.analyzeFileTopology();
    const fileStats = this.db.prepare(`
      SELECT path, COALESCE(symbol_count, 0) as symbol_count
      FROM files
    `).all() as Array<{ path: string; symbol_count: number }>;
    const fileStatsByPath = new Map(fileStats.map((item) => [item.path, item]));

    for (const file of fileTopologies) {
      const domain = file.domain ?? "workspace";
      const summary = domains.get(domain) ?? { domain, file_count: 0, node_count: 0, hub_count: 0 };
      summary.file_count += 1;
      summary.node_count += fileStatsByPath.get(file.path)?.symbol_count ?? 0;
      if (file.centrality > 0) summary.hub_count += 1;
      domains.set(domain, summary);
    }

    return [...domains.values()].sort((a, b) => {
      if (b.hub_count !== a.hub_count) return b.hub_count - a.hub_count;
      return b.node_count - a.node_count;
    });
  }

  analyzeFileTopology(): FileTopology[] {
    const files = this.db.prepare(`
      SELECT path, domain, subsystem
      FROM files
    `).all() as Array<{ path: string; domain: string | null; subsystem: string | null }>;
    const paths = files.map((file) => file.path);
    const fileSet = new Set(paths);
    const adjacency = new Map<string, Set<string>>();
    const inbound = new Map<string, number>();
    const outbound = new Map<string, number>();

    for (const path of paths) {
      adjacency.set(path, new Set());
      inbound.set(path, 0);
      outbound.set(path, 0);
    }

    const rawFileEdges = this.db.prepare(`
      SELECT
        COALESCE(sf.file_path, e.source_file) as from_path,
        tf.file_path as to_path,
        e.kind
      FROM edges e
      LEFT JOIN nodes sf ON sf.id = e.from_id
      LEFT JOIN nodes tf ON tf.id = e.to_id
      WHERE e.kind NOT IN ('contains', 'defines')
    `).all() as Array<{ from_path: string | null; to_path: string | null; kind: string }>;

    const fileEdges: WeightedFileEdge[] = [];

    for (const edge of rawFileEdges) {
      if (!edge.from_path || !edge.to_path) continue;
      if (!fileSet.has(edge.from_path) || !fileSet.has(edge.to_path)) continue;
      if (edge.from_path !== edge.to_path) {
        adjacency.get(edge.from_path)?.add(edge.to_path);
        adjacency.get(edge.to_path)?.add(edge.from_path);
      }
      outbound.set(edge.from_path, (outbound.get(edge.from_path) ?? 0) + 1);
      inbound.set(edge.to_path, (inbound.get(edge.to_path) ?? 0) + 1);
      fileEdges.push({
        from_path: edge.from_path,
        to_path: edge.to_path,
        kind: edge.kind,
        weight: this.edgeWeight(edge.kind),
      });
    }

    const clusterByPath = this.detectFileClusters(paths, adjacency, files, fileEdges);
    return files.map((file) => {
      const cluster = clusterByPath.get(file.path);
      const fan_in = inbound.get(file.path) ?? 0;
      const fan_out = outbound.get(file.path) ?? 0;
      return {
        path: file.path,
        fan_in,
        fan_out,
        centrality: fan_in * 3 + fan_out,
        domain: cluster?.domain ?? file.domain ?? inferDomain(file.path),
        subsystem: cluster?.subsystem ?? file.subsystem ?? inferSubsystem(file.path),
        cluster_id: cluster?.cluster_id ?? buildClusterId(inferDomain(file.path), inferSubsystem(file.path)),
      };
    });
  }

  private decisionScore(node: GraphNode, centrality: number): number {
    let score = centrality;
    if (node.domain) score += 2;
    if (node.subsystem) score += 1;
    if (node.summary) score += 1;
    if (node.qualified_name) score += 0.5;
    if (isThirdPartyPath(node.file_path)) score -= 100;
    return score;
  }

  private fileDecisionScore(file: {
    path: string;
    fan_in: number;
    fan_out: number;
    centrality: number;
    domain: string | null;
    subsystem: string | null;
  }): number {
    let score = file.centrality;
    if (file.domain) score += 2;
    if (file.subsystem) score += 1;
    if (isThirdPartyPath(file.path)) score -= 100;
    return score;
  }

  private isRecommendable(node: GraphNode): boolean {
    if (!RECOMMENDABLE_NODE_KINDS.has(node.kind)) return false;
    if (!node.file_path) return false;
    if (/test|spec/i.test(node.file_path)) return false;
    if (isThirdPartyPath(node.file_path)) return false;
    if (["new", "main", "default", "helper"].includes(node.name.toLowerCase())) return false;
    return true;
  }

  private detectFileClusters(
    paths: string[],
    adjacency: Map<string, Set<string>>,
    files: Array<{ path: string; domain: string | null; subsystem: string | null }>,
    edges: WeightedFileEdge[]
  ): Map<string, { domain: string; subsystem: string; cluster_id: string }> {
    const fileMap = new Map(files.map((file) => [file.path, file]));
    const weightedNeighbors = this.buildWeightedNeighbors(paths, edges);
    const visited = new Set<string>();
    const clusterByPath = new Map<string, { domain: string; subsystem: string; cluster_id: string }>();
    let clusterIndex = 0;

    for (const path of paths) {
      if (visited.has(path)) continue;
      clusterIndex += 1;
      const queue = [path];
      const component: string[] = [];
      visited.add(path);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        for (const neighbor of adjacency.get(current) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      const labelsByPath = this.assignWeightedLabels(component, fileMap, weightedNeighbors);
      for (const componentPath of component) {
        const labels = labelsByPath.get(componentPath) ?? {
          domain: fileMap.get(componentPath)?.domain ?? inferDomain(componentPath),
          subsystem: fileMap.get(componentPath)?.subsystem ?? inferSubsystem(componentPath),
        };
        const cluster_id = `cluster:${clusterIndex}:${buildClusterId(labels.domain, labels.subsystem)}`;
        clusterByPath.set(componentPath, { domain: labels.domain, subsystem: labels.subsystem, cluster_id });
      }
    }

    return clusterByPath;
  }

  private assignWeightedLabels(
    component: string[],
    fileMap: Map<string, { path: string; domain: string | null; subsystem: string | null }>,
    weightedNeighbors: Map<string, Array<{ path: string; weight: number }>>
  ): Map<string, { domain: string; subsystem: string }> {
    const labels = new Map<string, { domain: string; subsystem: string }>();

    for (const filePath of component) {
      const domainScores = new Map<string, number>();
      const subsystemScores = new Map<string, number>();

      const ownDomain = fileMap.get(filePath)?.domain ?? inferDomain(filePath);
      const ownSubsystem = fileMap.get(filePath)?.subsystem ?? inferSubsystem(filePath);
      domainScores.set(ownDomain, 8);
      subsystemScores.set(ownSubsystem, 8);

      for (const neighbor of weightedNeighbors.get(filePath) ?? []) {
        const neighborDomain = fileMap.get(neighbor.path)?.domain ?? inferDomain(neighbor.path);
        const neighborSubsystem = fileMap.get(neighbor.path)?.subsystem ?? inferSubsystem(neighbor.path);
        domainScores.set(neighborDomain, (domainScores.get(neighborDomain) ?? 0) + neighbor.weight);
        subsystemScores.set(neighborSubsystem, (subsystemScores.get(neighborSubsystem) ?? 0) + neighbor.weight);
      }

      labels.set(filePath, {
        domain: this.pickTopScoredLabel(domainScores, ownDomain),
        subsystem: this.pickTopScoredLabel(subsystemScores, ownSubsystem),
      });
    }

    return labels;
  }

  private buildWeightedNeighbors(
    paths: string[],
    edges: WeightedFileEdge[]
  ): Map<string, Array<{ path: string; weight: number }>> {
    const neighbors = new Map<string, Map<string, number>>();

    for (const filePath of paths) {
      neighbors.set(filePath, new Map());
    }

    for (const edge of edges) {
      if (edge.from_path === edge.to_path) continue;
      neighbors.get(edge.from_path)?.set(edge.to_path, (neighbors.get(edge.from_path)?.get(edge.to_path) ?? 0) + edge.weight);
      neighbors.get(edge.to_path)?.set(edge.from_path, (neighbors.get(edge.to_path)?.get(edge.from_path) ?? 0) + edge.weight * 0.5);
    }

    return new Map(
      [...neighbors.entries()].map(([filePath, map]) => [
        filePath,
        [...map.entries()]
          .map(([neighborPath, weight]) => ({ path: neighborPath, weight }))
          .filter((item) => item.weight >= 1),
      ])
    );
  }

  private pickTopScoredLabel(scores: Map<string, number>, fallback: string): string {
    return [...scores.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })[0]?.[0] ?? fallback;
  }

  private edgeWeight(kind: string): number {
    switch (kind) {
      case "calls":
      case "depends_on":
      case "implements":
      case "extends":
        return 3;
      case "imports":
      case "references":
        return 2;
      case "reads":
      case "writes":
      case "publishes":
      case "subscribes":
      case "routes_to":
      case "handles":
        return 1.5;
      default:
        return 1;
    }
  }
}
