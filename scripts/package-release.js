import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = git(['rev-parse', '--verify', 'HEAD']).stdout.trim();
const sourceRef = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
  allowedStatuses: [0, 1],
}).stdout.trim() || 'DETACHED_HEAD';
const pkg = JSON.parse(git(['show', `${sourceCommit}:package.json`]).stdout);
const releaseFolder = `ManeFlow-v${pkg.version}-Unified-Source`;
const output = path.resolve(root, '..', `${releaseFolder}.zip`);

if (fs.existsSync(output)) fs.rmSync(output, { force: true });

// A release is a snapshot of one reviewed commit, never a recursive copy of
// the working directory. `git archive` excludes .git and every untracked file
// by construction, preventing credentials, local databases, and build debris
// from silently entering a source release.
git([
  'archive',
  '--format=zip',
  `--prefix=${releaseFolder}/`,
  `--output=${output}`,
  sourceCommit,
]);

console.log(JSON.stringify({
  archive: output,
  sourceCommit,
  sourceRef,
  version: pkg.version,
}, null, 2));

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  const allowedStatuses = options.allowedStatuses ?? [0];
  if (!allowedStatuses.includes(result.status)) {
    throw new Error(
      `Git command failed (${args.join(' ')}): ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
  return result;
}
