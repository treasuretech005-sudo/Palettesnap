/**
 * PaletteSnap – script.js
 * Author: Treasure Tech
 * Description: Frontend-only color palette extractor using HTML Canvas API
 * No backend, no external APIs, fully browser-based.
 */

'use strict';

/* ============================================================
   CONSTANTS & DOM REFERENCES
   ============================================================ */

const MAX_WIDTH     = 800;   // Max image width before resizing for performance
const NUM_COLORS    = 5;     // Number of dominant colors to extract
const SAMPLE_SIZE   = 10;    // Pixel sampling step (every Nth pixel — higher = faster)
const K_ITERATIONS  = 30;    // K-means iterations

const uploadArea      = document.getElementById('uploadArea');
const fileInput       = document.getElementById('fileInput');
const resultsSection  = document.getElementById('resultsSection');
const imagePreview    = document.getElementById('imagePreview');
const colorBlocks     = document.getElementById('colorBlocks');
const hiddenCanvas    = document.getElementById('hiddenCanvas');
const ctx             = hiddenCanvas.getContext('2d');
const copyAllBtn      = document.getElementById('copyAllBtn');
const downloadBtn     = document.getElementById('downloadBtn');
const shareBtn        = document.getElementById('shareBtn');
const uploadAnotherBtn= document.getElementById('uploadAnotherBtn');
const navToggle       = document.getElementById('navToggle');
const siteNav         = document.getElementById('siteNav');
const toast           = document.getElementById('toast');

/** Stores the current extracted palette */
let currentPalette = [];

/* ============================================================
   MOBILE NAV TOGGLE
   ============================================================ */

navToggle.addEventListener('click', () => {
  const isOpen = siteNav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

// Close nav when a link is clicked
siteNav.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    siteNav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

/* ============================================================
   UPLOAD AREA – Click, Keyboard, Drag & Drop
   ============================================================ */

/** Open file dialog when upload area is clicked */
uploadArea.addEventListener('click', () => fileInput.click());

/** Allow keyboard activation (Enter / Space) */
uploadArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

/** File selected via input */
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  // Reset so the same file can be re-uploaded
  fileInput.value = '';
});

/** Drag over */
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

/** Drag leave */
uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

/** Drop */
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    handleFile(file);
  } else {
    showToast('Please drop a valid image file.');
  }
});

/* ============================================================
   FILE HANDLING
   ============================================================ */

/**
 * Main entry point for a new image file.
 * Reads it, renders a preview, and kicks off color extraction.
 * @param {File} file
 */
function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Only image files are supported.');
    return;
  }

  uploadArea.classList.add('loading');

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataURL = e.target.result;
    const img = new Image();
    img.onload = () => {
      // Show image preview
      imagePreview.src = dataURL;
      imagePreview.alt = 'Uploaded image preview: ' + file.name;

      // Extract colors
      const palette = extractPalette(img);
      currentPalette = palette;

      // Render palette UI
      renderPalette(palette);

      // Show results section
      resultsSection.removeAttribute('hidden');
      uploadArea.classList.remove('loading');

      // Smooth scroll to results
      setTimeout(() => {
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    };
    img.onerror = () => {
      uploadArea.classList.remove('loading');
      showToast('Could not load this image. Please try another file.');
    };
    img.src = dataURL;
  };
  reader.onerror = () => {
    uploadArea.classList.remove('loading');
    showToast('Error reading file.');
  };
  reader.readAsDataURL(file);
}

/* ============================================================
   IMAGE PROCESSING – Canvas + K-Means Color Extraction
   ============================================================ */

/**
 * Draws the image onto a hidden canvas (resizing if > MAX_WIDTH),
 * samples pixel data, and runs k-means clustering to extract dominant colors.
 * @param {HTMLImageElement} img
 * @returns {string[]} Array of HEX color strings
 */
function extractPalette(img) {
  // --- Step 1: Resize image if needed for performance ---
  let drawWidth  = img.naturalWidth;
  let drawHeight = img.naturalHeight;

  if (drawWidth > MAX_WIDTH) {
    const ratio  = MAX_WIDTH / drawWidth;
    drawWidth    = MAX_WIDTH;
    drawHeight   = Math.round(drawHeight * ratio);
  }

  hiddenCanvas.width  = drawWidth;
  hiddenCanvas.height = drawHeight;
  ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

  // --- Step 2: Sample pixel data ---
  const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight);
  const data      = imageData.data; // Uint8ClampedArray: [R,G,B,A, R,G,B,A, ...]
  const pixels    = [];

  for (let i = 0; i < data.length; i += 4 * SAMPLE_SIZE) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Skip transparent or near-transparent pixels
    if (a < 128) continue;

    // Skip very near-white (background) and very near-black
    const brightness = (r + g + b) / 3;
    if (brightness > 248 || brightness < 8) continue;

    pixels.push([r, g, b]);
  }

  if (pixels.length === 0) {
    // Fallback: return grayscale swatches
    return ['#888888', '#666666', '#aaaaaa', '#444444', '#cccccc'];
  }

  // --- Step 3: K-Means clustering ---
  const palette = kMeans(pixels, NUM_COLORS, K_ITERATIONS);

  // --- Step 4: Sort by perceived luminance (light to dark) ---
  palette.sort((a, b) => luminance(a) - luminance(b));

  return palette.map(rgbToHex);
}

