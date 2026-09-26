// Chrome manifest icons must be raster images. Keep SVG as the editable source.
const path = require('node:path');
const sharp = require('sharp');
const icons = path.resolve(__dirname, '../icons');
Promise.all([16, 32, 48, 128].map(size =>
  sharp(path.join(icons, 'quotalens.svg'), { density: 384 })
    .resize(size, size).png().toFile(path.join(icons, `icon${size}.png`))
)).catch(error => { console.error(error); process.exitCode = 1; });
