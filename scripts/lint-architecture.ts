/**
 * lint-architecture.ts — Custom architectural linter
 *
 * Enforces:
 * 1. Layer dependency direction (Types → Config → Store → Service → Runtime → UI)
 * 2. Domain isolation (no cross-domain imports except Providers)
 * 3. File size limits (300 lines max)
 * 4. Naming conventions
 *
 * Run: npx tsx scripts/lint-architecture.ts
 *
 * REMEDIATION INSTRUCTIONS (for agents):
 * Each error message below tells you exactly what to fix.
 * Do not suppress errors — fix the underlying violation.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname, basename } from "path";

const DOMAINS_ROOT = "packages/ui/src/domains";
const PROVIDERS_ROOT = "packages/ui/src/providers";
const MAX_FILE_LINES = 300;

// Layer ordering — lower index = earlier in the dependency chain
const LAYERS = ["types", "config", "store", "service", "runtime", "ui"] as const;
type Layer = (typeof LAYERS)[number];

const LAYER_INDEX: Record<string, number> = {};
LAYERS.forEach((l, i) => (LAYER_INDEX[l] = i));

interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
  fix: string;
}

const violations: Violation[] = [];

function addViolation(
  file: string,
  line: number,
  rule: string,
  message: string,
  fix: string
) {
  violations.push({ file, line, rule, message, fix });
}

function getLayer(filePath: string): Layer | null {
  for (const layer of LAYERS) {
    if (filePath.includes(`/${layer}/`)) return layer;
  }
  return null;
}

function getDomain(filePath: string): string | null {
  const match = filePath.match(/domains\/([^/]+)\//);
  return match ? match[1] : null;
}

function walkDir(dir: string, callback: (file: string) => void) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist")
          continue;
        walkDir(fullPath, callback);
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        callback(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist yet — that's fine during early development
  }
}

function checkFile(filePath: string) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const relPath = relative(process.cwd(), filePath);
  const layer = getLayer(relPath);
  const domain = getDomain(relPath);

  // Rule 1: File size limit
  if (lines.length > MAX_FILE_LINES) {
    addViolation(
      relPath,
      lines.length,
      "file-size",
      `File has ${lines.length} lines (max: ${MAX_FILE_LINES}).`,
      `Split this file into smaller modules. Each file should have a single responsibility.`
    );
  }

  // Rule 2 & 3: Import analysis
  lines.forEach((line, i) => {
    const importMatch = line.match(
      /^import\s+.*from\s+['"]([^'"]+)['"]/
    );
    if (!importMatch) return;

    const importPath = importMatch[1];
    const lineNum = i + 1;

    // Only check relative imports
    if (!importPath.startsWith(".") && !importPath.startsWith("@/")) return;

    // Check layer direction
    if (layer) {
      const importedLayer = getLayer(importPath);
      if (importedLayer) {
        const currentIdx = LAYER_INDEX[layer];
        const importedIdx = LAYER_INDEX[importedLayer];
        if (importedIdx > currentIdx) {
          addViolation(
            relPath,
            lineNum,
            "layer-direction",
            `Layer '${layer}' imports from '${importedLayer}' (backward dependency).`,
            `Move this logic to the '${importedLayer}' layer, or extract a shared type into 'types/'. Layer order: ${LAYERS.join(" → ")}.`
          );
        }
      }
    }

    // Check domain isolation
    if (domain) {
      const importedDomain = getDomain(importPath);
      if (importedDomain && importedDomain !== domain) {
        // Check if it's importing from providers (allowed)
        if (!importPath.includes("/providers/")) {
          addViolation(
            relPath,
            lineNum,
            "domain-isolation",
            `Domain '${domain}' imports directly from domain '${importedDomain}'.`,
            `Cross-domain communication must go through Providers. Create or use an existing Provider in 'providers/' to share this state.`
          );
        }
      }
    }
  });

  // Rule 4: Naming conventions
  const fileName = basename(filePath);
  if (layer === "ui" && filePath.includes("/components/")) {
    if (fileName[0] !== fileName[0].toUpperCase() && !fileName.startsWith("use")) {
      addViolation(
        relPath,
        1,
        "naming",
        `Component file '${fileName}' should be PascalCase.`,
        `Rename to '${fileName[0].toUpperCase() + fileName.slice(1)}'.`
      );
    }
  }
  if (layer === "ui" && filePath.includes("/hooks/")) {
    if (!fileName.startsWith("use")) {
      addViolation(
        relPath,
        1,
        "naming",
        `Hook file '${fileName}' should start with 'use'.`,
        `Rename to 'use${fileName[0].toUpperCase() + fileName.slice(1)}'.`
      );
    }
  }
  if (layer === "service" && !fileName.includes(".service.") && fileName !== "index.ts") {
    addViolation(
      relPath,
      1,
      "naming",
      `Service file '${fileName}' should match pattern '<name>.service.ts'.`,
      `Rename to '${fileName.replace(/\.ts$/, ".service.ts")}'.`
    );
  }

  // Rule 5: No `any` type
  lines.forEach((line, i) => {
    if (line.match(/:\s*any\b/) || line.match(/as\s+any\b/)) {
      addViolation(
        relPath,
        i + 1,
        "no-any",
        `Usage of 'any' type detected.`,
        `Replace 'any' with a proper type. Use 'unknown' if the type is truly unknown, then narrow it with type guards.`
      );
    }
  });
}

// Main
console.log("=== Architectural Lint ===\n");

walkDir(DOMAINS_ROOT, checkFile);
walkDir(PROVIDERS_ROOT, checkFile);

if (violations.length === 0) {
  console.log("✅ No violations found.\n");
  process.exit(0);
} else {
  console.log(`❌ ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.log(`${v.file}:${v.line}`);
    console.log(`  Rule: ${v.rule}`);
    console.log(`  Error: ${v.message}`);
    console.log(`  Fix: ${v.fix}`);
    console.log("");
  }
  process.exit(1);
}
