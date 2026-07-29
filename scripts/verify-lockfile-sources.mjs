#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LOCKFILES = [
  "package-lock.json",
  path.join("apps", "mobile-expo", "package-lock.json"),
];

const DEFAULT_ALLOWED_HOSTS = new Set(["registry.npmjs.org"]);
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function dependencyGroups(rootPackage) {
  return [
    ["dependencies", rootPackage.dependencies],
    ["devDependencies", rootPackage.devDependencies],
    ["optionalDependencies", rootPackage.optionalDependencies],
  ];
}

export function inspectLockfile(
  lockfile,
  {
    filename = "package-lock.json",
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
  } = {},
) {
  const issues = [];
  const packages = lockfile?.packages;

  if (lockfile?.lockfileVersion !== 3) {
    issues.push(`${filename}: lockfileVersion must be 3`);
  }
  if (!packages || typeof packages !== "object") {
    issues.push(`${filename}: packages map is missing`);
    return issues;
  }

  const rootPackage = packages[""] || {};
  for (const [group, dependencies] of dependencyGroups(rootPackage)) {
    for (const [name, spec] of Object.entries(dependencies || {})) {
      if (!EXACT_VERSION.test(spec)) {
        issues.push(
          `${filename}: ${group}.${name} must use an exact version, found ${JSON.stringify(spec)}`,
        );
      }
    }
  }

  for (const [packagePath, descriptor] of Object.entries(packages)) {
    if (!descriptor || typeof descriptor !== "object" || descriptor.link) {
      continue;
    }
    if (!descriptor.resolved) {
      continue;
    }

    let resolved;
    try {
      resolved = new URL(descriptor.resolved);
    } catch {
      issues.push(`${filename}: ${packagePath} has an invalid resolved URL`);
      continue;
    }

    if (resolved.protocol !== "https:") {
      issues.push(`${filename}: ${packagePath} must resolve over HTTPS`);
    }
    if (!allowedHosts.has(resolved.hostname)) {
      issues.push(
        `${filename}: ${packagePath} resolves from unapproved host ${resolved.hostname}`,
      );
    }
    if (resolved.username || resolved.password) {
      issues.push(`${filename}: ${packagePath} resolved URL contains credentials`);
    }
    if (resolved.search || resolved.hash) {
      issues.push(`${filename}: ${packagePath} resolved URL contains query or fragment data`);
    }
    if (!descriptor.integrity) {
      issues.push(`${filename}: ${packagePath} is missing an integrity digest`);
    }
  }

  return issues;
}

export function verifyLockfiles(filenames, options = {}) {
  const issues = [];
  for (const filename of filenames) {
    const absolute = path.resolve(filename);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
    } catch (error) {
      issues.push(`${filename}: cannot read valid JSON (${error.message})`);
      continue;
    }
    issues.push(...inspectLockfile(parsed, { ...options, filename }));
  }
  return issues;
}

function main() {
  const filenames = process.argv.slice(2);
  const targets = filenames.length > 0 ? filenames : DEFAULT_LOCKFILES;
  const issues = verifyLockfiles(targets);
  if (issues.length > 0) {
    console.error("Lockfile source verification failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Verified ${targets.length} lockfile(s): exact direct versions, HTTPS, approved registry, integrity.`);
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main();
}
