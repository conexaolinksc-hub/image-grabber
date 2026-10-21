const express = require('express');
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const cors = require('cors');
const compression = require('compression');
const JSZip = require('jszip');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

// Reusable HTTP/HTTPS agents with Keep-Alive for high throughput and reduced latency
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });

function getAgent(url) {
  return url.startsWith('https') ? httpsAgent : httpAgent;
}

const app = express();
app.use(cors());
app.use(compression()); // Gzip/Brotli compression for high performance
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
}));

/**
 * Start the server, trying ports starting from initialPort (default: 5000 or process.env.PORT).
 * Returns a Promise that resolves to the actual port used.
 */
function startServer(initialPort = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    let port = initialPort;
    const maxAttempts = 20;

    function tryPort(attempt) {
      if (attempt >= maxAttempts) {
        return reject(new Error('Could not find an available port'));
      }

      const server = app.listen(port, () => {
        console.log(`\n  🖼️  Image Grabber running at http://localhost:${port}\n`);
        resolve(port);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${port} is busy, trying ${port + 1}...`);
          port++;
          tryPort(attempt + 1);
        } else {
          reject(err);
        }
      });
    }

    tryPort(0);
  });
}

// If run directly (npm run dev), start immediately
if (require.main === module) {
  startServer().catch(console.error);
}

// Export for Electron
module.exports = { startServer, app };

// =============================================
//  INSTAGRAM HELPERS (High-Performance Parallel)
// =============================================

function isInstagramUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\//i.test(url);
}

function normalizeInstagramUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    let href = u.href;
    if (!href.endsWith('/')) href += '/';
    return href;
  } catch {
    return url;
  }
}

function getInstagramUrlType(url) {
  if (/\/p\/[A-Za-z0-9_-]+/i.test(url)) return 'post';
  if (/\/reel\/[A-Za-z0-9_-]+/i.test(url)) return 'reel';
  if (/\/tv\/[A-Za-z0-9_-]+/i.test(url)) return 'tv';
  if (/\/stories\/[A-Za-z0-9_.]+/i.test(url)) return 'story';
  if (/instagram\.com\/[A-Za-z0-9_.]+\/?$/i.test(url)) return 'profile';
  return 'unknown';
}

function unescapeInstagramUrl(str) {
  if (!str) return str;
  return str
    .replace(/\\u0026/g, '&')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, '')
    .replace(/\\"/g, '"');
}

/**
 * Parallelized Instagram extraction with multiple concurrent strategies.
 */
async function extractInstagramImages(url) {
  const normalizedUrl = normalizeInstagramUrl(url);
  const urlType = getInstagramUrlType(normalizedUrl);
  const images = new Map();

  function addImage(imgUrl, meta = {}) {
    if (!imgUrl || imgUrl.startsWith('data:')) return;
    const clean = unescapeInstagramUrl(imgUrl);
    if (!clean) return;
    if (/\.(svg|ico)(\?|$)/i.test(clean)) return;
    if (/\/s(64|128|150|240|320)x\1\//i.test(clean)) return;

    let dedupeKey = clean;
    try {
      const u = new URL(clean);
      const pathParts = u.pathname.split('/');
      const filename = pathParts[pathParts.length - 1];
      if (filename) dedupeKey = filename;
    } catch {}

    const existing = images.get(dedupeKey);
    const newWidth = meta.width || 0;

    if (!existing || newWidth > (existing.width || 0)) {
      images.set(dedupeKey, {
        url: clean,
        alt: meta.alt || (existing?.alt) || 'Instagram Image',
        width: newWidth || (existing?.width) || 0,
        height: meta.height || (existing?.height) || 0,
        source: meta.source || 'instagram',
      });
    }
  }

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };

  let pageTitle = 'Instagram';
  let shortcode = null;
  const shortcodeMatch = normalizedUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (shortcodeMatch) {
    shortcode = shortcodeMatch[2];
  }
  const isPost = urlType === 'post' || urlType === 'reel' || urlType === 'tv';

  // Strategy 1: Embed Page
  async function runEmbedStrategy() {
    if (!isPost || !shortcode) return;
    try {
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      const res = await fetch(embedUrl, {
        headers: { ...browserHeaders, 'Referer': 'https://www.instagram.com/' },
        agent: getAgent(embedUrl),
        timeout: 8000,
      });
      if (!res.ok) return;
      const html = await res.text();
      const $embed = cheerio.load(html);

      const embedCaption = $embed('.Caption').text().trim() || $embed('.CaptionUsername').text().trim();
      if (embedCaption && pageTitle === 'Instagram') {
        pageTitle = embedCaption.substring(0, 100);
      }

      $embed('img').each((_, el) => {
        const src = $embed(el).attr('src') || '';
        if (src.includes('cdninstagram') || src.includes('fbcdn') || src.includes('scontent')) {
          addImage(src, { alt: $embed(el).attr('alt') || 'Instagram Image', source: 'instagram-embed' });
        }
      });

      $embed('img[srcset]').each((_, el) => {
        const srcset = $embed(el).attr('srcset') || '';
        const candidates = srcset.split(',').map(s => s.trim());
        let bestUrl = '', bestWidth = 0;
        candidates.forEach(c => {
          const parts = c.split(/\s+/);
          const w = parseInt((parts[1] || '').replace('w', ''), 10) || 0;
          if (w > bestWidth) {
            bestWidth = w;
            bestUrl = parts[0];
          }
        });
        if (bestUrl) addImage(bestUrl, { width: bestWidth, source: 'instagram-embed-hd' });
      });

      // Parse display_resources & display_url inside scripts
      const displayUrlMatches = html.match(/"display_url"\s*:\s*"([^"]+)"/g);
      if (displayUrlMatches) {
        displayUrlMatches.forEach(m => {
          const u = m.match(/"display_url"\s*:\s*"([^"]+)"/);
          if (u) addImage(u[1], { source: 'instagram-embed-hd' });
        });
      }

      const resMatches = html.match(/"display_resources"\s*:\s*(\[[\s\S]*?\])/g);
      if (resMatches) {
        resMatches.forEach(m => {
          try {
            const arrMatch = m.match(/"display_resources"\s*:\s*(\[[\s\S]*?\])/);
            if (arrMatch) {
              const resources = JSON.parse(unescapeInstagramUrl(arrMatch[1]));
              if (Array.isArray(resources) && resources.length > 0) {
                resources.sort((a, b) => (b.config_width || 0) - (a.config_width || 0));
                resources.forEach(r => {
                  addImage(r.src, { width: r.config_width, height: r.config_height, source: 'instagram-embed-hd' });
                });
              }
            }
          } catch {}
        });
      }
    } catch {}
  }

  // Strategy 2: Media Redirect
  async function runMediaRedirectStrategy() {
    if (!isPost || !shortcode) return;
    try {
      const mediaUrl = `https://www.instagram.com/p/${shortcode}/media/?size=l`;
      const res = await fetch(mediaUrl, {
        headers: { 'User-Agent': browserHeaders['User-Agent'], 'Referer': 'https://www.instagram.com/' },
        agent: getAgent(mediaUrl),
        redirect: 'manual',
        timeout: 6000,
      });
      const redirectUrl = res.headers.get('location');
      if (redirectUrl && (redirectUrl.includes('cdninstagram') || redirectUrl.includes('fbcdn') || redirectUrl.includes('scontent'))) {
        addImage(redirectUrl, { alt: 'Instagram Image (Full Size)', source: 'instagram-media-redirect' });
      }
    } catch {}
  }

  // Strategy 3: Main Page Scraping
  async function runMainPageStrategy() {
    try {
      const res = await fetch(normalizedUrl, {
        headers: browserHeaders,
        agent: getAgent(normalizedUrl),
        timeout: 8000,
      });
      if (!res.ok) return;
      const html = await res.text();
      const $ = cheerio.load(html);

      const ogTitle = $('meta[property="og:title"]').attr('content');
      const ogDesc = $('meta[property="og:description"]').attr('content');
      if (ogTitle && pageTitle === 'Instagram') pageTitle = ogTitle;

      $('meta[property="og:image"], meta[property="og:image:secure_url"]').each((_, el) => {
        addImage($(el).attr('content'), { alt: ogDesc || 'Instagram Image', source: 'instagram-og' });
      });

      $('meta[name="twitter:image"]').each((_, el) => {
        addImage($(el).attr('content'), { source: 'instagram-meta' });
      });

      const displayUrlRegex = /"display_url"\s*:\s*"([^"]+)"/g;
      let match;
      while ((match = displayUrlRegex.exec(html)) !== null) {
        addImage(match[1], { source: 'instagram-hd' });
      }

      const cdnRegex = /https?:\/\/(?:scontent[^"'\s\\]*?\.cdninstagram\.com|[^"'\s\\]*?\.fbcdn\.net)\/[^"'\s\\)]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\)]*)?/gi;
      const cdnMatches = html.match(cdnRegex);
      if (cdnMatches) {
        cdnMatches.forEach(cdnUrl => {
          const clean = unescapeInstagramUrl(cdnUrl);
          if (!/\/s(64|128|150|240|320)x/i.test(clean)) {
            addImage(clean, { source: 'instagram-cdn' });
          }
        });
      }
    } catch {}
  }

  // Strategy 4: GraphQL API
  async function runApiStrategy() {
    if (!isPost || !shortcode) return;
    try {
      const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
      const res = await fetch(apiUrl, {
        headers: {
          ...browserHeaders,
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest',
        },
        agent: getAgent(apiUrl),
        timeout: 6000,
      });
      if (!res.ok) return;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;

      const data = await res.json();
      const media = data?.items?.[0] || data?.graphql?.shortcode_media || data?.data?.shortcode_media;
      if (!media) return;

      function parseMediaItem(m) {
        if (m.image_versions2?.candidates) {
          const best = [...m.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
          if (best) addImage(best.url, { width: best.width, height: best.height, source: 'instagram-api' });
        }
        if (m.display_url) addImage(m.display_url, { source: 'instagram-api' });
        if (m.display_resources) {
          const best = [...m.display_resources].sort((a, b) => (b.config_width || 0) - (a.config_width || 0))[0];
          if (best) addImage(best.src, { width: best.config_width, height: best.config_height, source: 'instagram-api' });
        }
      }

      parseMediaItem(media);
      const carousel = media.carousel_media || media.edge_sidecar_to_children?.edges?.map(e => e.node) || [];
      carousel.forEach(parseMediaItem);
    } catch {}
  }

  // Strategy 5: oEmbed
  async function runOembedStrategy() {
    if (!isPost) return;
    const oembedUrls = [
      `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(normalizedUrl)}&maxwidth=1080&access_token=IGQVJ`,
      `https://api.instagram.com/oembed/?url=${encodeURIComponent(normalizedUrl)}&maxwidth=1080`,
    ];
    for (const u of oembedUrls) {
      try {
        const res = await fetch(u, {
          headers: { 'User-Agent': browserHeaders['User-Agent'] },
          agent: getAgent(u),
          timeout: 4000,
        });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) continue;
        const data = await res.json();
        if (data.thumbnail_url) {
          const hiRes = data.thumbnail_url.replace(/\/s\d+x\d+\//g, '/s1080x1080/').replace(/\/e\d+\//g, '/e35/');
          addImage(hiRes, { alt: data.title || 'Instagram Image', width: 1080, height: 1080, source: 'instagram-oembed-hd' });
          addImage(data.thumbnail_url, { alt: data.title || 'Instagram Image', width: data.thumbnail_width || 0, source: 'instagram-oembed' });
          break;
        }
      } catch {}
    }
  }

  // Execute all strategies concurrently in parallel
  await Promise.allSettled([
    runEmbedStrategy(),
    runMediaRedirectStrategy(),
    runMainPageStrategy(),
    runApiStrategy(),
    runOembedStrategy(),
  ]);

  const result = Array.from(images.values());
  const sourcePriority = {
    'instagram-api': 1,
    'instagram-embed-hd': 2,
    'instagram-media-redirect': 3,
    'instagram-hd': 4,
    'instagram-carousel': 5,
    'instagram-embed': 6,
    'instagram-embed-cdn': 7,
    'instagram-cdn': 8,
    'instagram-og': 9,
    'instagram-oembed-hd': 10,
    'instagram-oembed': 11,
    'instagram-meta': 12,
    'instagram-img': 13,
  };

  result.sort((a, b) => {
    const pA = sourcePriority[a.source] || 99;
    const pB = sourcePriority[b.source] || 99;
    if (pA !== pB) return pA - pB;
    return (b.width || 0) - (a.width || 0);
  });

  return { pageTitle, images: result };
}

