import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = join(import.meta.dirname, '..');

const componentSource = [
  readFileSync(join(projectRoot, 'App.tsx'), 'utf8'),
  ...readdirSync(join(projectRoot, 'components'))
    .filter((fileName) => fileName.endsWith('.tsx'))
    .map((fileName) =>
      readFileSync(join(projectRoot, 'components', fileName), 'utf8')
    ),
].join('\n');

const themeCss = readFileSync(join(projectRoot, 'styles.css'), 'utf8');

describe('dark theme surface coverage', () => {
  it('remaps every pale background used by the application', () => {
    const paleBackgrounds = new Set(
      componentSource.match(
        /(?<!:)\bbg-(?:slate|emerald|teal|blue|indigo|amber|yellow|orange|red|rose)-(?:50|100|200)\b/g,
      ) ?? [],
    );

    const missingDarkMappings = [...paleBackgrounds].filter((className) => {
      const escapedClassName = className.replace('/', '\\/');
      return !themeCss.includes(`.dark .${escapedClassName}`);
    });

    expect(missingDarkMappings).toEqual([]);
  });
});
