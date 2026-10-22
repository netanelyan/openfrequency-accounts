#!/usr/bin/env node
// Runs on `npm install` (the "prepare" script): points git at .githooks/, so the
// pre-commit hook runs `npm run check:public` before every commit. Quietly does
// nothing outside a git checkout (a deploy from a tarball, say).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/core/paths.js';

if (existsSync(path.join(ROOT, '.git'))) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT });
    console.log('git hooks: .githooks (pre-commit runs check:public)');
  } catch {
    /* git missing: nothing to install into */
  }
}
