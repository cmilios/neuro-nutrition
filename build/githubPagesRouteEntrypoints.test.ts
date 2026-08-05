import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { copyGithubPagesRouteEntrypoints } from './githubPagesRouteEntrypoints';

const temporaryDirectories: string[] = [];

describe('copyGithubPagesRouteEntrypoints', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it('creates direct-entry documents for every client-side application route', async () => {
    const outputDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'neuronutrition-pages-routes-'),
    );
    temporaryDirectories.push(outputDirectory);
    await writeFile(
      path.join(outputDirectory, 'index.html'),
      '<!doctype html><title>NeuroNutrition</title>',
    );

    await copyGithubPagesRouteEntrypoints(outputDirectory);

    await expect(readFile(
      path.join(outputDirectory, 'recover-password/index.html'),
      'utf8',
    )).resolves.toContain('<title>NeuroNutrition</title>');
    await expect(readFile(
      path.join(outputDirectory, 'verify-oauth/index.html'),
      'utf8',
    )).resolves.toContain('<title>NeuroNutrition</title>');
  });
});
