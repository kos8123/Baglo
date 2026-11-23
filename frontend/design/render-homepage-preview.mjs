// Prepare the real landing page for Takumi, which has no browser HTTP root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
let html = fs.readFileSync(path.join(directory, 'home.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="\/([^"]+)">/g, (_, name) => `<style>${fs.readFileSync(path.join(directory, name), 'utf8')}</style>`);
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
html = html.replace('</head>', '<style>body{font-family:"Heiti SC",sans-serif} .market-art{transform:none}</style></head>');
fs.writeFileSync('/tmp/baglo-homepage-takumi.html', html);
console.log('/tmp/baglo-homepage-takumi.html');
