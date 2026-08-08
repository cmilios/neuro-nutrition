import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const failures = [];
const anchorCache = new Map();

const relativeName = (file) => path.relative(root, file).split(path.sep).join("/");

const reportFailure = (document, lineNumber, contract, message) => {
  failures.push(`${relativeName(document)}:${lineNumber} [${contract}] ${message}`);
};

const listMarkdown = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith(".")) {
        files.push(...await listMarkdown(path.join(directory, entry.name)));
      }
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
};

const project = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const publicEnvironment = new Set(
  (await readFile(path.join(root, ".env.example"), "utf8"))
    .split(/\r?\n/)
    .flatMap((line) => line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=/)?.[1] ?? []),
);

const markdownAnchors = async (file) => {
  if (anchorCache.has(file)) return anchorCache.get(file);

  const contents = await readFile(file, "utf8");
  const anchors = new Set();
  const occurrences = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading) {
      const base = heading
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/[`*_~]/g, "")
        .replace(/[\u2010-\u2015]/g, "-")
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s+/g, "-");
      const count = occurrences.get(base) ?? 0;
      anchors.add(count === 0 ? base : `${base}-${count}`);
      occurrences.set(base, count + 1);
    }
    for (const match of line.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']/gi)) {
      anchors.add(match[1]);
    }
  }
  anchorCache.set(file, anchors);
  return anchors;
};

const normalizedDestination = (rawDestination) => {
  const trimmed = rawDestination.trim();
  if (trimmed.startsWith("<")) return trimmed.slice(1, trimmed.indexOf(">"));
  return trimmed.split(/\s+/, 1)[0];
};

const validateLocalDestination = async ({
  document,
  lineNumber,
  rawDestination,
  asset = false,
}) => {
  const destination = normalizedDestination(rawDestination);
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) return;

  const [targetPart, fragment] = destination.split("#", 2);
  const targetName = decodeURIComponent(targetPart.split("?", 1)[0]);
  const target = targetName
    ? path.resolve(path.dirname(document), targetName)
    : document;
  try {
    await access(target);
  } catch {
    reportFailure(
      document,
      lineNumber,
      asset ? "markdown-asset" : "markdown-link",
      `${asset ? "Image" : "Target"} does not exist: ${destination}`,
    );
    return;
  }

  if (fragment && target.toLowerCase().endsWith(".md")) {
    const anchor = decodeURIComponent(fragment).toLowerCase();
    if (!(await markdownAnchors(target)).has(anchor)) {
      reportFailure(
        document,
        lineNumber,
        "markdown-anchor",
        `Anchor does not exist: ${destination}`,
      );
    }
  }
};

const validateHtmlAssets = async ({ document, text, lineNumber }) => {
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    await validateLocalDestination({
      document,
      lineNumber,
      rawDestination: match[1],
      asset: true,
    });
  }
};

const validatePublicEnvironment = ({ document, text, lineNumber }) => {
  for (const variable of new Set(text.match(/\bVITE_[A-Z0-9_]+\b/g) ?? [])) {
    if (!publicEnvironment.has(variable)) {
      reportFailure(
        document,
        lineNumber,
        "public-env",
        `Variable is not declared in .env.example: ${variable}`,
      );
    }
  }
};

const validateNpmScripts = ({ document, text, lineNumber }) => {
  for (const match of text.matchAll(
    /\bnpm(?:\.cmd)?\s+(?:run\s+([\w:-]+)|(test|start|stop|restart))\b/g,
  )) {
    const script = match[1] ?? match[2];
    if (!Object.hasOwn(project.scripts ?? {}, script)) {
      reportFailure(
        document,
        lineNumber,
        "npm-script",
        `Script is not declared in package.json: ${script}`,
      );
    }
  }
};

const validateInlineMarkdown = async ({ document, text, lineNumber }) => {
  for (const match of text.matchAll(/(!?)\[[^\]]*\]\(([^)]+)\)/g)) {
    await validateLocalDestination({
      document,
      lineNumber,
      rawDestination: match[2],
      asset: match[1] === "!",
    });
  }
};

const referenceLabel = (label) => label.trim().replace(/\s+/g, " ").toLowerCase();

const validateReferenceMarkdown = async (document, lines) => {
  const definitions = new Map();
  for (const [index, line] of lines.entries()) {
    const definition = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/);
    if (definition) {
      definitions.set(referenceLabel(definition[1]), {
        destination: definition[2],
        lineNumber: index + 1,
      });
    }
  }

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/(!?)\[([^\]]+)\]\[([^\]]*)\]/g)) {
      const label = referenceLabel(match[3] || match[2]);
      const definition = definitions.get(label);
      const asset = match[1] === "!";
      if (!definition) {
        reportFailure(
          document,
          index + 1,
          asset ? "markdown-asset" : "markdown-link",
          `Reference is not defined: ${label}`,
        );
        continue;
      }
      await validateLocalDestination({
        document,
        lineNumber: definition.lineNumber,
        rawDestination: definition.destination,
        asset,
      });
    }

    if (/^\s{0,3}\[[^\]]+\]:/.test(line)) continue;
    const shortcutCandidates = line.replace(
      /!?\[[^\]]+\](?:\[[^\]]*\]|\([^)]+\))/g,
      "",
    );
    for (const match of shortcutCandidates.matchAll(/(!?)\[([^\]]+)\]/g)) {
      const label = referenceLabel(match[2]);
      const definition = definitions.get(label);
      if (!definition) continue;
      await validateLocalDestination({
        document,
        lineNumber: definition.lineNumber,
        rawDestination: definition.destination,
        asset: match[1] === "!",
      });
    }
  }
};

for (const document of await listMarkdown(root)) {
  const contents = await readFile(document, "utf8");
  const lines = contents.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const context = { document, text: line, lineNumber: index + 1 };
    await validateHtmlAssets(context);
    validatePublicEnvironment(context);
    validateNpmScripts(context);
    await validateInlineMarkdown(context);
  }
  await validateReferenceMarkdown(document, lines);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Documentation contract is valid.");
}
