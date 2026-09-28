/* Servidor estático mínimo para probar la PWA en http://localhost:8080
   (el Service Worker no funciona abriendo el archivo con file://). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png'
};
const port = Number(process.env.PORT) || 8080;

createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(process.cwd(), path.endsWith('/') ? join(path, 'index.html') : path);
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('No encontrado');
    }
}).listen(port, () => console.log(`http://localhost:${port}/`));
