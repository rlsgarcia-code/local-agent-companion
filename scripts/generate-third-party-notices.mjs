import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export const APPROVED_LICENSE_EXPRESSIONS = Object.freeze(["0BSD", "Apache-2.0", "BSD-3-Clause", "ISC", "MIT"]);

const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|copying|notice)(?:$|[ ._-])/i;
const LICENSE_OVERRIDES = Object.freeze({
  "@cfworker/json-schema": ["licenses/overrides/cfworker-json-schema-mit.txt"],
  "js-tiktoken": ["licenses/overrides/js-tiktoken-mit.txt"],
  "langsmith": ["licenses/overrides/langsmith-mit.txt"]
});

export function packagesFromMetafile(metafile) {
  if (!metafile || typeof metafile !== "object" || !metafile.inputs || typeof metafile.inputs !== "object") {
    throw new Error("An esbuild metafile with input records is required for license inventory generation.");
  }

  const packages = new Map();
  for (const inputPath of Object.keys(metafile.inputs)) {
    const descriptor = packageFromInputPath(inputPath);
    if (!descriptor) continue;
    const current = packages.get(descriptor.root) ?? { ...descriptor, inputCount: 0 };
    current.inputCount += 1;
    packages.set(descriptor.root, current);
  }
  return [...packages.values()].sort(comparePackageRoots);
}

export async function generateThirdPartyNotices({
  metafile,
  additionalPackages = [],
  projectRoot = process.cwd(),
  outputDirectory = path.join(projectRoot, "dist", "licenses")
}) {
  const roots = packagesFromMetafile(metafile);
  for (const name of additionalPackages) {
    if (typeof name !== "string" || !name.trim()) throw new Error("Additional package names must be non-empty strings.");
    const relativeRoot = path.posix.join("node_modules", ...name.trim().split("/"));
    if (!roots.some((entry) => entry.root === relativeRoot)) {
      roots.push({ name: name.trim(), root: relativeRoot, inputCount: 0, native: true });
    }
  }
  roots.sort(comparePackageRoots);

  const entries = [];
  for (const root of roots) {
    entries.push(await inspectPackage(projectRoot, root));
  }
  entries.sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version) || left.packageRoot.localeCompare(right.packageRoot)
  );

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generatedFrom: "esbuild metafile plus explicitly packaged native runtime components",
    approvedLicenseExpressions: [...APPROVED_LICENSE_EXPRESSIONS],
    packageCount: entries.length,
    packages: entries.map(({ licenseTexts: _licenseTexts, ...entry }) => entry)
  };
  await writeFile(
    path.join(outputDirectory, "third-party-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(outputDirectory, "THIRD_PARTY-LICENSES.txt"),
    renderNotices(entries),
    "utf8"
  );
  return manifest;
}

async function inspectPackage(projectRoot, descriptor) {
  const packageRoot = path.resolve(projectRoot, descriptor.root);
  const metadataRoot = await resolveMetadataRoot(projectRoot, descriptor);
  const packageJsonPath = path.join(metadataRoot, "package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read bundled package metadata for ${descriptor.name} at ${displayPath(projectRoot, packageJsonPath)}: ${errorMessage(error)}`);
  }

  const name = nonEmptyString(packageJson.name) ?? descriptor.name;
  const metadataVersion = nonEmptyString(packageJson.version);
  const version = descriptor.version ?? metadataVersion;
  const license = declaredLicense(packageJson.license ?? packageJson.licenses);
  if (!version) throw new Error(`Bundled package ${name} does not declare a version.`);
  if (!license || /^(?:UNLICENSED|SEE LICENSE IN)/i.test(license)) {
    throw new Error(`Bundled package ${name}@${version} does not declare a usable SPDX license expression.`);
  }
  if (!APPROVED_LICENSE_EXPRESSIONS.includes(license)) {
    throw new Error(`Bundled package ${name}@${version} declares unreviewed license “${license}”. Review it and update the explicit allowlist before packaging.`);
  }

  const candidateSources = await packageLicenseSources(metadataRoot);
  for (const override of overrideSources(name)) {
    candidateSources.push(path.resolve(projectRoot, override));
  }
  const licenseTexts = await readUniqueLicenseTexts(projectRoot, candidateSources);
  if (!licenseTexts.length) {
    throw new Error(`Bundled package ${name}@${version} declares ${license} but no license or notice text is available.`);
  }

  const warnings = [];
  if (name.startsWith("chromadb-js-bindings-")) {
    warnings.push("The published native binding declares MIT but ships no standalone license text; the authoritative upstream Chroma Apache-2.0 license is included as a conservative additional notice.");
  }
  if (descriptor.version && metadataVersion && descriptor.version !== metadataVersion) {
    warnings.push(`Bundled source-map metadata identifies ${name}@${descriptor.version}; license text and project metadata were sourced from installed ${name}@${metadataVersion}.`);
  }
  return {
    name,
    version,
    license,
    repository: repositoryUrl(packageJson.repository),
    packageRoot: displayPath(projectRoot, packageRoot),
    ...(metadataRoot !== packageRoot ? { metadataSource: displayPath(projectRoot, metadataRoot) } : {}),
    bundledInputCount: descriptor.inputCount,
    nativeComponent: Boolean(descriptor.native),
    licenseSources: licenseTexts.map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
    ...(warnings.length ? { warnings } : {}),
    licenseTexts
  };
}

