import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppContext } from "../../app.js";
import { HttpError } from "../../lib/errors.js";

const CLAWHUB_BASE_URL = "https://clawhub.ai";
const CLAWHUB_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30_000;

type SkillSource = "clawhub" | "local" | "github" | "builtin" | "catalog";
type SkillScope = "user" | "workspace";

type DiscoveredSkill = {
  slug: string;
  id?: string;
  name: string;
  description: string | null;
  source: SkillSource;
  version: string | null;
  installed: boolean;
  enabled: boolean;
  location?: string;
  path?: string;
  owner?: string;
  updatedAt?: number;
  createdAt?: number;
  downloads?: number;
  stars?: number;
  installs?: number;
};

type LoadedSkill = {
  slug: string;
  name: string;
  description: string;
  content: string;
};

type SkillsConfig = { disabled: string[] };

type ClawHubSearchResult = {
  score?: number;
  slug: string;
  displayName?: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
};

type ClawHubDetail = {
  skill: {
    slug: string;
    displayName: string;
    summary?: string;
    tags?: Record<string, string>;
    stats?: { downloads?: number; stars?: number; installsAllTime?: number; installsCurrent?: number; versions?: number };
    createdAt: number;
    updatedAt: number;
  } | null;
  latestVersion?: { version: string; createdAt: number; changelog?: string } | null;
  metadata?: { os?: string[] | null; systems?: string[] | null } | null;
  owner?: { handle?: string | null; displayName?: string | null; image?: string | null } | null;
};

type ClawHubPackageDetail = {
  package: {
    name: string;
    displayName: string;
    family: string;
    channel: string;
    isOfficial: boolean;
    summary?: string | null;
    ownerHandle?: string | null;
    latestVersion?: string | null;
    verificationTier?: string | null;
    verification?: {
      tier?: string;
      scope?: string;
      summary?: string;
      sourceRepo?: string;
      hasProvenance?: boolean;
      scanStatus?: string;
    } | null;
  } | null;
  owner?: { handle?: string | null; displayName?: string | null; image?: string | null } | null;
};

let installedCache: { skills: LoadedSkill[]; loadedAt: number } | null = null;

function openclawRoot() {
  return path.join(os.homedir(), ".openclaw");
}

function userSkillsRoot() {
  return path.join(openclawRoot(), "skills");
}

function workspaceSkillsRoot() {
  return path.join(openclawRoot(), "workspace", "skills");
}

function skillRootForScope(scope: string | undefined): string {
  if (scope !== undefined && scope !== "user" && scope !== "workspace") {
    throw new HttpError(400, "scope must be 'user' or 'workspace'", "INVALID_SKILL_INPUT");
  }
  const root = scope === "workspace" ? workspaceSkillsRoot() : userSkillsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function configPath() {
  return path.join(openclawRoot(), "skills-config.json");
}

function catalogPath() {
  return path.join(openclawRoot(), "skills-catalog.json");
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function readConfig(): SkillsConfig {
  const parsed = readJsonFile<Partial<SkillsConfig>>(configPath(), {});
  return { disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [] };
}

function writeConfig(config: SkillsConfig) {
  writeJsonFile(configPath(), config);
}

function invalidateSkillCache() {
  installedCache = null;
}

function isSkillEnabled(slug: string): boolean {
  return !readConfig().disabled.includes(slug);
}

function setSkillEnabled(slug: string, enabled: boolean) {
  const config = readConfig();
  if (enabled) config.disabled = config.disabled.filter((s) => s !== slug);
  else if (!config.disabled.includes(slug)) config.disabled.push(slug);
  writeConfig(config);
  invalidateSkillCache();
  return { slug, enabled };
}

function parseSkillFrontmatter(raw: string): { name?: string; description?: string; version?: string; source?: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const block = match[1];
  const field = (name: string) => {
    const value = block.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
    return value && value !== "undefined" ? value : undefined;
  };
  return { name: field("name"), description: field("description"), version: field("version"), source: field("source") };
}

function localSkillDetailFromDir(dir: string) {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const meta = parseSkillFrontmatter(raw);
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  const content = frontmatter ? raw.slice(frontmatter[0].length).trim() : raw.trim();
  const slug = path.basename(dir);
  return {
    slug,
    name: meta.name ?? slug,
    description: meta.description ?? "",
    version: meta.version ?? "1.0.0",
    source: (meta.source as SkillSource | undefined) ?? "local",
    content,
    location: dir,
  };
}

function scanLocalSkillsIn(root: string): DiscoveredSkill[] {
  if (!fs.existsSync(root)) return [];
  const results: DiscoveredSkill[] = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const detail = localSkillDetailFromDir(path.join(root, entry.name));
      if (!detail) continue;
      results.push({
        slug: detail.slug,
        id: detail.slug,
        name: detail.name,
        description: detail.description,
        source: detail.source === "clawhub" || detail.source === "catalog" || detail.source === "builtin" ? detail.source : "local",
        version: detail.version,
        path: detail.location,
        location: detail.location,
        installed: true,
        enabled: isSkillEnabled(detail.slug),
        updatedAt: fs.statSync(path.join(detail.location, "SKILL.md")).mtimeMs,
        createdAt: fs.statSync(path.join(detail.location, "SKILL.md")).ctimeMs,
      });
    }
  } catch {
    // Ignore unreadable skill directories; one bad skill should not break the page.
  }
  return results;
}

