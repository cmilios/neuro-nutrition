import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const validatorPath = path.resolve("docs/check.mjs");
const baseFixture = {
  "package.json": JSON.stringify({ scripts: {} }),
  ".env.example": "VITE_PUBLIC_URL=https://example.test\n",
};

const withFixture = async (files, run) => {
  const root = await mkdtemp(path.join(tmpdir(), "neuro-docs-check-"));
  try {
    await Promise.all(
      Object.entries({ ...baseFixture, ...files }).map(async ([file, contents]) => {
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