/**
 * Simplified K-Means clustering on RGB pixel array.
 * @param {number[][]} pixels  Array of [r,g,b]
 * @param {number}     k       Number of clusters
 * @param {number}     iters   Max iterations
 * @returns {number[][]}       Array of [r,g,b] cluster centroids
 */
function kMeans(pixels, k, iters) {
  // --- Initialize centroids by sampling evenly across the pixel array ---
  let centroids = [];
  const step = Math.floor(pixels.length / k);
  for (let i = 0; i < k; i++) {
    centroids.push([...pixels[i * step]]);
  }

  let assignments = new Array(pixels.length).fill(0);

  for (let iter = 0; iter < iters; iter++) {
    // Assign each pixel to the nearest centroid
    let changed = false;
    for (let i = 0; i < pixels.length; i++) {
      const nearest = nearestCentroid(pixels[i], centroids);
      if (nearest !== assignments[i]) {
        assignments[i] = nearest;
        changed = true;
      }
    }

    // Recompute centroids
    const sums   = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Array(k).fill(0);

    for (let i = 0; i < pixels.length; i++) {
      const c = assignments[i];
      sums[c][0] += pixels[i][0];
      sums[c][1] += pixels[i][1];
      sums[c][2] += pixels[i][2];
      counts[c]++;
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = [
          Math.round(sums[c][0] / counts[c]),
          Math.round(sums[c][1] / counts[c]),
          Math.round(sums[c][2] / counts[c]),
        ];
      }
    }

    // Early exit if nothing changed
    if (!changed) break;
  }

  return centroids;
}

/**
 * Returns the index of the nearest centroid to a given pixel.
 * @param {number[]} pixel
 * @param {number[][]} centroids
 * @returns {number}
 */
function nearestCentroid(pixel, centroids) {
  let minDist = Infinity;
  let minIdx  = 0;
  for (let i = 0; i < centroids.length; i++) {
    const dist = colorDistance(pixel, centroids[i]);
    if (dist < minDist) {
      minDist = dist;
      minIdx  = i;
    }
  }
  return minIdx;
}

/**
 * Squared Euclidean distance in RGB space.
 * (Sqrt omitted for performance since we only need relative comparison.)
 */
function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** Perceived luminance of an [r,g,b] array */
function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Convert [r,g,b] to HEX string, e.g. "#A3B2C1" */
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* ============================================================
   PALETTE RENDERING
   ============================================================ */

/**
 * Renders the extracted palette as interactive color blocks.
 * @param {string[]} palette Array of HEX strings
 */
function renderPalette(palette) {
  colorBlocks.innerHTML = '';

  palette.forEach((hex, index) => {
    const block = document.createElement('div');
    block.className = 'color-block';
    block.setAttribute('role', 'listitem');
    block.setAttribute('tabindex', '0');
    block.setAttribute('aria-label', `Color ${index + 1}: ${hex}. Click to copy.`);

    block.innerHTML = `
      <span class="color-swatch" style="background:${hex};"></span>
      <div class="color-info">
        <span class="color-hex">${hex}</span>
        <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </div>
    `;

    // Click to copy
    block.addEventListener('click', () => copyHex(hex, block));

    // Keyboard support
    block.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyHex(hex, block);
      }
    });

    colorBlocks.appendChild(block);
  });
}

/* ============================================================
   CLIPBOARD UTILITIES
   ============================================================ */

/**
 * Copies a single HEX code to clipboard and shows feedback.
 * @param {string} hex   HEX color string
 * @param {HTMLElement} block  The color block element
 */
function copyHex(hex, block) {
  navigator.clipboard.writeText(hex).then(() => {
    // Visual feedback
    block.classList.add('copied');
    showToast(`${hex} copied to clipboard!`);
    setTimeout(() => block.classList.remove('copied'), 1400);
  }).catch(() => {
    // Fallback for older browsers
    fallbackCopy(hex);
    showToast(`${hex} copied!`);
  });
}

/**
 * Fallback clipboard copy using a temporary textarea element.
 * @param {string} text
 */
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

/** Copy All Colors button */
copyAllBtn.addEventListener('click', () => {
  if (currentPalette.length === 0) return;
  const allColors = currentPalette.join(', ');
  navigator.clipboard.writeText(allColors)
    .then(() => showToast('All colors copied: ' + allColors))
    .catch(() => {
      fallbackCopy(allColors);
      showToast('All colors copied!');
    });
});

/* ============================================================
   DOWNLOAD PALETTE AS PNG
   ============================================================ */

