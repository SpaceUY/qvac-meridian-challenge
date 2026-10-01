import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../corpus",
);

export const TEXT_EXTENSIONS = new Set([".md", ".txt", ".csv", ".json", ".html"]);

export async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

/**
 * Reads every text document under `corpus/` and concatenates them into a
 * single block, each prefixed with its path relative to `corpus/` so the
 * assistant can cite sources. Binary files (images) are skipped - there's
 * no vision-capable path to turn them into text context.
 */
export async function loadCorpusContext(): Promise<string> {
  const filePaths = await listFilesRecursively(CORPUS_DIR);

  const documents = await Promise.all(
    filePaths.map(async (filePath) => {
      const relativePath = path.relative(CORPUS_DIR, filePath);
      const content = await fs.readFile(filePath, "utf-8");
      return `<document> <path> ${relativePath}</path>\n <content>${content} </content></document>`;
    }),
  );

  return documents.join("\n\n");
}
