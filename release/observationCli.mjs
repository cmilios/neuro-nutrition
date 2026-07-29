#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { createDeliveryGateReport } from "./observationGate.mjs";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string" },
  },
});

try {
  if (!values.input || !values.out) {
    throw new Error("Usage: observationCli.mjs --input <json> --out <json>");
  }
  const input = JSON.parse(await readFile(path.resolve(values.input), "utf8"));
  const report = createDeliveryGateReport(input);
  const output = path.resolve(values.out);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${path.relative(process.cwd(), output)}\n`);
  if (report.decision !== "delivered") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
