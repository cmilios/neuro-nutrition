import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";

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

const inlineMarkdownLinks = (text) =>
  [...text.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)].map((match) => ({
    asset: match[1] === "!",
    alt: match[1] === "!" ? match[2] : null,
    rawDestination: match[3],
    lineNumber: text.slice(0, match.index).split(/\r?\n/).length,
  }));

const normalizedLocalDestination = (rawDestination) =>
  normalizedDestination(rawDestination)
    .split(/[?#]/, 1)[0]
    .replaceAll("\\", "/");

const validateRequiredNavigation = async () => {
  const readme = path.join(root, "README.md");
  let contents;
  try {
    contents = await readFile(readme, "utf8");
  } catch {
    reportFailure(readme, 1, "required-navigation", "README.md is required");
    return;
  }

  const destinations = new Set(
    inlineMarkdownLinks(contents).map(({ rawDestination }) =>
      normalizedLocalDestination(rawDestination),
    ),
  );

  for (const destination of [
    "docs/development.md",
    "CONTRIBUTING.md",
    "docs/privacy-and-security.md",
    "docs/semantic-evidence-checklist.md",
    "SECURITY.md",
  ]) {
    if (!destinations.has(destination)) {
      reportFailure(
        readme,
        1,
        "required-navigation",
        `Landing page must link to ${destination}`,
      );
    }
  }
};

const validateSemanticEvidenceChecklist = async () => {
  const file = path.join(root, "docs", "semantic-evidence-checklist.md");
  const contents = await readRequiredFile(
    file,
    "semantic-evidence",
    "Semantic evidence checklist is missing",
  );
  if (contents === null) return;

  const requiredHeadings = [
    "Behavioral claims",
    "Health-safety claims",
    "Privacy claims",
    "Supabase claims",
    "Environment claims",
    "Deployment claims",
  ];
  for (const heading of requiredHeadings) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^#{2,6}\\s+${escapedHeading}\\s*$`, "im").test(contents)) {
      reportFailure(
        file,
        1,
        "semantic-evidence",
        `Checklist must cover ${heading}`,
      );
    }
  }
};

const requiredWikiPages = [
  "Home.md",
  "Getting-Started.md",
  "Account-and-Settings.md",
  "Troubleshooting.md",
  "Using-Your-Weekly-Plan.md",
  "Reviewing-Your-Week.md",
  "Start-Over.md",
  "Privacy-and-Safety.md",
  "_Sidebar.md",
];
const representativeWikiAsset = "assets/weekly-plan-overview.png";
const technicalPrivacySource = "https://github.com/cmilios/neuro-nutrition/blob/main/docs/privacy-and-security.md";
const publishedWikiPages = new Map([
  ["https://github.com/cmilios/neuro-nutrition/wiki", "Home.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Home", "Home.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Getting-Started", "Getting-Started.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Account-and-Settings", "Account-and-Settings.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Troubleshooting", "Troubleshooting.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Using-Your-Weekly-Plan", "Using-Your-Weekly-Plan.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Reviewing-Your-Week", "Reviewing-Your-Week.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Start-Over", "Start-Over.md"],
  ["https://github.com/cmilios/neuro-nutrition/wiki/Privacy-and-Safety", "Privacy-and-Safety.md"],
]);

const readRequiredFile = async (file, contract, message) => {
  try {
    return await readFile(file, "utf8");
  } catch {
    reportFailure(file, 1, contract, message);
    return null;
  }
};

