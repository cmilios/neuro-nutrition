import path from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import {
  APPLICATION_BASE_PATH,
  OAUTH_VERIFICATION_PATH,
  PASSWORD_RECOVERY_PATH,
} from '../services/applicationRoutes';

export const GITHUB_PAGES_ROUTE_PATHS = [
  PASSWORD_RECOVERY_PATH,
  OAUTH_VERIFICATION_PATH,
];

export const copyGithubPagesRouteEntrypoints = async (
  outputDirectory: string,
) => {
  for (const routePath of GITHUB_PAGES_ROUTE_PATHS) {
    const routeDirectory = path.resolve(
      outputDirectory,
      routePath.slice(APPLICATION_BASE_PATH.length),
    );
    await mkdir(routeDirectory, { recursive: true });
    await copyFile(
      path.resolve(outputDirectory, 'index.html'),
      path.join(routeDirectory, 'index.html'),
    );
  }
};
