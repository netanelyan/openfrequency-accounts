#!/usr/bin/env node
// npm run release-check
//
// The suite as a release needs it (PRA-QA-007): every test, the browser ones in a real Chromium (OF_REQUIRE_BROWSER=1:
// no Chromium is a failure, not a skip), and check:public. A test that fails, is skipped or is left todo fails the
// check. CI runs this on every push (.github/workflows/test.yml); run it by hand before a deploy when CI has not.

import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/core/paths.js';

const env = { ...process.env, OF_REQUIRE_BROWSER: '1' };
const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const tests = run(['--test', '--test-concurrency=1', 'test/*.test.js']);
process.stdout.write(tests.stdout);
process.stderr.write(tests.stderr);
const count = (name) => Number(new RegExp(String.raw`^ℹ ${name} (\d+)\r?$`, 'm').exec(tests.stdout)?.[1] ?? NaN);
const [pass, fail, skipped, todo] = ['pass', 'fail', 'skipped', 'todo'].map(count);
const problems = [];
if (tests.status !== 0 || fail > 0) problems.push(`${Number.isNaN(fail) ? 'the' : fail} failing test(s)`);
if (skipped > 0) problems.push(`${skipped} skipped`);
if (todo > 0) problems.push(`${todo} todo`);
if (Number.isNaN(pass)) problems.push('no test summary in the output');
const pub = run(['scripts/check-public.js']);
process.stdout.write(pub.stdout);
process.stderr.write(pub.stderr);
if (pub.status !== 0) problems.push('check:public');
if (problems.length) {
  console.error(`release-check: not ready: ${problems.join(', ')}`);
  process.exit(1);
}
console.log(`release-check: ${pass} tests passed, none skipped, check:public ok`);
