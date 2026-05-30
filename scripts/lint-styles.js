#!/usr/bin/env node
/**
 * scripts/lint-styles.js
 *
 * Flags hardcoded values inside style objects (both inline `style={...}`
 * and `const styles = { ... }`) that should be coming from tokens or
 * recipes (`src/lib/styleTokens.js`, `src/lib/styleRecipes.js`).
 *
 * Run: `npm run lint:styles`
 *
 * Catches:
 *   - Numeric literals on padding/margin/fontSize/borderRadius/gap/... keys
 *     that aren't 0, 1, or already on the spacing/radii/type scale.
 *   - Hardcoded hex/rgb/rgba strings on color-related keys.
 *
 * Skips:
 *   - Files in src/lib/styleTokens.js or src/lib/styleRecipes.js (these
 *     are the source of truth).
 *   - Lines with a trailing `// style-lint-ignore` comment.
 */

const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const ALLOWED_NUMBERS = new Set([0, 1]);
const ALLOWED_SPACING = new Set([4, 8, 12, 16, 20, 24, 32, 48]);
const ALLOWED_RADII = new Set([4, 6, 8, 10, 14, 999]);
const ALLOWED_FONT_SIZES = new Set([10, 11, 12, 13, 14, 16, 18, 22]);

const SPACING_KEYS = new Set([
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'paddingX', 'paddingY',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'rowGap', 'columnGap',
  'top', 'right', 'bottom', 'left',
]);
const RADII_KEYS = new Set([
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
]);
const FONT_SIZE_KEYS = new Set(['fontSize']);
const COLOR_KEYS = new Set([
  'color', 'background', 'backgroundColor', 'borderColor', 'fill', 'stroke',
  'outlineColor',
]);

const SKIP_FILES = new Set([
  path.join(SRC, 'lib/styleTokens.js'),
  path.join(SRC, 'lib/styleRecipes.js'),
  path.join(SRC, 'index.css'),
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.cache' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|jsx)$/.test(entry.name)) yield full;
  }
}

function isAllowed(key, value) {
  if (typeof value !== 'number') return false;
  if (ALLOWED_NUMBERS.has(value)) return true;
  if (SPACING_KEYS.has(key)) return ALLOWED_SPACING.has(value);
  if (RADII_KEYS.has(key)) return ALLOWED_RADII.has(value);
  if (FONT_SIZE_KEYS.has(key)) return ALLOWED_FONT_SIZES.has(value);
  return false;
}

function isHardcodedColor(value) {
  if (typeof value !== 'string') return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return true;
  if (/^rgba?\(/.test(value)) return true;
  if (/^hsla?\(/.test(value)) return true;
  return false;
}

const findings = [];

function record(file, line, message) {
  findings.push({ file, line, message });
}

function checkObjectExpression(node, sourcePath, sourceText) {
  for (const prop of node.properties || []) {
    if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
    const key = prop.key;
    const keyName = key?.name || key?.value;
    if (!keyName) continue;
    const value = prop.value;
    const startLine = prop.loc?.start.line || 0;
    const lineText = sourceText.split('\n')[startLine - 1] || '';
    if (lineText.includes('style-lint-ignore')) continue;

    // Numeric literals
    if (value.type === 'NumericLiteral' || value.type === 'Literal') {
      const v = value.value;
      if (typeof v === 'number') {
        if (
          SPACING_KEYS.has(keyName) ||
          RADII_KEYS.has(keyName) ||
          FONT_SIZE_KEYS.has(keyName)
        ) {
          if (!isAllowed(keyName, v)) {
            record(sourcePath, startLine,
              `${keyName}: ${v} — not on the design scale. Use spacing/radii/fontSizes tokens.`);
          }
        }
      } else if (typeof v === 'string' && COLOR_KEYS.has(keyName)) {
        if (isHardcodedColor(v)) {
          record(sourcePath, startLine,
            `${keyName}: "${v}" — hardcoded color. Use colors token.`);
        }
      }
    }

    // String literal colors
    if (value.type === 'StringLiteral' && COLOR_KEYS.has(keyName)) {
      if (isHardcodedColor(value.value)) {
        record(sourcePath, startLine,
          `${keyName}: "${value.value}" — hardcoded color. Use colors token.`);
      }
    }

    // Nested object expressions (e.g. inside boxShadow shorthand, theme objects)
    if (value.type === 'ObjectExpression') {
      checkObjectExpression(value, sourcePath, sourceText);
    }
  }
}

function lintFile(file) {
  if (SKIP_FILES.has(file)) return;
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx'],
      errorRecovery: true,
    });
  } catch (err) {
    record(file, 0, `Parse error: ${err.message}`);
    return;
  }

  traverse(ast, {
    JSXAttribute(p) {
      if (p.node.name.name !== 'style') return;
      const expr = p.node.value?.expression;
      if (!expr || expr.type !== 'ObjectExpression') return;
      checkObjectExpression(expr, file, code);
    },
    VariableDeclarator(p) {
      const id = p.node.id;
      const init = p.node.init;
      if (!id || id.type !== 'Identifier') return;
      if (!/^(styles|.*Styles)$/.test(id.name)) return;
      if (!init || init.type !== 'ObjectExpression') return;
      // Walk each top-level key, then recurse into nested style blocks
      for (const prop of init.properties || []) {
        if (prop.value?.type === 'ObjectExpression') {
          checkObjectExpression(prop.value, file, code);
        }
      }
    },
  });
}

let count = 0;
for (const file of walk(SRC)) {
  const before = findings.length;
  lintFile(file);
  count += findings.length - before;
}

const strict = process.argv.includes('--strict');
const filterFlag = process.argv.find((a) => a.startsWith('--only='));
const onlyFilter = filterFlag ? filterFlag.slice('--only='.length) : null;

if (findings.length === 0) {
  console.log('No style magic numbers found. Nice.');
  process.exit(0);
}

const filtered = onlyFilter
  ? findings.filter((f) => f.file.includes(onlyFilter))
  : findings;

const byFile = new Map();
for (const f of filtered) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

for (const [file, list] of byFile) {
  const rel = path.relative(ROOT, file);
  console.log(`\n${rel}`);
  for (const f of list) {
    console.log(`  ${f.line}: ${f.message}`);
  }
}

console.log(`\n${filtered.length} finding${filtered.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}.`);
if (onlyFilter) console.log(`(filtered by --only=${onlyFilter}; total project findings: ${findings.length})`);
console.log('Append // style-lint-ignore to a property line to suppress one-off cases.');
console.log('Run with --strict to exit non-zero (use in CI once a page is migrated).');
process.exit(strict ? 1 : 0);
