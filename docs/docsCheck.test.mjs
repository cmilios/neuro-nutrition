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
  ].join("\n"),
  "docs/wiki/Home.md": [
    "# Home",
    "",
    "![A synthetic Weekly Plan showing Monday meals](assets/weekly-plan-overview.png)",
    "",
    "[Get started](https://github.com/cmilios/neuro-nutrition/wiki/Getting-Started)",
    "[Use your Weekly Plan](https://github.com/cmilios/neuro-nutrition/wiki/Using-Your-Weekly-Plan)",
    "[Review your week](https://github.com/cmilios/neuro-nutrition/wiki/Reviewing-Your-Week)",
    "[Start Over](https://github.com/cmilios/neuro-nutrition/wiki/Start-Over)",
    "",
  ].join("\n"),
  "docs/wiki/Getting-Started.md": "# Getting Started\n\n[Return home](https://github.com/cmilios/neuro-nutrition/wiki)\n",
  "docs/wiki/Using-Your-Weekly-Plan.md": "# Using Your Weekly Plan\n\n[Return home](https://github.com/cmilios/neuro-nutrition/wiki)\n",
  "docs/wiki/Reviewing-Your-Week.md": "# Reviewing Your Week\n\n[Return home](https://github.com/cmilios/neuro-nutrition/wiki)\n",
  "docs/wiki/Start-Over.md": "# Start Over\n\n[Return home](https://github.com/cmilios/neuro-nutrition/wiki)\n",
  "docs/wiki/_Sidebar.md": [
    "- [Home](https://github.com/cmilios/neuro-nutrition/wiki)",
    "- [Getting Started](https://github.com/cmilios/neuro-nutrition/wiki/Getting-Started)",
    "- [Using Your Weekly Plan](https://github.com/cmilios/neuro-nutrition/wiki/Using-Your-Weekly-Plan)",
    "- [Reviewing Your Week](https://github.com/cmilios/neuro-nutrition/wiki/Reviewing-Your-Week)",
    "- [Start Over](https://github.com/cmilios/neuro-nutrition/wiki/Start-Over)",
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

test("a missing Weekly Plan journey page identifies the publication bundle contract", async () => {
  await expectContractFailure(
    { "docs/wiki/Using-Your-Weekly-Plan.md": null },
    /docs\/wiki\/Using-Your-Weekly-Plan\.md:1 \[wiki-bundle\]/,
    /required Wiki page is missing/i,
  );
});

test("a missing Meal Review page identifies the publication bundle contract", async () => {
  await expectContractFailure(
    { "docs/wiki/Reviewing-Your-Week.md": null },
    /docs\/wiki\/Reviewing-Your-Week\.md:1 \[wiki-bundle\]/,
    /required Wiki page is missing/i,
  );
});

test("a missing Start Over page identifies the publication bundle contract", async () => {
  await expectContractFailure(
    { "docs/wiki/Start-Over.md": null },
    /docs\/wiki\/Start-Over\.md:1 \[wiki-bundle\]/,
    /required Wiki page is missing/i,
  );
});

test("Wiki Home must navigate to Getting Started", async () => {
  await expectContractFailure(
    { "docs/wiki/Home.md": "# Home\n" },
    /docs\/wiki\/Home\.md:1 \[wiki-navigation\]/,
    /Getting-Started\.md/,
  );
});

test("Wiki Home and sidebar navigate to every Weekly Plan journey page", async () => {
  await expectContractFailure(
    {
      "docs/wiki/Home.md": [
        "# Home",
        "",
        "![A synthetic Weekly Plan showing Monday meals](assets/weekly-plan-overview.png)",
        "",
        "[Get started](Getting-Started.md)",
        "",
      ].join("\n"),
      "docs/wiki/_Sidebar.md": [
        "- [Home](Home.md)",
        "- [Getting Started](Getting-Started.md)",
        "",
      ].join("\n"),
    },
    /docs\/wiki\/Home\.md:1 \[wiki-navigation\].*Using-Your-Weekly-Plan\.md/,
    /docs\/wiki\/_Sidebar\.md:1 \[wiki-navigation\].*Reviewing-Your-Week\.md/,
    /docs\/wiki\/_Sidebar\.md:1 \[wiki-navigation\].*Start-Over\.md/,
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