// =============================================
//  GENERIC IMAGE EXTRACTION (Ultra-Effective)
// =============================================

async function extractGenericImages(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
    },
    agent: getAgent(url),
    timeout: 15000,
  });

  if (!response.ok) {
    throw new Error(`Falha ao acessar página: ${response.statusText} (${response.status})`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const baseUrl = new URL(url);
  const imageMap = new Map();

  function resolveUrl(src) {
    if (!src || typeof src !== 'string') return null;
    src = src.trim();
    if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('javascript:')) return null;
    try {
      return new URL(src, baseUrl).href;
    } catch {
      return null;
    }
  }

  function parseSrcset(srcset) {
    if (!srcset) return [];
    const candidates = srcset.split(',').map(s => s.trim()).filter(Boolean);
    const results = [];
    for (const candidate of candidates) {
      const parts = candidate.split(/\s+/);
      const candidateUrl = resolveUrl(parts[0]);
      if (candidateUrl) {
        let width = 0;
        if (parts[1]) {
          const match = parts[1].match(/(\d+)(w|x)/);
          if (match) {
            width = parseInt(match[1], 10);
            if (match[2] === 'x') width = width * 1000; // prioritize 2x/3x
          }
        }
        results.push({ url: candidateUrl, width });
      }
    }
    return results;
  }

  function addImage(src, meta = {}) {
    const resolved = resolveUrl(src);
    if (!resolved) return;
    // Filter tiny tracking pixels / transparent 1x1 gifs
    if (/spacer\.gif|blank\.gif|1x1|pixel\.gif/i.test(resolved)) return;

    const existing = imageMap.get(resolved);
    const newWidth = meta.width || 0;
    const newHeight = meta.height || 0;

    if (!existing) {
      imageMap.set(resolved, {
        url: resolved,
        alt: meta.alt || '',
        width: newWidth,
        height: newHeight,
        source: meta.source || 'img',
      });
    } else {
      if (newWidth > (existing.width || 0)) existing.width = newWidth;
      if (newHeight > (existing.height || 0)) existing.height = newHeight;
      if (!existing.alt && meta.alt) existing.alt = meta.alt;
    }
  }

  // 1. All <img> tags with modern lazy-loading attributes
  const lazyAttrs = [
    'src', 'data-src', 'data-original', 'data-lazy-src', 'data-lazy',
    'data-zoom-image', 'data-large-image', 'data-full-url', 'data-high-res',
    'data-orig-file', 'data-src-retina', 'data-url', 'data-actualsrc',
    'nitro-lazy-src', 'data-blazy', 'data-bg', 'data-background-image',
    'data-thumb', 'data-hi-res-src', 'data-desktop-src', 'data-mobile-src'
  ];

  $('img').each((_, el) => {
    const $el = $(el);
    const alt = $el.attr('alt') || $el.attr('title') || '';
    const width = parseInt($el.attr('width'), 10) || 0;
    const height = parseInt($el.attr('height'), 10) || 0;
    const meta = { alt, width, height, source: 'img' };

    lazyAttrs.forEach(attr => {
      const val = $el.attr(attr);
      if (val) addImage(val, meta);
    });

    const srcsetCandidates = [
      ...parseSrcset($el.attr('srcset')),
      ...parseSrcset($el.attr('data-srcset')),
      ...parseSrcset($el.attr('data-lazy-srcset')),
    ];
    if (srcsetCandidates.length) {
      srcsetCandidates.sort((a, b) => b.width - a.width);
      addImage(srcsetCandidates[0].url, { ...meta, width: srcsetCandidates[0].width });
    }
  });

  // 2. <picture><source>
  $('picture source, source').each((_, el) => {
    const srcsetCandidates = [
      ...parseSrcset($(el).attr('srcset')),
      ...parseSrcset($(el).attr('data-srcset')),
    ];
    if (srcsetCandidates.length) {
      srcsetCandidates.sort((a, b) => b.width - a.width);
      addImage(srcsetCandidates[0].url, { source: 'picture', width: srcsetCandidates[0].width });
    }
    const src = $(el).attr('src');
    if (src) addImage(src, { source: 'picture' });
  });

  // 3. OpenGraph & Twitter Card
  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[property="og:image:url"]').each((_, el) => {
    addImage($(el).attr('content'), { source: 'og-meta', alt: $('meta[property="og:image:alt"]').attr('content') || '' });
  });
  $('meta[name="twitter:image"], meta[name="twitter:image:src"]').each((_, el) => {
    addImage($(el).attr('content'), { source: 'twitter-meta' });
  });

  // 4. <link rel="preload" as="image"> & <link rel="image_src">
  $('link[rel="preload"][as="image"], link[rel="image_src"]').each((_, el) => {
    addImage($(el).attr('href'), { source: 'link-preload' });
  });

  // 5. JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      function extractFromObject(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.image) {
          if (typeof obj.image === 'string') addImage(obj.image, { source: 'json-ld' });
          else if (Array.isArray(obj.image)) obj.image.forEach(i => typeof i === 'string' ? addImage(i, { source: 'json-ld' }) : addImage(i.url, { source: 'json-ld' }));
          else if (obj.image.url) addImage(obj.image.url, { source: 'json-ld' });
        }
        if (obj.thumbnailUrl) {
          if (typeof obj.thumbnailUrl === 'string') addImage(obj.thumbnailUrl, { source: 'json-ld' });
          else if (Array.isArray(obj.thumbnailUrl)) obj.thumbnailUrl.forEach(i => addImage(i, { source: 'json-ld' }));
        }
        Object.values(obj).forEach(val => {
          if (typeof val === 'object') extractFromObject(val);
        });
      }
      if (Array.isArray(json)) json.forEach(extractFromObject);
      else extractFromObject(json);
    } catch {}
  });

  // 6. Direct image and vector links in <a>
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|svg)(\?.*)?$/i.test(href)) {
      const isSvg = /\.svg(\?.*)?$/i.test(href);
      addImage(href, { source: isSvg ? 'vector-link' : 'link', isVector: isSvg });
    }
  });

  // 7. <object> and <embed> SVG elements
  $('object[data], embed[src]').each((_, el) => {
    const src = $(el).attr('data') || $(el).attr('src');
    if (src && /\.svg(\?.*)?$/i.test(src)) {
      addImage(src, { source: 'vector-object', isVector: true, alt: $(el).attr('title') || 'Vetor SVG' });
    }
  });

  // 8. <link> vector icons
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    const type = $(el).attr('type') || '';
    if (href && (/\.svg(\?.*)?$/i.test(href) || type.includes('svg'))) {
      addImage(href, { source: 'vector-icon', isVector: true, alt: 'Ícone Vetorial SVG' });
    }
  });

  // 9. Inline <svg> tags
  $('svg').each((index, el) => {
    const $svg = $(el);
    // Ignore invisible / tiny 0x0 SVGs
    const w = parseInt($svg.attr('width'), 10) || 0;
    const h = parseInt($svg.attr('height'), 10) || 0;
    const viewBox = $svg.attr('viewBox');
    
    // Only capture meaningful SVGs (has children, paths, or viewBox)
    if ($svg.find('path, polygon, circle, rect, line, text').length > 0 || viewBox) {
      const id = $svg.attr('id') || $svg.attr('class') || `vector_${index + 1}`;
      const title = $svg.find('title').text().trim() || $svg.attr('aria-label') || `Vetor SVG ${index + 1}`;
      
      // Ensure xmlns attribute exists for standalone svg
      if (!$svg.attr('xmlns')) {
        $svg.attr('xmlns', 'http://www.w3.org/2000/svg');
      }
      
      const svgHtml = $.html($svg);
      if (svgHtml.length > 50 && svgHtml.length < 500000) { // skip empty or gigantic dumps
        const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgHtml)}`;
        const key = `inline_svg_${index + 1}`;
        if (!imageMap.has(key)) {
          imageMap.set(key, {
            url: dataUri,
            alt: title,
            width: w || 800,
            height: h || 800,
            source: 'vector-svg',
            isVector: true,
          });
        }
      }
    }
  });

  // 10. Background images in <style> and inline styles
  $('[style]').each((_, el) => {
    const style = $(el).attr('style');
    const matches = style.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
    if (matches) {
      for (const m of matches) {
        const u = m.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
        if (u) {
          const isSvg = /\.svg(\?.*)?$/i.test(u[1]) || u[1].includes('data:image/svg+xml');
          addImage(u[1], { source: isSvg ? 'vector-css' : 'css', isVector: isSvg });
        }
      }
    }
  });

  $('style').each((_, el) => {
    const cssText = $(el).text();
    const matches = cssText.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
    if (matches) {
      for (const m of matches) {
        const u = m.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
        if (u && /\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(u[1])) {
          const isSvg = /\.svg(\?.*)?$/i.test(u[1]);
          addImage(u[1], { source: isSvg ? 'vector-stylesheet' : 'stylesheet', isVector: isSvg });
        }
      }
    }
  });

  const pageTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || 'Página Web';
  return { pageTitle, images: Array.from(imageMap.values()) };
}

// =============================================
//  API ENDPOINTS
// =============================================

/**
 * POST /api/extract
 */
app.post('/api/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' });

  try {
    const isIg = isInstagramUrl(url);
    const result = isIg ? await extractInstagramImages(url) : await extractGenericImages(url);

    res.json({
      pageTitle: result.pageTitle,
      pageUrl: url,
      totalImages: result.images.length,
      images: result.images,
      isInstagram: isIg,
    });
  } catch (err) {
    console.error('Erro na extração:', err.message);
    res.status(500).json({ error: `Falha ao extrair imagens: ${err.message}` });
  }
});

/**
 * GET /api/proxy — Optimized streaming image proxy with caching
 */
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Parâmetro URL obrigatório' });

  // Inline SVG data-URI support
  if (url.startsWith('data:image/svg+xml')) {
    const rawSvg = decodeURIComponent(url.replace(/^data:image\/svg\+xml(?:;[a-zA-Z0-9=_-]+)?,/, ''));
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(rawSvg);
  }

  try {
    const isIg = url.includes('cdninstagram.com') || url.includes('fbcdn.net') || url.includes('instagram.com');
    const referer = isIg ? 'https://www.instagram.com/' : new URL(url).origin;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': referer,
        'Origin': isIg ? 'https://www.instagram.com' : undefined,
      },
      agent: getAgent(url),
      timeout: 25000,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Falha ao buscar imagem' });
    }

    const contentType = response.headers.get('content-type') || (url.includes('.svg') ? 'image/svg+xml' : 'image/jpeg');
    const contentLength = response.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    // Cache for 24 hours in browser
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

    response.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/download — Download single image file
 */
app.get('/api/download', async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).json({ error: 'Parâmetro URL obrigatório' });

  // Inline SVG data-URI support
  if (url.startsWith('data:image/svg+xml')) {
    const rawSvg = decodeURIComponent(url.replace(/^data:image\/svg\+xml(?:;[a-zA-Z0-9=_-]+)?,/, ''));
    let safeName = filename || `vetor_${Date.now()}.svg`;
    if (!safeName.endsWith('.svg')) safeName += '.svg';
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`);
    return res.send(rawSvg);
  }

  try {
    const isIg = url.includes('cdninstagram.com') || url.includes('fbcdn.net') || url.includes('instagram.com');
    const referer = isIg ? 'https://www.instagram.com/' : new URL(url).origin;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': referer,
      },
      agent: getAgent(url),
      timeout: 30000,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Falha ao buscar imagem' });
    }

    const contentType = response.headers.get('content-type') || (url.includes('.svg') ? 'image/svg+xml' : 'image/jpeg');
    let ext = contentType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || (url.includes('.svg') ? 'svg' : 'jpg');
    if (url.includes('.svg')) ext = 'svg';
    
    let safeName = filename || `imagem_${Date.now()}.${ext}`;
    if (!safeName.includes('.')) safeName += `.${ext}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`);

    response.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/download-zip — Download multiple images bundled in a single ZIP file
 */