const crc32 = (contents, start, end) => {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= contents[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const NON_INTERLACED_PASSES = [
  { startX: 0, startY: 0, stepX: 1, stepY: 1 },
];
const ADAM7_PASSES = [
  { startX: 0, startY: 0, stepX: 8, stepY: 8 },
  { startX: 4, startY: 0, stepX: 8, stepY: 8 },
  { startX: 0, startY: 4, stepX: 4, stepY: 8 },
  { startX: 2, startY: 0, stepX: 4, stepY: 4 },
  { startX: 0, startY: 2, stepX: 2, stepY: 4 },
  { startX: 1, startY: 0, stepX: 2, stepY: 2 },
  { startX: 0, startY: 1, stepX: 1, stepY: 2 },
];

const hasValidPngStructure = (contents) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (contents.length < 33 || !contents.subarray(0, 8).equals(signature)) {
    return false;
  }

  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  let width = 0;
  let height = 0;
  let bitsPerPixel = 0;
  let interlaceMethod = -1;
  const imageDataChunks = [];
  while (offset + 12 <= contents.length) {
    const chunkLength = contents.readUInt32BE(offset);
    const chunkType = contents.toString("ascii", offset + 4, offset + 8);
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > contents.length) return false;
    const storedCrc = contents.readUInt32BE(nextOffset - 4);
    const computedCrc = crc32(contents, offset + 4, nextOffset - 4);
    if (storedCrc !== computedCrc) return false;

    if (!sawHeader) {
      if (chunkType !== "IHDR" || chunkLength !== 13) return false;
      width = contents.readUInt32BE(offset + 8);
      height = contents.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) return false;
      const bitDepth = contents[offset + 16];
      const colorType = contents[offset + 17];
      const compressionMethod = contents[offset + 18];
      const filterMethod = contents[offset + 19];
      interlaceMethod = contents[offset + 20];
      const allowedBitDepths = new Map([
        [0, new Set([1, 2, 4, 8, 16])],
        [2, new Set([8, 16])],
        [3, new Set([1, 2, 4, 8])],
        [4, new Set([8, 16])],
        [6, new Set([8, 16])],
      ]);
      const samplesPerPixel = new Map([
        [0, 1],
        [2, 3],
        [3, 1],
        [4, 2],
        [6, 4],
      ]);
      if (
        !allowedBitDepths.get(colorType)?.has(bitDepth)
        || compressionMethod !== 0
        || filterMethod !== 0
        || ![0, 1].includes(interlaceMethod)
      ) {
        return false;
      }
      bitsPerPixel = bitDepth * samplesPerPixel.get(colorType);
      sawHeader = true;
    } else if (chunkType === "IHDR") {
      return false;
    }

    if (chunkType === "IDAT") {
      sawImageData = true;
      imageDataChunks.push(contents.subarray(offset + 8, nextOffset - 4));
    }
    if (chunkType === "IEND") {
      if (chunkLength !== 0 || nextOffset !== contents.length) return false;
      sawEnd = true;
    }
    offset = nextOffset;
  }

  if (!sawHeader || !sawImageData || !sawEnd) return false;

  const passes = interlaceMethod === 0
    ? NON_INTERLACED_PASSES
    : ADAM7_PASSES;
  const scanlines = [];
  let expectedLength = 0;
  const maximumDecodedBytes = 50 * 1024 * 1024;
  for (const { startX, startY, stepX, stepY } of passes) {
    const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
    const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowLength = 1 + Math.ceil((passWidth * bitsPerPixel) / 8);
    const passLength = rowLength * passHeight;
    if (
      !Number.isSafeInteger(passLength)
      || expectedLength + passLength > maximumDecodedBytes
    ) {
      return false;
    }
    scanlines.push({ rowLength, height: passHeight });
    expectedLength += passLength;
  }

  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(imageDataChunks), {
      maxOutputLength: expectedLength,
    });
  } catch {
    return false;
  }
  if (decoded.length !== expectedLength) return false;

  let rowOffset = 0;
  for (const pass of scanlines) {
    for (let row = 0; row < pass.height; row += 1) {
      if (decoded[rowOffset] > 4) return false;
      rowOffset += pass.rowLength;
    }
  }
  return rowOffset === decoded.length;
};

