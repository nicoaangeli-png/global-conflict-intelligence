const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const source = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const target = join(root, 'public', 'lab', 'cesium');
const version = JSON.parse(readFileSync(join(root, 'node_modules', 'cesium', 'package.json'), 'utf8')).version;
const marker = join(target, '.version');
if (existsSync(marker) && existsSync(join(target, 'Cesium.js')) && readFileSync(marker, 'utf8') === version) process.exit(0);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const directory of ['Assets', 'ThirdParty', 'Widgets', 'Workers'])
  cpSync(join(source, directory), join(target, directory), { recursive: true });
cpSync(join(source, 'Cesium.js'), join(target, 'Cesium.js'));
writeFileSync(marker, version);
console.log(`Prepared Cesium ${version} lab assets`);