app.post('/api/download-zip', async (req, res) => {
  const { images } = req.body;
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Lista de imagens vazia ou inválida' });
  }

  try {
    const zip = new JSZip();
    const fetchPromises = images.map(async (img, index) => {
      try {
        if (img.url.startsWith('data:image/svg+xml')) {
          const rawSvg = decodeURIComponent(img.url.replace(/^data:image\/svg\+xml(?:;[a-zA-Z0-9=_-]+)?,/, ''));
          let filename = img.filename || `vetor_${index + 1}.svg`;
          if (!filename.endsWith('.svg')) filename += '.svg';
          zip.file(filename, rawSvg);
          return;
        }

        const isIg = img.url.includes('cdninstagram.com') || img.url.includes('fbcdn.net') || img.url.includes('instagram.com');
        const referer = isIg ? 'https://www.instagram.com/' : new URL(img.url).origin;

        const response = await fetch(img.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Referer': referer,
          },
          agent: getAgent(img.url),
          timeout: 20000,
        });

        if (response.ok) {
          const buffer = await response.buffer();
          const contentType = response.headers.get('content-type') || (img.url.includes('.svg') ? 'image/svg+xml' : 'image/jpeg');
          let ext = contentType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || (img.url.includes('.svg') ? 'svg' : 'jpg');
          if (img.url.includes('.svg')) ext = 'svg';
          if (!/^(jpe?g|png|webp|gif|svg|avif|bmp)$/i.test(ext)) ext = 'jpg';

          let filename = img.filename || `imagem_${index + 1}.${ext}`;
          if (!filename.endsWith(`.${ext}`)) filename += `.${ext}`;

          zip.file(filename, buffer);
        }
      } catch (err) {
        console.error(`Erro ao baixar imagem para ZIP [${index}]:`, err.message);
      }
    });

    await Promise.all(fetchPromises);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const zipName = `imagens_${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('Erro ao gerar ZIP:', err);
    res.status(500).json({ error: 'Erro ao gerar arquivo ZIP' });
  }
});