const validatePublicIssueTemplates = async () => {
  const templates = [
    ["bug_report.yml", "Structured bug report template is missing"],
    ["documentation.yml", "Structured documentation report template is missing"],
  ];
  const prohibitedEvidence = [
    "Health Profile data",
    "email addresses",
    "tokens",
    "authorization codes",
    "raw provider errors",
    "sensitive screenshots",
  ];

  for (const [template, missingMessage] of templates) {
    const file = path.join(root, ".github", "ISSUE_TEMPLATE", template);
    const contents = await readRequiredFile(file, "public-reporting", missingMessage);
    if (contents === null) continue;

    const structuredFormContracts = [
      /^name:\s*\S/im,
      /^description:\s*\S/im,
      /^body:\s*$/im,
      /^\s+- type:\s*(?:input|textarea|dropdown|checkboxes)\s*$/im,
      /^\s+validations:\s*$/im,
      /^\s+required:\s*true\s*$/im,
    ];
    if (!structuredFormContracts.every((contract) => contract.test(contents))) {
      reportFailure(
        file,
        1,
        "public-reporting",
        "Template must remain a structured issue form with required evidence",
      );
    }

    if (!/\bdo not (?:include|post|share)\b/i.test(contents)) {
      reportFailure(
        file,
        1,
        "public-reporting",
        "Template needs an explicit do-not-share instruction",
      );
    }

    const missingEvidence = prohibitedEvidence.filter(
      (term) => !contents.toLowerCase().includes(term.toLowerCase()),
    );
    if (missingEvidence.length > 0) {
      reportFailure(
        file,
        1,
        "public-reporting",
        `Template must prohibit: ${missingEvidence.join(", ")}`,
      );
    }
  }
};

