import { GraphAnalyzer } from "../graph/analyzer.js";
import { getDb } from "../graph/db.js";
import { getGraphRevision } from "../graph/metadata.js";
import { getArchgraphDir } from "../util/paths.js";

export interface OverviewRecommendation {
  name: string;
  kind: string;
  filePath: string | null;
}

export async function generateOverviewData(cwd: string): Promise<{
  overview: string;
  recommendations: OverviewRecommendation[];
}> {
  const archgraphDir = getArchgraphDir(cwd);
  const db = getDb(archgraphDir);

  try {
    const analyzer = new GraphAnalyzer(db);
    const analysis = analyzer.analyzeOverview();
    const revision = getGraphRevision(db);

    let output = "## Architecture Overview\n\n";
    output += "| Kind | Count |\n| :--- | :--- |\n";
    analysis.countsByKind.forEach((item) => {
      output += `| ${item.kind} | ${item.count} |\n`;
    });
    output += "\n";

    if (analysis.languages.length > 0) {
      output += `**Languages**: ${analysis.languages.map((item) => `${item.language} (${item.count})`).join(", ")}\n\n`;
    }

    if (revision) {
      output += `**Graph Revision**: ${revision.graphRevision}\n`;
      output += `**Indexed Commit**: ${revision.indexedCommit ?? "none"}\n`;
      output += `**Workspace ID**: ${revision.workspaceId}\n\n`;
    }

    if (analysis.domains.length > 0) {
      output += "### Architecture Domains\n";
      analysis.domains.forEach((domain) => {
        output += `- **${domain.domain}**: ${domain.file_count} files, ${domain.node_count} symbols, ${domain.hub_count} hubs\n`;
      });
      output += "\n";
    }

    if (analysis.criticalFiles.length > 0) {
      output += "### Architecture-Critical Files\n";
      analysis.criticalFiles.forEach((file) => {
        output += `- \`${file.path}\` [fan-in=${file.fan_in}, fan-out=${file.fan_out}, centrality=${file.centrality}]`;
        if (file.domain || file.subsystem) {
          output += ` (${file.domain ?? "workspace"} / ${file.subsystem ?? "workspace"})`;
        }
        output += "\n";
      });
      output += "\n";
    }

    output += "### Core Runtime Hubs\n";
    analysis.centralNodes.forEach((item) => {
      output += `- **${item.node.name}** (${item.node.kind}) in \`${item.node.file_path || "unknown"}\`: fan-in=${item.fan_in}, fan-out=${item.fan_out}, centrality=${item.centrality}\n`;
    });

    const recommendations = analysis.recommendations.map((item) => ({
      name: item.node.name,
      kind: item.node.kind,
      filePath: item.node.file_path,
    }));

    if (recommendations.length > 0) {
      output += "\n### Recommended Next Inspections\n";
      recommendations.forEach((item) => {
        output += `- Use archgraph_inspect to inspect \`${item.name}\` (${item.kind}) in \`${item.filePath || "unknown"}\`\n`;
      });
    }

    output += "\nPriority: high — inspect the listed hubs and critical files first; they are the highest-value entry points for analysis.\n";
    output += "Recommendation / Next Step: inspect the listed hubs and critical files first; they are the highest-value entry points for analysis.\n";
    output += "Confidence / Uncertainty: moderate confidence from structural metrics; validate domain assumptions with targeted symbol inspection.\n";

    return { overview: output, recommendations };
  } finally {
    db.close();
  }
}

export async function generateOverview(cwd: string): Promise<string> {
  const result = await generateOverviewData(cwd);
  return result.overview;
}
