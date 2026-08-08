import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const validatorPath = path.resolve("docs/check.mjs");
const baseFixture = {
  "package.json": JSON.stringify({ scripts: { "docs:check": "node docs/check.mjs" } }),
  ".env.example": "VITE_PUBLIC_URL=https://example.test\n",
  "README.md": [
    "# Example project",
    "",
    "![A synthetic Weekly Plan showing Monday meals](docs/wiki/assets/weekly-plan-overview.png)",
    "",
    "[Privacy and security](docs/privacy-and-security.md)",
    "[Security reporting](SECURITY.md)",
    "",
  ].join("\n"),
  "docs/privacy-and-security.md": "# Privacy and security\n\n[Security reporting](../SECURITY.md)\n",
  "SECURITY.md": "# Security policy\n\n[Privacy and security](docs/privacy-and-security.md)\n",
  "docs/wiki/Home.md": [
    "# Home",
    "",
    "![A synthetic Weekly Plan showing Monday meals](assets/weekly-plan-overview.png)",
    "",
    "[Get started](https://github.com/cmilios/neuro-nutrition/wiki/Getting-Started)",
    "[Privacy and Safety](https://github.com/cmilios/neuro-nutrition/wiki/Privacy-and-Safety)",
    "",
  ].join("\n"),
  "docs/wiki/Getting-Started.md": "# Getting Started\n\n[Return home](https://github.com/cmilios/neuro-nutrition/wiki)\n",
  "docs/wiki/Privacy-and-Safety.md": [
    "# Privacy and Safety",
    "",
    "[Technical details](https://github.com/cmilios/neuro-nutrition/blob/main/docs/privacy-and-security.md)",
    "[Return home](https://github.com/cmilios/neuro-nutrition/wiki)",
    "",
  ].join("\n"),
  "docs/wiki/_Sidebar.md": [
    "- [Home](https://github.com/cmilios/neuro-nutrition/wiki)",
    "- [Getting Started](https://github.com/cmilios/neuro-nutrition/wiki/Getting-Started)",
    "- [Privacy and Safety](https://github.com/cmilios/neuro-nutrition/wiki/Privacy-and-Safety)",
    "",
  ].join("\n"),
  "docs/wiki/assets/weekly-plan-overview.png": "synthetic image fixture\n",
  ".github/workflows/publish-wiki.yml": [
    "name: Publish Wiki",
    "on:",
    "  push:",
    "    branches: [main]",
    "    paths: [docs/wiki/**]",
    "  workflow_dispatch:",
    "permissions:",
    "  contents: write",
    "concurrency:",
    "  group: wiki-publication",
    "  cancel-in-progress: false",
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: npm run docs:check",
    "      - run: echo 'GitHub Wiki target unavailable'",
    "      - run: rsync docs/wiki/ wiki-target/",
    "      - name: Inspect rendered Wiki",
    "        run: curl https://example.test/wiki",
    "",
  ].join("\n"),
};

const withFixture = async (files, run) => {
  const root = await mkdtemp(path.join(tmpdir(), "neuro-docs-check-"));
  try {
    await Promise.all(
      Object.entries({ ...baseFixture, ...files }).map(async ([file, contents]) => {
        if (contents === null) return;
        const target = path.join(root, file);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }),
    );
    return run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const runCheck = (root) =>
  spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8",
  });

const expectContractFailure = async (files, ...diagnostics) => {
  await withFixture(files, (root) => {
    const result = runCheck(root);
    expect(result.status).not.toBe(0);
    for (const diagnostic of diagnostics) {
      expect(result.stderr).toMatch(diagnostic);
    }
  });
};

test("a broken Markdown target identifies the source document and contract", async () => {
  await expectContractFailure(
    { "README.md": "See [missing guidance](docs/missing.md).\n" },
    /README\.md:1 \[markdown-link\]/,
    /docs\/missing\.md/,
  );
});

test("a documented npm command must name a project script", async () => {
  await expectContractFailure(
    { "README.md": "Run `npm run missing` before contributing.\n" },
    /README\.md:1 \[npm-script\]/,
    /missing/,
  );
});

test("a documented direct npm lifecycle command must name a project script", async () => {
  await expectContractFailure(
    { "README.md": "Run `npm.cmd test` before contributing.\n" },
    /README\.md:1 \[npm-script\]/,
    /test/,
  );
});

