import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";

export async function hashFile(filePath: string): Promise<string> {
  try {
    const data = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch (err) {
    return "";
  }
}

export function hashString(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
