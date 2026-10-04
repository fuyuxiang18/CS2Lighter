import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultProjectPath = fileURLToPath(new URL('..', import.meta.url));
const licenseFilePattern = /^(?:licen[cs]e|copying|copyright|notice)(?:$|[._-])/i;
const licenseFolderPattern = /^(?:licen[cs]es?|legal|notices?)$/i;

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function readDirectory(folder) {
  try {
    return (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function metadataText(value) {
  if (typeof value === 'string') {
    return value;
  }
  return value ? JSON.stringify(value) : 'Not declared';
}

/**
 * Collect installed hoisted/scoped packages, including nested node_modules versions.
 * No network access or dependency installation is needed. The output deliberately
 * includes build dependencies and is an attribution inventory, not a runtime SBOM
 * or a legal assessment. Only this project's node_modules and static/licenses are read.
 *
 * @param {{ projectPath?: string, outputPath?: string }} options
 */
export async function collectThirdPartyLicenses({ projectPath = defaultProjectPath, outputPath } = {}) {
  projectPath = path.resolve(projectPath);
  outputPath ??= path.join(projectPath, 'static', 'THIRD-PARTY-LICENSES.txt');
  const modulesPath = await fs.realpath(path.join(projectPath, 'node_modules'));
  const seenPackages = new Set();
  const packages = [];
  const skippedLinks = [];

  async function readLicenseFiles(packagePath) {
    const files = [];
    async function walk(folder, inLicenseFolder = false) {
      for (const entry of await readDirectory(folder)) {
        const entryPath = path.join(folder, entry.name);
        // Do not follow package-internal symlinks or walk arbitrary source/binary trees.
        if (entry.isDirectory() && (inLicenseFolder || licenseFolderPattern.test(entry.name))) {
          await walk(entryPath, true);
        } else if (entry.isFile() && (inLicenseFolder || licenseFilePattern.test(entry.name))) {
          const content = await fs.readFile(entryPath);
          if (content.includes(0)) {
            continue;
          }
          files.push({
            name: path.relative(packagePath, entryPath).split(path.sep).join('/'),
            text: content.toString('utf8'),
          });
        }
      }
    }
    await walk(packagePath);
    return files;
  }

  async function visitPackage(packagePath) {
    const realPath = await fs.realpath(packagePath);
    if (!isInside(modulesPath, realPath)) {
      skippedLinks.push(path.relative(projectPath, packagePath).split(path.sep).join('/'));
      return;
    }
    if (seenPackages.has(realPath)) {
      return;
    }
    seenPackages.add(realPath);
    let metadata;
    try {
      metadata = JSON.parse(await fs.readFile(path.join(realPath, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    packages.push({
      name: metadata.name ?? path.basename(packagePath),
      version: metadata.version ?? 'unknown',
      location: path.relative(projectPath, packagePath).split(path.sep).join('/'),
      license: metadataText(metadata.license ?? metadata.licenses),
      repository: metadataText(metadata.repository?.url ?? metadata.repository ?? metadata.homepage),
      author: metadataText(metadata.author),
      files: await readLicenseFiles(realPath),
    });
    await visitModules(path.join(realPath, 'node_modules'));
  }

  async function visitModules(folder) {
    for (const entry of await readDirectory(folder)) {
      if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) {
        continue;
      }
      const entryPath = path.join(folder, entry.name);
      if (entry.name.startsWith('@')) {
        // Scoped containers must also stay within node_modules.
        if (!isInside(modulesPath, await fs.realpath(entryPath))) {
          skippedLinks.push(path.relative(projectPath, entryPath).split(path.sep).join('/'));
          continue;
        }
        for (const scopedEntry of await readDirectory(entryPath)) {
          if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
            await visitPackage(path.join(entryPath, scopedEntry.name));
          }
        }
      } else {
        await visitPackage(entryPath);
      }
    }
  }

  await visitModules(modulesPath);
  packages.sort((a, b) =>
    `${a.name}@${a.version}:${a.location}`.localeCompare(`${b.name}@${b.version}:${b.location}`, 'en'),
  );
  if (packages.length === 0) {
    throw new Error('No installed packages found; install dependencies before collecting licenses.');
  }
  const separator = '='.repeat(80);
  const missingLicenseFiles = packages
    .filter((item) => item.files.length === 0)
    .map((item) => `${item.name}@${item.version}`);
  const chunks = [
    'CS2Lighter - third-party attribution inventory\n',
    'Generated by scripts/collect-third-party-licenses.mjs from installed node_modules.\n',
    'This inventory includes development/build dependencies; it is not a claim that every listed package is shipped at runtime.\n',
    'Package declarations and available license/notice texts are preserved without resolving conflicting declarations.\n',
    'Package-root LICENSE/LICENCE/COPYING/COPYRIGHT/NOTICE files and license/legal/notice directories are included.\n',
    'Packages without those text files retain their declared license and repository below; this is not a legal audit.\n',
    'Additional native component texts and source URLs are retained in static/licenses (licenses beside this file when packaged).\n',
    'Electron and Chromium notices are also supplied by the Electron packager.\n\n',
    `Installed package instances: ${packages.length}\n`,
    `Package instances without an included license text: ${missingLicenseFiles.length}\n\n`,
    'INSTALLED DEPENDENCY LIST\n',
    ...packages.map((item) => `${item.name}@${item.version} | ${item.license} | ${item.location}\n`),
    '\nPACKAGE ATTRIBUTIONS AND ORIGINAL TEXTS\n',
  ];
  for (const item of packages) {
    chunks.push(
      `\n${separator}\n${item.name}@${item.version}\nLocation: ${item.location}\nDeclared license: ${item.license}\nRepository: ${item.repository}\nAuthor: ${item.author}\n`,
    );
    if (item.files.length === 0) {
      chunks.push(
        'No license text found in the package-root files or license directories inspected. Consult the declared license and upstream repository.\n',
      );
    }
    for (const file of item.files) {
      chunks.push(`\n--- BEGIN ${file.name} ---\n`, file.text, `\n--- END ${file.name} ---\n`);
    }
  }

  const nativeFolder = path.join(projectPath, 'static', 'licenses');
  let nativeSources = [];
  try {
    nativeSources = JSON.parse(await fs.readFile(path.join(nativeFolder, 'SOURCES.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (nativeSources.length > 0) {
    chunks.push('\nNATIVE COMPONENT ATTRIBUTIONS AND ORIGINAL TEXTS\n');
    for (const source of nativeSources) {
      const sourcePath = path.resolve(nativeFolder, source.file);
      if (!isInside(nativeFolder, sourcePath) || !isInside(nativeFolder, await fs.realpath(sourcePath))) {
        throw new Error(`Native license path must stay inside static/licenses: ${source.file}`);
      }
      chunks.push(
        `\n${separator}\n${source.component} ${source.version}\nSource: ${source.url}\nLocal file: licenses/${source.file}\n`,
      );
      if (source.note) {
        chunks.push(`Note: ${source.note}\n`);
      }
      chunks.push(
        `\n--- BEGIN ${source.file} ---\n`,
        await fs.readFile(sourcePath, 'utf8'),
        `\n--- END ${source.file} ---\n`,
      );
    }
  }
  if (skippedLinks.length > 0) {
    chunks.push('\nLINKS OUTSIDE PROJECT NODE_MODULES (NOT READ)\n', ...skippedLinks.sort().map((item) => `${item}\n`));
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, chunks.join(''), 'utf8');
  return {
    outputPath,
    packageCount: packages.length,
    missingLicenseFiles,
    nativeLicenseCount: nativeSources.length,
    skippedLinks,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await collectThirdPartyLicenses();
  console.log(
    `Wrote ${result.outputPath}: ${result.packageCount} package instances, ${result.nativeLicenseCount} native license texts, ${result.missingLicenseFiles.length} packages without local license text.`,
  );
}
