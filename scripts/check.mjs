import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';
import messages from '../public/locales/pt-PT.js';

async function filesIn(directory) {
  const entries = await readdir(directory, {withFileTypes:true});
  const groups = await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(join(directory,entry.name)) : [join(directory,entry.name)]));
  return groups.flat();
}
const files = ['server.mjs', ...(await Promise.all(['api','lib','public','scripts','tests'].map(filesIn))).flat()];
for (const file of files.filter(file=>['.js','.mjs'].includes(extname(file)))) {
  const result = spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,`${file}: ${result.stderr}`);
  const source = await readFile(file,'utf8');
  for (const [,key] of source.matchAll(/\bt\(['"]([^'"]+)['"]/g)) assert.ok(Object.hasOwn(messages,key),`${file}: unknown translation ${key}`);
}
const html = await readFile('public/index.html','utf8');
for (const [,key] of html.matchAll(/data-i18n(?:-aria-label|-content)?="([^"]+)"/g)) assert.ok(Object.hasOwn(messages,key),`index.html: unknown translation ${key}`);
for (const [,asset] of html.matchAll(/(?:src|href)="(\/[^"#]*)"/g)) await readFile(join('public',asset));
const manifest = JSON.parse(await readFile('package.json','utf8'));
const lock = JSON.parse(await readFile('package-lock.json','utf8'));
assert.deepEqual(manifest.dependencies,lock.packages[''].dependencies,'Production dependencies and lockfile differ');
assert.deepEqual(manifest.devDependencies,lock.packages[''].devDependencies,'Development dependencies and lockfile differ');
console.log('Syntax, translation references, local assets and lockfile checks passed.');
