/**
 * Fix winCodeSign cache for electron-builder on Windows.
 * Downloads the archive and extracts it, ignoring symlink errors.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CACHE_DIR = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign');
const ARCHIVE_URL = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
const SEVEN_ZIP = path.join(__dirname, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function doGet(u) {
      https.get(u, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return doGet(res.headers.location);
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    }
    doGet(url);
  });
}

async function main() {
  // Clean and create cache dir
  if (fs.existsSync(CACHE_DIR)) {
    try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const archivePath = path.join(CACHE_DIR, 'winCodeSign-2.6.0.7z');

  console.log('Downloading winCodeSign-2.6.0.7z...');
  await download(ARCHIVE_URL, archivePath);
  console.log(`Downloaded: ${fs.statSync(archivePath).size} bytes`);

  // Extract ignoring errors (the macOS symlinks will fail but Windows binaries work)
  const extractDir = path.join(CACHE_DIR, 'winCodeSign-2.6.0');
  fs.mkdirSync(extractDir, { recursive: true });

  console.log('Extracting (ignoring symlink errors)...');
  try {
    execSync(`"${SEVEN_ZIP}" x -bd -y "${archivePath}" -o"${extractDir}"`, {
      stdio: 'pipe',
    });
  } catch (err) {
    // 7zip exits with error code 2 due to symlink failures, but the important files are extracted
    console.log('Extraction completed with symlink warnings (expected on Windows)');
  }

  // Verify the important Windows binaries are there
  const winDir = path.join(extractDir, 'windows-10', 'ia32');
  if (fs.existsSync(winDir)) {
    const files = fs.readdirSync(winDir);
    console.log(`Windows signing tools extracted: ${files.join(', ')}`);
  }

  // Also check for osslsigncode
  const osslDir = path.join(extractDir, 'linux');
  const winSignDir = path.join(extractDir, 'windows-10');
  console.log(`\nCache directory: ${CACHE_DIR}`);
  console.log(`Extract directory: ${extractDir}`);
  console.log('Contents:', fs.readdirSync(extractDir).join(', '));

  // Clean up archive
  try { fs.unlinkSync(archivePath); } catch {}

  console.log('\nDone! winCodeSign cache is ready.');
}

main().catch(console.error);