function getAllLocalSkills(): DiscoveredSkill[] {
  const bySlug = new Map<string, DiscoveredSkill>();
  for (const skill of [...scanLocalSkillsIn(userSkillsRoot()), ...scanLocalSkillsIn(workspaceSkillsRoot())]) {
    if (!bySlug.has(skill.slug)) bySlug.set(skill.slug, skill);
  }
  return [...bySlug.values()];
}

function findLocalSkill(slug: string) {
  for (const root of [userSkillsRoot(), workspaceSkillsRoot()]) {
    const detail = localSkillDetailFromDir(path.join(root, slug));
    if (detail) return detail;
  }
  return null;
}

function isSkillInstalled(slug: string): boolean {
  return Boolean(findLocalSkill(slug));
}

function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function readCatalog() {
  return readJsonFile<Array<{ slug: string; name: string; description: string; source: string; version: string }>>(catalogPath(), []);
}

function addSkillToCatalog(skill: { slug: string; name: string; description: string; source: string; version: string }) {
  const catalog = readCatalog();
  const index = catalog.findIndex((s) => s.slug === skill.slug);
  if (index >= 0) catalog[index] = skill;
  else catalog.push(skill);
  writeJsonFile(catalogPath(), catalog);
}

function removeSkillFromCatalog(slug: string) {
  const catalog = readCatalog();
  const filtered = catalog.filter((s) => s.slug !== slug);
  if (filtered.length !== catalog.length) writeJsonFile(catalogPath(), filtered);
}

async function clawhubFetch<T>(urlPath: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const url = new URL(urlPath, CLAWHUB_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAWHUB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`ClawHub ${urlPath} failed (${res.status})`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchClawHubSkills(query: string, limit: number) {
  const response = await clawhubFetch<{ results?: ClawHubSearchResult[] }>("/api/v1/search", {
    q: query.trim(),
    limit: String(limit),
    nonSuspiciousOnly: "true",
  });
  return response.results ?? [];
}

async function fetchClawHubSkillDetail(slug: string) {
  return clawhubFetch<ClawHubDetail>(`/api/v1/skills/${encodeURIComponent(slug)}`);
}

async function fetchClawHubPackageDetail(slug: string) {
  return clawhubFetch<ClawHubPackageDetail>(`/api/v1/packages/${encodeURIComponent(slug)}`);
}

function sortResults(results: DiscoveredSkill[], sort: string) {
  switch (sort) {
    case "downloads":
    case "trending":
      results.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
      break;
    case "stars":
      results.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
      break;
    case "installs":
      results.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));
      break;
    case "updated":
      results.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      break;
    case "name":
      results.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default:
      break;
  }
}

function loadedSkills() {
  const now = Date.now();
  if (installedCache && now - installedCache.loadedAt < CACHE_TTL_MS) return installedCache.skills;
  const disabled = new Set(readConfig().disabled);
  const skills = getAllLocalSkills()
    .filter((skill) => !disabled.has(skill.slug))
    .map((skill) => {
      const local = findLocalSkill(skill.slug);
      if (!local?.content) return null;
      return { slug: skill.slug, name: skill.name, description: skill.description ?? "", content: local.content } satisfies LoadedSkill;
    })
    .filter((skill): skill is LoadedSkill => Boolean(skill));
  installedCache = { skills, loadedAt: now };
  return skills;
}

export function getSkillEnabledMap() {
  const disabled = new Set(readConfig().disabled);
  return Object.fromEntries(getAllLocalSkills().map((skill) => [skill.slug, !disabled.has(skill.slug)]));
}

export function getActiveSkills() {
  return loadedSkills();
}

