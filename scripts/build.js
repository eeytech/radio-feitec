const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
for (const folder of ['radio', 'gestao', 'musicas', 'shared']) {
  fs.cpSync(path.join(root, folder), path.join(output, folder), { recursive: true });
}
console.log('Páginas e músicas preparadas em public/.');
