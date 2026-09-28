/* Rasteriza los SVG de icons/ a los PNG que piden Android, iOS y el manifest. */
import sharp from 'sharp';

const jobs = [
    ['icons/icon.svg', 'icons/icon-192.png', 192],
    ['icons/icon.svg', 'icons/icon-512.png', 512],
    ['icons/icon-maskable.svg', 'icons/icon-maskable-512.png', 512],
    ['icons/icon-maskable.svg', 'icons/apple-touch-icon.png', 180],
    ['icons/icon.svg', 'icons/favicon-32.png', 32]
];

for (const [src, out, size] of jobs) {
    await sharp(src, { density: Math.ceil((size / 64) * 72) }).resize(size, size).png().toFile(out);
    console.log(`${out} (${size}x${size})`);
}