export function toggleSkill(input: { slug?: string; skillId?: string; enabled?: boolean }) {
  const slug = String(input.slug || input.skillId || "").trim();
  if (!slug) throw new HttpError(400, "slug is required", "INVALID_SKILL_INPUT");
  return setSkillEnabled(slug, input.enabled !== false);
}

export async function skillsInstalledLocal(input?: { query?: string; sort?: string }) {
  const query = input?.query?.trim().toLowerCase();
  const sort = input?.sort ?? "name";
  const results = getAllLocalSkills().filter((skill) => {
    if (!query) return true;
    return skill.slug.toLowerCase().includes(query) || skill.name.toLowerCase().includes(query) || (skill.description ?? "").toLowerCase().includes(query);
  });
  sortResults(results, sort);
  return { query: input?.query ?? null, sort, results, skills: results, warnings: [] as string[], sources: results.length ? ["local"] : [], nextCursor: null };
}

export async function skillsDiscover(input?: { query?: string; limit?: number; sort?: string; includeLocal?: boolean; includeClawHub?: boolean }) {
  const query = input?.query?.trim();
  const limit = Math.min(Math.max(Number(input?.limit ?? 50), 1), 100);
  const sort = input?.sort ?? "downloads";
  const includeLocal = input?.includeLocal ?? true;
  const includeClawHub = input?.includeClawHub ?? true;
  const warnings: string[] = [];
  const sources: string[] = [];
  const results: DiscoveredSkill[] = [];
  const seen = new Set<string>();

  if (includeLocal) {
    for (const skill of getAllLocalSkills()) {
      results.push(skill);
      seen.add(skill.slug);
    }
    if (results.length) sources.push("local");
  }

  if (includeClawHub) {
    try {
      const queries = query ? [query] : ["code", "test", "git", "api", "deploy", "security", "data", "review", "debug"];
      const perQuery = query ? limit : Math.max(10, Math.ceil(limit / queries.length));
      for (const q of queries) {
        if (results.length >= limit) break;
        for (const hub of await searchClawHubSkills(q, perQuery)) {
          if (seen.has(hub.slug)) continue;
          seen.add(hub.slug);
          const installed = isSkillInstalled(hub.slug);
          results.push({
            slug: hub.slug,
            name: hub.displayName ?? hub.slug,
            description: hub.summary ?? "",
            source: "clawhub",
            version: hub.version ?? null,
            installed,
            enabled: installed ? isSkillEnabled(hub.slug) : false,
            updatedAt: hub.updatedAt,
          });
          if (results.length >= limit) break;
        }
      }
      sources.push("clawhub");

      if (!["relevance", "name", "updated"].includes(sort)) {
        const clawhubResults = results.filter((skill) => skill.source === "clawhub");
        const details = await Promise.allSettled(clawhubResults.map((skill) => fetchClawHubSkillDetail(skill.slug)));
        for (let i = 0; i < clawhubResults.length; i += 1) {
          const detail = details[i];
          const stats = detail.status === "fulfilled" ? detail.value.skill?.stats : undefined;
          clawhubResults[i].downloads = stats?.downloads ?? 0;
          clawhubResults[i].stars = stats?.stars ?? 0;
          clawhubResults[i].installs = stats?.installsAllTime ?? stats?.installsCurrent ?? 0;
        }
      }
    } catch (error) {
      warnings.push(`ClawHub unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  sortResults(results, sort);
  const sliced = results.slice(0, limit);
  return { query: input?.query ?? null, sort, results: sliced, skills: sliced, warnings, sources, nextCursor: null };
}

export async function skillsDetail(input: { slug?: string }) {
  const slug = String(input.slug || "").trim();
  if (!slug) throw new HttpError(400, "slug is required", "INVALID_SKILL_INPUT");
  const [detail, packageDetail] = await Promise.all([
    fetchClawHubSkillDetail(slug).catch(() => ({ skill: null } as ClawHubDetail)),
    fetchClawHubPackageDetail(slug).catch(() => null),
  ]);
  const local = findLocalSkill(slug);
  const installed = Boolean(local);
  const localSkill = local
    ? {
        slug: local.slug,
        displayName: local.name,
        summary: local.description,
        tags: {},
        createdAt: 0,
        updatedAt: 0,
      }
    : null;
  return {
    ...detail,
    skill: detail.skill ?? localSkill,
    installed,
    enabled: installed ? isSkillEnabled(slug) : false,
    localContent: local?.content ?? null,
    localVersion: local?.version ?? null,
    package: packageDetail?.package
      ? {
          channel: packageDetail.package.channel,
          isOfficial: packageDetail.package.isOfficial,
          verification: packageDetail.package.verification ?? null,
          verificationTier: packageDetail.package.verificationTier ?? null,
        }
      : null,
  };
}

export async function skillsVersions(input: { slug?: string; limit?: number; cursor?: string }) {
  const slug = String(input.slug || "").trim();
  if (!slug) throw new HttpError(400, "slug is required", "INVALID_SKILL_INPUT");
  return clawhubFetch<{ items: Array<{ version: string; createdAt: number; changelog?: string }>; nextCursor?: string | null }>(
    `/api/v1/skills/${encodeURIComponent(slug)}/versions`,
    { limit: input.limit ? String(input.limit) : undefined, cursor: input.cursor },
  );
}

export async function installSkill(context: AppContext, input: { source?: string; slug?: string; version?: string; localPath?: string; scope?: SkillScope; force?: boolean }) {
  const source = input.source ?? "clawhub";
  const scope = input.scope ?? "user";

  if (source === "local") {
    if (!input.localPath) throw new HttpError(400, "localPath is required for local source", "INVALID_SKILL_INPUT");
    const localPath = input.localPath;
    const sourceFile = path.join(localPath, "SKILL.md");
    if (!fs.existsSync(sourceFile)) throw new HttpError(404, `No SKILL.md found in ${localPath}`, "SKILL_NOT_FOUND");
    const raw = fs.readFileSync(sourceFile, "utf8");
    const meta = parseSkillFrontmatter(raw);
    const slug = input.slug ?? path.basename(localPath);
    const targetDir = path.join(skillRootForScope(scope), slug);
    if (fs.existsSync(targetDir) && !input.force) throw new HttpError(400, `Skill '${slug}' already installed at ${targetDir}. Use force to overwrite.`, "SKILL_ALREADY_INSTALLED");
    fs.rmSync(targetDir, { recursive: true, force: true });
    copyDirSync(localPath, targetDir);
    invalidateSkillCache();
    return {
      status: "installed",
      skill: { slug, name: meta.name ?? slug, description: meta.description ?? "", source: "local", version: meta.version ?? null, installed: true, enabled: true },
      location: targetDir,
      actions: ["copied local skill"],
      warnings: [] as string[],
    };
  }

  if (source === "clawhub") {
    const slug = String(input.slug || "").trim();
    if (!slug) throw new HttpError(400, "slug is required for clawhub source", "INVALID_SKILL_INPUT");
    const targetDir = path.join(skillRootForScope(scope), slug);
    if (fs.existsSync(path.join(targetDir, "SKILL.md")) && !input.force) {
      const local = findLocalSkill(slug);
      return {
        status: "already-installed",
        skill: { slug, name: local?.name ?? slug, description: local?.description ?? "", source: "clawhub", version: local?.version ?? null, installed: true, enabled: isSkillEnabled(slug) },
        location: targetDir,
        actions: [] as string[],
        warnings: [] as string[],
      };
    }

    const detail = await context.gateway.request<{ slug: string; name?: string; displayName?: string; description?: string; summary?: string; version?: string; content?: string }>(
      "skills.detail",
      { slug, version: input.version },
      30_000,
    );
    const name = detail.name ?? detail.displayName ?? detail.slug ?? slug;
    const description = detail.description ?? detail.summary ?? "";
    const version = detail.version ?? input.version ?? "1.0.0";
    const content = detail.content ?? description;
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, "SKILL.md"),
      ["---", `name: ${name}`, `description: ${description}`, `version: ${version}`, "source: clawhub", "---", "", `# ${name}`, "", content, ""].join("\n"),
      "utf8",
    );
    addSkillToCatalog({ slug, name, description, source: "clawhub", version });
    invalidateSkillCache();
    return {
      status: "installed",
      skill: { slug, name, description, source: "clawhub", version, installed: true, enabled: true },
      location: targetDir,
      actions: ["created SKILL.md", "added to catalog"],
      warnings: [] as string[],
    };
  }

  throw new HttpError(400, `Unsupported skill source: ${source}`, "INVALID_SKILL_INPUT");
}

export function uninstallSkill(input: { slug?: string }) {
  const slug = String(input.slug || "").trim();
  if (!slug) throw new HttpError(400, "slug is required", "INVALID_SKILL_INPUT");
  let removed = false;
  for (const root of [userSkillsRoot(), workspaceSkillsRoot()]) {
    const dir = path.join(root, slug);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed = true;
    }
  }
  if (removed) {
    removeSkillFromCatalog(slug);
    invalidateSkillCache();
  }
  return { removed, slug };
}
