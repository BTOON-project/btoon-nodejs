'use strict';
// index.d.ts compiles for consumers (test/types/consumer.ts), with NodeNext and Bundler module
// resolution, and without the consumer's own `types`: it references the Node.js types it uses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('index.d.ts compiles for consumers (NodeNext and Bundler resolution)', () => {
  const tsc = require.resolve('typescript/bin/tsc');
  for (const project of ['tsconfig.json', 'tsconfig.bundler.json']) {
    try {
      execFileSync(process.execPath, [tsc, '-p', path.join(root, 'test/types', project)], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      assert.fail(`${project}:\n${e.stdout}${e.stderr}`);
    }
  }
});

test('the declared versions are the package version and the spec version', () => {
  const dts = require('node:fs').readFileSync(path.join(root, 'index.d.ts'), 'utf8');
  const btoon = require('..');
  assert.match(dts, new RegExp(`VERSION: '${btoon.VERSION.replace(/\./g, '\\.')}'`));
  assert.match(dts, new RegExp(`SPEC_VERSION: '${btoon.SPEC_VERSION.replace(/\./g, '\\.')}'`));
  assert.equal(btoon.VERSION, require('../package.json').version);
});
