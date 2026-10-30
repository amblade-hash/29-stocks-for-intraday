// Inlines the tested engine files into the page (the artifact can't load local scripts by path).
const fs = require('fs');
const engine = ['ta.js', 'stMomentum.js', 'piLevels.js', 'dualMacd.js'].map((f) => fs.readFileSync(`engine/${f}`, 'utf8')).join('\n');
const page = fs.readFileSync('src/page.html', 'utf8').replace('/*__ENGINE__*/', () => engine);

fs.writeFileSync('intraday-top-27.html', page);
console.log('built', page.length, 'bytes');
