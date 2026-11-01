import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const toolsModulePath = pathToFileURL(path.resolve(repoRoot, 'lib/tools.js')).toString();

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md'))
      files.push(fullPath);
  }
  return files;
}

async function main() {
  const docRoots = [
    path.resolve(repoRoot, '.windsurf/workflows'),
    path.resolve(repoRoot, 'docs'),
  ];
  const explicitFiles = [
    path.resolve(repoRoot, 'README.md'),
  ];
  const markdownFiles = [
    ...explicitFiles,
    ...(await Promise.all(docRoots.map(async dir => {
      try {
        return await collectMarkdownFiles(dir);
      } catch {
        return [];
      }
    }))).flat(),
  ];
  const docPaths = uniqueSorted(markdownFiles.filter(file => file.startsWith(repoRoot)));
  const mentionsByFile = {};
  for (const docPath of docPaths) {
    const content = await fs.promises.readFile(docPath, 'utf8');
    const mentions = uniqueSorted(Array.from(content.matchAll(/\bbrowser_[a-z0-9_]+\b/g)).map(match => match[0]));
    if (mentions.length)
      mentionsByFile[path.relative(repoRoot, docPath)] = mentions;
  }
  const mentionedTools = uniqueSorted(Object.values(mentionsByFile).flat());

  const toolsModule = await import(toolsModulePath);
  const runtimeTools = uniqueSorted((toolsModule.allTools || []).map(tool => tool?.schema?.name).filter(Boolean));
  const missing = mentionedTools.filter(name => !runtimeTools.includes(name));
  const missingByFile = Object.fromEntries(
    Object.entries(mentionsByFile)
      .map(([docPath, mentions]) => [docPath, mentions.filter(name => !runtimeTools.includes(name))])
      .filter(([, docMissing]) => docMissing.length)
  );

  const summary = {
    scannedDocs: Object.keys(mentionsByFile),
    mentionedCount: mentionedTools.length,
    runtimeCount: runtimeTools.length,
    missing,
    missingByFile,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (missing.length)
    throw new Error(`Tool contract mismatch: docs reference missing tools: ${JSON.stringify(missingByFile)}`);
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
