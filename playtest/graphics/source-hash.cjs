const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = function sourceHash(root) {
  const hash=crypto.createHash('sha256');
  function walk(name) {
    const file=path.join(root,name);
    if(fs.statSync(file).isDirectory()) for(const child of fs.readdirSync(file).sort()) walk(name+'/'+child);
    else { hash.update(name+'\0'); hash.update(fs.readFileSync(file)); hash.update('\0'); }
  }
  for(const name of ['src','assets','vendor','index.html']) walk(name);
  return hash.digest('hex');
};