const markdownDestinations = (contents) =>
  inlineMarkdownLinks(contents).map((link) => ({
    destination: publishedWikiPages.get(
      normalizedDestination(link.rawDestination).split(/[?#]/, 1)[0].replace(/\/$/, ""),
    ) ?? normalizedLocalDestination(link.rawDestination),
    lineNumber: link.lineNumber,
    alt: link.alt,
  }));

const hasMeaningfulImageAlt = (alt) =>
  alt.trim().length >= 20
  && !/^(?:image|photo|screenshot|weekly plan)$/i.test(alt.trim());

const validateWikiBundle = async () => {
  const wikiRoot = path.join(root, "docs", "wiki");
  const pages = new Map();

  for (const page of requiredWikiPages) {
    const file = path.join(wikiRoot, page);
    const contents = await readRequiredFile(
      file,
      "wiki-bundle",
      `Required Wiki page is missing: ${page}`,
    );
    if (contents !== null) pages.set(page, contents);
  }

  const asset = path.join(wikiRoot, representativeWikiAsset);
  let assetContents = null;
  try {
    assetContents = await readFile(asset);
  } catch {
    reportFailure(
      asset,
      1,
      "wiki-bundle",
      `Required Wiki asset is missing: ${representativeWikiAsset}`,
    );
  }
  if (assetContents !== null && !hasValidPngStructure(assetContents)) {
    reportFailure(
      asset,
      1,
      "wiki-image-file",
      `Required Wiki asset must be a valid PNG: ${representativeWikiAsset}`,
    );
  }

  const navigationContract = [
    ["Home.md", [
      "Getting-Started.md",
      "Account-and-Settings.md",
      "Troubleshooting.md",
      "Using-Your-Weekly-Plan.md",
      "Reviewing-Your-Week.md",
      "Start-Over.md",
      "Privacy-and-Safety.md",
    ]],
    ["Getting-Started.md", ["Home.md"]],
    ["Account-and-Settings.md", ["Home.md", "Troubleshooting.md"]],
    ["Troubleshooting.md", ["Home.md", "Account-and-Settings.md"]],
    ["Using-Your-Weekly-Plan.md", ["Home.md"]],
    ["Reviewing-Your-Week.md", ["Home.md"]],
    ["Start-Over.md", ["Home.md"]],
    ["Privacy-and-Safety.md", ["Home.md", technicalPrivacySource]],
    ["_Sidebar.md", [
      "Home.md",
      "Getting-Started.md",
      "Account-and-Settings.md",
      "Troubleshooting.md",
      "Using-Your-Weekly-Plan.md",
      "Reviewing-Your-Week.md",
      "Start-Over.md",
      "Privacy-and-Safety.md",
    ]],
  ];
  for (const [page, requiredDestinations] of navigationContract) {
    const contents = pages.get(page);
    if (contents === undefined) continue;
    const destinations = new Set(
      markdownDestinations(contents).map(({ destination }) => destination),
    );
    for (const destination of requiredDestinations) {
      if (!destinations.has(destination)) {
        reportFailure(
          path.join(wikiRoot, page),
          1,
          "wiki-navigation",
          destination === technicalPrivacySource
            ? "Wiki navigation must link to the technical privacy and security source"
            : `Wiki navigation must link to ${destination}`,
        );
      }
    }
  }

  const home = pages.get("Home.md");
  if (home !== undefined) {
    const image = markdownDestinations(home).find(
      ({ destination, alt }) => destination === representativeWikiAsset && alt !== null,
    );
    if (!image) {
      reportFailure(
        path.join(wikiRoot, "Home.md"),
        1,
        "wiki-image-alt",
        `Home must include ${representativeWikiAsset} with meaningful alternative text`,
      );
    } else if (!hasMeaningfulImageAlt(image.alt)) {
      reportFailure(
        path.join(wikiRoot, "Home.md"),
        image.lineNumber,
        "wiki-image-alt",
        "Representative Wiki image needs meaningful alternative text",
      );
    }
  }

  const readme = await readRequiredFile(
    path.join(root, "README.md"),
    "wiki-bundle",
    "README.md is required",
  );
  const sharedAssetDestination = `docs/wiki/${representativeWikiAsset}`;
  const sharedImage = readme === null
    ? null
    : markdownDestinations(readme).find(
      ({ destination, alt }) => destination === sharedAssetDestination && alt !== null,
    );
  if (!sharedImage) {
    reportFailure(
      path.join(root, "README.md"),
      1,
      "wiki-bundle",
      `Landing page must reference the shared Wiki asset: ${sharedAssetDestination}`,
    );
  } else if (!hasMeaningfulImageAlt(sharedImage.alt)) {
    reportFailure(
      path.join(root, "README.md"),
      sharedImage.lineNumber,
      "wiki-image-alt",
      "Landing page image needs meaningful alternative text",
    );
  }
};

const validateWikiPublication = async () => {
  const workflow = path.join(root, ".github", "workflows", "publish-wiki.yml");
  const contents = await readRequiredFile(
    workflow,
    "wiki-publication",
    "Wiki publication workflow is missing",
  );
  if (contents === null) return;

  const contracts = [
    [/\bworkflow_dispatch\s*:/, "Manual recovery trigger is required"],
    [/\bconcurrency\s*:/, "Serialized publication requires a concurrency group"],
    [/\bgroup\s*:\s*wiki-publication\b/, "Serialized publication must use the Wiki target group"],
    [/\bcontents\s*:\s*write\b/, "Wiki publication requires contents: write"],
    [/\bnpm(?:\.cmd)?\s+run\s+docs:check\b/, "Workflow validates documentation before publishing"],
    [/GitHub Wiki target unavailable/i, "Workflow needs a target-unavailable diagnostic"],
    [/\bdocs\/wiki\//, "Workflow must publish the repository-authored Wiki source"],
    [/Inspect rendered Wiki/i, "Workflow must inspect the rendered Wiki after publication"],
    [/Account-and-Settings/i, "Workflow must inspect the rendered Account and Settings page"],
    [/Troubleshooting/i, "Workflow must inspect the rendered Troubleshooting page"],
    [/Using-Your-Weekly-Plan/, "Workflow must inspect Using Your Weekly Plan after publication"],
    [/Reviewing-Your-Week/, "Workflow must inspect Reviewing Your Week after publication"],
    [/Start-Over/, "Workflow must inspect Start Over after publication"],
  ];

  for (const [pattern, message] of contracts) {
    if (!pattern.test(contents)) {
      reportFailure(workflow, 1, "wiki-publication", message);
    }
  }
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
  for (const { asset, rawDestination } of inlineMarkdownLinks(text)) {
    await validateLocalDestination({
      document,
      lineNumber,
      rawDestination,
      asset,
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

await validateRequiredNavigation();
await validateWikiBundle();
await validateWikiPublication();
await validatePublicIssueTemplates();
await validateSemanticEvidenceChecklist();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Documentation contract is valid.");
}
