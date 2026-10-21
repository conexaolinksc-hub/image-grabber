const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputPath = path.join(__dirname, 'icon.jpg');
const outputIco = path.join(__dirname, 'icon.ico');

async function createIco() {
  // Generate a 256x256 PNG buffer from the JPG
  const pngBuffer = await sharp(inputPath)
    .resize(256, 256, { fit: 'cover' })
    .png()
    .toBuffer();

  // Build ICO file with PNG data (modern ICO format supports embedded PNGs)
  // ICO Header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type: ICO
  header.writeUInt16LE(1, 4);     // Image count: 1

  // Directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);                       // Width (0 = 256)
  entry.writeUInt8(0, 1);                       // Height (0 = 256)
  entry.writeUInt8(0, 2);                       // Color palette
  entry.writeUInt8(0, 3);                       // Reserved
  entry.writeUInt16LE(1, 4);                    // Color planes
  entry.writeUInt16LE(32, 6);                   // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);     // Image data size
  entry.writeUInt32LE(6 + 16, 12);              // Offset to image data

  const ico = Buffer.concat([header, entry, pngBuffer]);
  fs.writeFileSync(outputIco, ico);
  console.log(`Created icon.ico (${ico.length} bytes) - 256x256 PNG inside ICO`);
}

createIco().catch(console.error);
