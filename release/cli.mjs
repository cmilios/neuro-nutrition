#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs, promisify } from "node:util";

import {
  createRehearsalReport,
  createReleaseManifest,
  verifyReleaseManifest,
} from "./releaseCandidate.mjs";

const root = process.cwd();
const execFileAsync = promisify(execFile);

async function currentCommit() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: root,
  });
  return stdout.trim();
}

async function requireCleanCandidateSource() {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: root },
  );
  if (stdout.trim()) {
    throw new Error(
      "Release candidate source must be committed in a clean worktree.",
    );
  }
}

function requireValue(values, name) {
  const value = values[name];
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(root, file), "utf8"));
}

async function writeJson(file, value) {
  const output = path.resolve(root, file);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(`${path.relative(root, output)}\n`);
}

const [command] = process.argv.slice(2);
const args = process.argv.slice(3);

try {
  if (command === "manifest") {
    const { values } = parseArgs({
      args,
      options: {
        commit: { type: "string" },
        "project-ref": { type: "string" },
        region: { type: "string" },
        "function-version": { type: "string", multiple: true },
        out: { type: "string" },
      },
    });
    await requireCleanCandidateSource();
    const commit = requireValue(values, "commit");
    if (commit !== (await currentCommit())) {
      throw new Error("--commit must equal the checked-out HEAD.");
    }
    const functionVersions = Object.fromEntries(
      (values["function-version"] ?? []).map((entry) => {
        const separator = entry.indexOf("=");
        if (separator < 1) {
          throw new Error("--function-version must use name=version.");
        }
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    );
    const manifest = await createReleaseManifest({
      root,
      commit,
      targetProjectRef: requireValue(values, "project-ref"),
      targetRegion: requireValue(values, "region"),
      functionVersions,
    });
    await writeJson(requireValue(values, "out"), manifest);
  } else if (command === "verify") {
    const { values } = parseArgs({
      args,
      options: { manifest: { type: "string" } },
    });
    const result = await verifyReleaseManifest(
      root,
      await readJson(requireValue(values, "manifest")),
      { actualCommit: await currentCommit() },
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  } else if (command === "report") {
    const { values } = parseArgs({
      args,
      options: {
        manifest: { type: "string" },
        results: { type: "string" },
        "production-project-ref": { type: "string" },
        out: { type: "string" },
      },
    });
    const manifest = await readJson(requireValue(values, "manifest"));
    const verification = await verifyReleaseManifest(root, manifest, {
      actualCommit: await currentCommit(),
    });
    const report = createRehearsalReport({
      candidateId: manifest.candidateId,
      targetProjectRef: manifest.target.projectRef,
      productionProjectRef: requireValue(values, "production-project-ref"),
      manifestValid: verification.valid,
      results: await readJson(requireValue(values, "results")),
    });
    await writeJson(requireValue(values, "out"), report);
    if (report.decision !== "go") process.exitCode = 1;
  } else {
    throw new Error("Usage: release/cli.mjs <manifest|verify|report> [options]");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