downloadBtn.addEventListener('click', () => {
  if (currentPalette.length === 0) return;
  downloadPalettePNG(currentPalette);
});

/**
 * Generates and downloads a PNG image of the color palette.
 * @param {string[]} palette Array of HEX strings
 */
function downloadPalettePNG(palette) {
  const SWATCH_W = 200;
  const SWATCH_H = 260;
  const LABEL_H  = 60;
  const PADDING  = 24;
  const FONT_SIZE = 15;

  const totalW = SWATCH_W * palette.length;
  const totalH = SWATCH_H + LABEL_H + PADDING * 2;

  const dlCanvas = document.createElement('canvas');
  dlCanvas.width  = totalW;
  dlCanvas.height = totalH;

  const dlCtx = dlCanvas.getContext('2d');

  // Background
  dlCtx.fillStyle = '#F3FFE8';
  dlCtx.fillRect(0, 0, totalW, totalH);

  palette.forEach((hex, i) => {
    const x = i * SWATCH_W;

    // Color swatch rectangle
    dlCtx.fillStyle = hex;
    dlCtx.fillRect(x + PADDING / 2, PADDING, SWATCH_W - PADDING, SWATCH_H);

    // Light drop shadow under swatch
    dlCtx.shadowColor   = 'rgba(0,0,0,0.1)';
    dlCtx.shadowBlur    = 10;
    dlCtx.shadowOffsetY = 4;
    dlCtx.fillStyle     = hex;
    dlCtx.fillRect(x + PADDING / 2, PADDING, SWATCH_W - PADDING, SWATCH_H);
    dlCtx.shadowBlur = 0;
    dlCtx.shadowOffsetY = 0;

    // HEX label
    dlCtx.fillStyle  = '#1a2e1a';
    dlCtx.font       = `bold ${FONT_SIZE}px "Courier New", monospace`;
    dlCtx.textAlign  = 'center';
    dlCtx.textBaseline = 'middle';
    dlCtx.fillText(hex, x + SWATCH_W / 2, SWATCH_H + PADDING + LABEL_H / 2 - 4);
  });

  // Footer text
  dlCtx.fillStyle   = '#6b8a6b';
  dlCtx.font        = '13px "Nunito", sans-serif';
  dlCtx.textAlign   = 'center';
  dlCtx.textBaseline = 'bottom';
  dlCtx.fillText('Generated by PaletteSnap — palettesnap.netlify.app', totalW / 2, totalH - 6);

  // Download
  const link = document.createElement('a');
  link.download = 'palettesnap-palette.png';
  link.href     = dlCanvas.toDataURL('image/png');
  link.click();

  showToast('Palette downloaded as PNG!');
}

/* ============================================================
   SHARE PALETTE
   ============================================================ */

shareBtn.addEventListener('click', async () => {
  if (currentPalette.length === 0) return;

  const shareText = `My color palette from PaletteSnap:\n${currentPalette.join(' | ')}\n\nGenerate yours at palettesnap.netlify.app`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'My PaletteSnap Colors', text: shareText });
    } catch (_) {
      // User cancelled or error — do nothing
    }
  } else {
    // Fallback: copy share text
    navigator.clipboard.writeText(shareText)
      .then(() => showToast('Share text copied to clipboard!'))
      .catch(() => {
        fallbackCopy(shareText);
        showToast('Share text copied!');
      });
  }
});

/* ============================================================
   UPLOAD ANOTHER IMAGE
   ============================================================ */

uploadAnotherBtn.addEventListener('click', () => {
  // Reset state
  currentPalette = [];
  colorBlocks.innerHTML = '';
  imagePreview.src = '';
  resultsSection.setAttribute('hidden', '');

  // Scroll back to upload area
  uploadArea.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Trigger file input
  setTimeout(() => fileInput.click(), 400);
});

/* ============================================================
   TOAST NOTIFICATION
   ============================================================ */

let toastTimer = null;

/**
 * Shows a brief toast notification at the bottom of the screen.
 * @param {string} message
 * @param {number} [duration=2400] milliseconds
 */
function showToast(message, duration = 2400) {
  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/* ============================================================
   GLOBAL PASTE SUPPORT (paste image from clipboard)
   ============================================================ */

document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        showToast('Image pasted! Extracting palette...');
        handleFile(file);
      }
      break;
    }
  }
});

/* ============================================================
   MAILTO LINK BUILDER
   Builds mailto links at runtime to prevent Cloudflare
   email obfuscation from injecting scripts that break the page.
   ============================================================ */

document.querySelectorAll('[data-mailto]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const user    = link.dataset.mailto;
    const domain  = link.dataset.domain;
    const subject = link.dataset.subject || '';
    const body    = link.dataset.body    || '';
    const email   = user + '@' + domain;
    let href      = 'mailto:' + email;
    if (subject) href += '?subject=' + subject;
    if (body)    href += (subject ? '&' : '?') + 'body=' + body;
    window.location.href = href;
  });
});