test("a documented public environment variable must belong to the public configuration contract", async () => {
  await expectContractFailure(
    { "README.md": "Configure `VITE_UNKNOWN_TOKEN` locally.\n" },
    /README\.md:1 \[public-env\]/,
    /VITE_UNKNOWN_TOKEN/,
  );
});

test("a broken Markdown anchor identifies the source document and contract", async () => {
  await expectContractFailure(
    {
      "README.md": "See [setup](guide.md#missing-section).\n",
      "guide.md": "# Available section\n",
    },
    /README\.md:1 \[markdown-anchor\]/,
    /guide\.md#missing-section/,
  );
});

test("a broken local HTML image identifies the source document and asset contract", async () => {
  await expectContractFailure(
    { "README.md": '<img alt="Example" src="docs/assets/missing.png">\n' },
    /README\.md:1 \[markdown-asset\]/,
    /docs\/assets\/missing\.png/,
  );
});

test("a broken reference-style Markdown target identifies its source document", async () => {
  await expectContractFailure(
    { "README.md": "See [the guide][setup].\n\n[setup]: docs/missing.md\n" },
    /README\.md:3 \[markdown-link\]/,
    /docs\/missing\.md/,
  );
});

test("a broken shortcut-style Markdown target identifies its source document", async () => {
  await expectContractFailure(
    { "README.md": "See [setup].\n\n[setup]: docs/missing.md\n" },
    /README\.md:3 \[markdown-link\]/,
    /docs\/missing\.md/,
  );
});

test("a missing required Wiki page identifies the publication bundle contract", async () => {
  await expectContractFailure(
    { "docs/wiki/Getting-Started.md": null },
    /docs\/wiki\/Getting-Started\.md:1 \[wiki-bundle\]/,
    /required Wiki page is missing/i,
  );
});

test("a missing Privacy and Safety page identifies the publication bundle contract", async () => {
  await expectContractFailure(
    { "docs/wiki/Privacy-and-Safety.md": null },
    /docs\/wiki\/Privacy-and-Safety\.md:1 \[wiki-bundle\]/,
    /required Wiki page is missing/i,
  );
});

test("the landing page must navigate to the technical privacy and security sources", async () => {
  await expectContractFailure(
    { "README.md": "# Example project\n" },
    /README\.md:1 \[required-navigation\]/,
    /docs\/privacy-and-security\.md/,
    /SECURITY\.md/,
  );
});

test("the Wiki privacy summary must link to its repository technical source", async () => {
  await expectContractFailure(
    { "docs/wiki/Privacy-and-Safety.md": "# Privacy and Safety\n\n[Return home](https://github.com/cmilios/neuro-nutrition/wiki)\n" },
    /docs\/wiki\/Privacy-and-Safety\.md:1 \[wiki-navigation\]/,
    /technical privacy and security source/i,
  );
});

test("Wiki Home must navigate to Getting Started", async () => {
  await expectContractFailure(
    { "docs/wiki/Home.md": "# Home\n" },
    /docs\/wiki\/Home\.md:1 \[wiki-navigation\]/,
    /Getting-Started\.md/,
  );
});

test("the representative Wiki image requires meaningful alternative text", async () => {
  await expectContractFailure(
    {
      "docs/wiki/Home.md": [
        "# Home",
        "",
        "![Screenshot](assets/weekly-plan-overview.png)",
        "",
        "[Get started](Getting-Started.md)",
        "",
      ].join("\n"),
    },
    /docs\/wiki\/Home\.md:3 \[wiki-image-alt\]/,
    /meaningful alternative text/i,
  );
});

test("the Wiki publication workflow carries the recovery and safety contract", async () => {
  await expectContractFailure(
    {
      ".github/workflows/publish-wiki.yml": [
        "name: Publish Wiki",
        "on: [push]",
        "permissions:",
        "  contents: read",
        "jobs: {}",
        "",
      ].join("\n"),
    },
    /\.github\/workflows\/publish-wiki\.yml:1 \[wiki-publication\]/,
    /manual recovery trigger/i,
    /serialized publication/i,
    /contents: write/i,
    /validates documentation before publishing/i,
    /target-unavailable diagnostic/i,
    /inspect the rendered Wiki/i,
  );
});