async function resolveMetadataRoot(projectRoot, descriptor) {
  const candidates = descriptor.metadataRoots?.length ? descriptor.metadataRoots : [descriptor.root];
  for (const candidate of candidates) {
    const resolved = path.resolve(projectRoot, candidate);
    try {
      await readFile(path.join(resolved, "package.json"), "utf8");
      return resolved;
    } catch {
      // Try the next physical package location. Bundled sourcemaps can name pnpm paths
      // from the publisher's machine that do not exist in an npm installation.
    }
  }
  return path.resolve(projectRoot, candidates[0]);
}

async function packageLicenseSources(packageRoot) {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(packageRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function overrideSources(name) {
  if (name.startsWith("chromadb-js-bindings-")) return ["node_modules/chromadb/LICENSE"];
  return LICENSE_OVERRIDES[name] ?? [];
}

async function readUniqueLicenseTexts(projectRoot, sources) {
  const unique = new Map();
  for (const source of sources) {
    let text;
    try {
      text = (await readFile(source, "utf8")).trim();
    } catch (error) {
      throw new Error(`Cannot read license source ${displayPath(projectRoot, source)}: ${errorMessage(error)}`);
    }
    if (!text) continue;
    const sha256 = createHash("sha256").update(text).digest("hex");
    if (!unique.has(sha256)) {
      unique.set(sha256, { path: displayPath(projectRoot, source), sha256, text });
    }
  }
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function renderNotices(entries) {
  const divider = "=".repeat(80);
  const minorDivider = "-".repeat(80);
  const sections = entries.map((entry) => {
    const metadata = [
      `${entry.name}@${entry.version}`,
      `Declared license: ${entry.license}`,
      ...(entry.repository ? [`Repository: ${entry.repository}`] : []),
      `Bundled as: ${entry.nativeComponent ? "native runtime component" : "JavaScript bundle input"}`,
      `License source${entry.licenseSources.length === 1 ? "" : "s"}: ${entry.licenseSources.map((source) => source.path).join(", ")}`,
      ...(entry.warnings ?? []).map((warning) => `Compliance note: ${warning}`)
    ];
    const texts = entry.licenseTexts.map((licenseText, index) =>
      `${minorDivider}\nNotice text ${index + 1} · ${licenseText.path}\n${minorDivider}\n${licenseText.text}`
    );
    return `${divider}\n${metadata.join("\n")}\n${texts.join("\n\n")}`;
  });
  return [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "Generated deterministically from the esbuild input graph and explicitly packaged native components.",
    `Packages: ${entries.length}`,
    "Do not edit this file directly; run npm run build to regenerate it.",
    "",
    ...sections,
    divider,
    ""
  ].join("\n");
}

function packageFromInputPath(inputPath) {
  const normalized = String(inputPath).replaceAll("\\", "/");
  const virtualPnpm = packageFromVirtualPnpmPath(normalized);
  if (virtualPnpm) return virtualPnpm;
  const marker = "node_modules/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const packageStart = markerIndex + marker.length;
  const segments = normalized.slice(packageStart).split("/").filter(Boolean);
  if (!segments.length) return undefined;
  const nameSegments = segments[0].startsWith("@") ? segments.slice(0, 2) : segments.slice(0, 1);
  if (!nameSegments.length || nameSegments.some((segment) => !segment)) return undefined;
  const name = nameSegments.join("/");
  const root = `${normalized.slice(0, packageStart)}${name}`;
  return { name, root, inputCount: 0, native: false };
}

function packageFromVirtualPnpmPath(normalized) {
  const match = normalized.match(/^(.*?node_modules\/(?:@[^/]+\/)?[^/]+)\/.*?node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/|$)/);
  if (!match) return undefined;
  const [, ownerRoot, pnpmPackage, name] = match;
  const versionSeparator = pnpmPackage.lastIndexOf("@");
  const version = versionSeparator > 0 ? pnpmPackage.slice(versionSeparator + 1) : undefined;
  const virtualPrefix = normalized.slice(0, normalized.lastIndexOf("node_modules/.pnpm/"));
  const root = `${virtualPrefix}node_modules/.pnpm/${pnpmPackage}/node_modules/${name}`;
  return {
    name,
    root,
    version,
    metadataRoots: [`${ownerRoot}/node_modules/${name}`, `node_modules/${name}`],
    inputCount: 0,
    native: false
  };
}

function declaredLicense(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const values = value.map((entry) => declaredLicense(entry)).filter(Boolean);
    return values.length === 1 ? values[0] : values.join(" OR ");
  }
  if (value && typeof value === "object" && typeof value.type === "string") return value.type.trim();
  return "";
}

function repositoryUrl(value) {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? value.url : "";
  if (typeof raw !== "string" || !raw.trim()) return "";
  return raw.trim()
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git\+ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
}

function displayPath(projectRoot, targetPath) {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(targetPath));
  return relative.replaceAll("\\", "/");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function comparePackageRoots(left, right) {
  return left.name.localeCompare(right.name) || left.root.localeCompare(right.root);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
