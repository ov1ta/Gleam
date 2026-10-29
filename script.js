/* =========================================================
   GLEAM COLOR: client-side image color analysis & recommendations
   No AI APIs, no external APIs, no backend. Everything below runs
   in the browser using the Canvas API and plain JavaScript math.
   ========================================================= */

(() => {
  'use strict';

  /* ============================================================
     1. DOM REFERENCES
  ============================================================ */
  const el = (id) => document.getElementById(id);

  const dom = {
    fileInput: el('fileInput'),
    dropzone: el('dropzone'),
    browseBtn: el('browseBtn'),
    uploaderPreview: el('uploaderPreview'),
    previewImg: el('previewImg'),
    replaceBtn: el('replaceBtn'),
    removeBtn: el('removeBtn'),
    statusLine: el('statusLine'),
    statusText: el('statusText'),
    errorLine: el('errorLine'),
    emptySample: el('emptySample'),
    sampleFan: el('sampleFan'),
    workspace: el('workspace'),
    workspaceImg: el('workspaceImg'),
    swatchTrio: el('swatchTrio'),
    startOverBtn: el('startOverBtn'),
    tabs: el('tabs'),
    colorsFoundGrid: el('colorsFoundGrid'),
    bestPickCard: el('bestPickCard'),
    recGroups: el('recGroups'),
    fullPaletteGrid: el('fullPaletteGrid'),
    paletteCheck: el('paletteCheck'),
    copyAllHexBtn: el('copyAllHexBtn'),
    copyCssVarsBtn: el('copyCssVarsBtn'),
    gradientPreview: el('gradientPreview'),
    gradientTypeToggle: el('gradientTypeToggle'),
    copyGradientBtn: el('copyGradientBtn'),
    gradientCode: el('gradientCode'),
    toast: el('toast'),
    hero: el('hero'),
    installBtn: el('installBtn'),
    colorEntry: el('colorEntry'),
    colorForm: el('colorForm'),
    colorInput: el('colorInput'),
    colorChip: el('colorChip'),
    colorError: el('colorError'),
    colorNames: el('colorNames'),
    baseColor: el('baseColor'),
    baseInfo: el('baseInfo'),
  };

  let state = {
    colorsFound: [],       // extracted, ranked colors [{r,g,b,hex,h,s,l,name,pct}]
    dominant: null,
    secondary: null,
    accent: null,
    recommendations: {},   // category -> [candidate]
    fullPalette: null,
    gradientType: 'linear',
  };

  /* ============================================================
     2. COLOR MATH: conversions, distance, naming
  ============================================================ */

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function round(v) { return Math.round(v); }

  function rgbToHex(r, g, b) {
    const h = (n) => clamp(round(n), 0, 255).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
  }

  function hexToRgb(hex) {
    const m = hex.replace('#', '');
    const bigint = parseInt(m, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r1, g1, b1;
    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    return {
      r: round((r1 + m) * 255),
      g: round((g1 + m) * 255),
      b: round((b1 + m) * 255),
    };
  }

  function colorDistanceRgb(a, b) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  function relativeLuminance({ r, g, b }) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrastRatio(rgbA, rgbB) {
    const L1 = relativeLuminance(rgbA) + 0.05;
    const L2 = relativeLuminance(rgbB) + 0.05;
    return L1 > L2 ? L1 / L2 : L2 / L1;
  }

  // Builds a full color object from h/s/l, the shape used everywhere downstream.
  function colorFromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 100);
    l = clamp(l, 0, 100);
    const { r, g, b } = hslToRgb(h, s, l);
    return { h, s, l, r, g, b, hex: rgbToHex(r, g, b), name: nameColorFromRgb(r, g, b) };
  }
  function colorFromRgb(r, g, b) {
    const { h, s, l } = rgbToHsl(r, g, b);
    return { h, s, l, r, g, b, hex: rgbToHex(r, g, b), name: nameColorFromRgb(r, g, b) };
  }

  // ---- Naming: nearest match in a curated table of design-friendly names,
  // measured in CIE Lab (distance as the eye sees it), so a name always agrees
  // with the actual swatch. Runs locally, no lookup service.
  const NAMED_COLORS_RAW = `
White FFFFFF
Off White F6F3EC
Ivory FBF8E8
Cream F1E8D6
Bone E6DDCB
Beige DCCBAA
Pale Gray E4E4E2
Light Gray C9C9C7
Silver B0B0B0
Warm Gray A39B8E
Cool Gray 9AA1A8
Gray 808080
Stone 7A7468
Slate 64707D
Charcoal 36393D
Graphite 2B2D30
Near Black 141414
Black 000000
Red D62828
Crimson DC143C
Cherry 9E1B32
Brick A0392B
Firebrick B22222
Tomato E8503A
Coral F08060
Salmon F4978E
Rose D8718A
Dusty Rose C4888C
Blush F2C9C4
Pink F4A6B8
Hot Pink FF5C99
Raspberry C2185B
Magenta C71585
Burgundy 6B1A2B
Wine 5A1F33
Maroon 800000
Oxblood 4A0D0D
Deep Burgundy 2E0F17
Mahogany 4A1E1A
Rosewood 65322E
Garnet 733635
Orange F28C28
Burnt Orange CC5500
Pumpkin E8741E
Rust B7410E
Terracotta C4694A
Clay B0705A
Copper B87333
Apricot F9C99B
Peach FFD1B0
Amber FFBF00
Caramel C68642
Cinnamon 9C5B34
Sienna A0522D
Chestnut 954535
Coffee 6F4E37
Mocha 5D4037
Walnut 4E3629
Chocolate 3B2417
Espresso 2A1B14
Umber 635147
Taupe 8B7D6B
Tan D2B48C
Camel C19A6B
Khaki C3B091
Sand DCC9A3
Sepia 704214
Yellow FFD60A
Lemon F7EE6B
Butter F6E7A0
Mustard D5A021
Gold D4AF37
Honey E0A64B
Marigold F2A900
Straw E3D26F
Ochre B5832A
Green 2E9E4F
Forest Green 2D6A3E
Hunter Green 355E3B
Emerald 2FB478
Kelly Green 4CBB17
Lime A4D233
Chartreuse 9ACD32
Pistachio A8C686
Pear C9D96F
Sage 9CAF88
Sage Green 7A8B65
Olive Green 6B7A3C
Olive 808000
Moss 8A9A5B
Fern 4F7942
Olive Drab 6B8E23
Pine 1F4D3A
Deep Green 0F3D2E
Army Green 4B5320
Eucalyptus 5F8575
Jade 00A86B
Seafoam 9FE2BF
Mint B5E8D0
Avocado 568203
Lichen 9FA98A
Celadon ACE1AF
Spruce 2F5D50
Olive Black 2B2F20
Teal 0E7C7B
Deep Teal 0B4F5C
Abyss 0A2A30
Turquoise 3CC8C0
Aqua 6FD3D6
Cyan 00B4D8
Lagoon 2E8C99
Dark Slate 2F4F4F
Ocean 1F5F8B
Sky Blue 87CEEB
Baby Blue BFD9EF
Powder Blue B0D4E8
Ice Blue DCEBF5
Cornflower 6495ED
Azure 2F80ED
Blue 1F6FEB
Royal Blue 3A5FCD
Cobalt 0047AB
Sapphire 0F3C8C
Denim 3A5F8F
Steel Blue 4682B4
Dusty Blue 7A93AC
Slate Blue 5A6B8C
Navy 1B2A4A
Midnight 12182B
Prussian 0F2A43
Periwinkle 8F9BE0
Indigo 3B3B98
Purple 7D3C98
Violet 7F4FC9
Grape 5E2A84
Plum 8E4585
Eggplant 4A2740
Aubergine 3A1635
Amethyst 9966CC
Lavender BDB1E3
Lilac C8A2C8
Mauve B08AA6
Orchid DA70D6
Heather 9C8CA8
Wisteria C9A0DC
Thistle D8BFD8
Dusty Purple 7B6A8A
Mint Cream E3F1E8
Rose Mist F7E6E8
Peach Cream F8E5D6
Lavender Mist ECE8F4
Sage Mist E4E9DC
Sky Mist E3EEF6
Electric Blue 1030FF
Ultramarine 3F3FD8
Neon Green 3DFF3D
Burnt Sienna C25A32
Vivid Red E02323
Vivid Orange E07A23
Vivid Yellow E0D423
Vivid Lime 8CE023
Vivid Green 23E04F
Vivid Cyan 23DCE0
Vivid Sky 238CE0
Vivid Blue 2328E0
Electric Violet 6523E7
Vivid Purple 9C23E0
Vivid Magenta E023C8
Vivid Rose E02369
Deep Violet 41306F
Blackcurrant 2E1F4A
Twilight 3A3F73
Dusk 4C4A7A
Dark Indigo 2A2A6B
Deep Navy 0E1A33
Forest Night 14301F
Deep Moss 3D4A25
Bottle Green 0F4C3A
Petrol 1F4E5F
Dark Plum 4A1F3D
Dark Rust 7A3216
Burnt Umber 5A3A1E
Dusty Teal 5F8F8C
Sea Green 4E8A74
Mushroom 9B8E82
Dusty Green 8FA38A
Pewter 8A8F94
Wheat E6D3A3
Rosy Brown B58A84
Royal Purple 5B3FA0
Brown 8B5A3C
Fuchsia E01FA8
`;

  function rgbToLab(r, g, b) {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    const y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
    const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  let namedColorTable = null;
  function ensureNamedTable() {
    if (!namedColorTable) {
      namedColorTable = NAMED_COLORS_RAW.trim().split('\n').map((line) => {
        const t = line.trim();
        const i = t.lastIndexOf(' ');
        const name = t.slice(0, i);
        const rgb = hexToRgb(t.slice(i + 1));
        return { name, key: name.toLowerCase(), rgb, lab: rgbToLab(rgb.r, rgb.g, rgb.b) };
      });
    }
    return namedColorTable;
  }
  function nameColorFromRgb(r, g, b) {
    const table = ensureNamedTable();
    const lab = rgbToLab(r, g, b);
    let best = table[0], bestD = Infinity;
    for (const n of table) {
      const d = (n.lab[0] - lab[0]) ** 2 + (n.lab[1] - lab[1]) ** 2 + (n.lab[2] - lab[2]) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best.name;
  }

  /* ============================================================
     2b. COLOR INPUT: read a HEX, RGB, HSL or color name that someone typed
  ============================================================ */

  // A few common ways of saying a name that the table spells differently.
  const NAME_ALIASES = {
    'navy blue': 'navy', forest: 'forest green', sky: 'sky blue', royal: 'royal blue', hunter: 'hunter green',
  };

  // Words that shift a known color: "light blue", "dark olive", "dusty rose".
  const COLOR_MODIFIERS = {
    light: (c) => ({ ...c, l: c.l + (100 - c.l) * 0.45 }),
    pale: (c) => ({ ...c, l: c.l + (100 - c.l) * 0.6, s: c.s * 0.8 }),
    pastel: (c) => ({ ...c, l: c.l + (88 - c.l) * 0.6, s: c.s * 0.8 }),
    dark: (c) => ({ ...c, l: c.l * 0.6 }),
    deep: (c) => ({ ...c, l: c.l * 0.7 }),
    dusty: (c) => ({ ...c, s: c.s * 0.5 }),
    muted: (c) => ({ ...c, s: c.s * 0.5 }),
    bright: (c) => ({ ...c, s: Math.min(100, c.s + 30), l: clamp(c.l, 42, 58) }),
    vivid: (c) => ({ ...c, s: Math.min(100, c.s + 30), l: clamp(c.l, 42, 58) }),
  };

  function colorFromName(text) {
    const table = ensureNamedTable();
    const find = (k) => table.find((n) => n.key === (NAME_ALIASES[k] || k));
    const exact = find(text);
    if (exact) return exact.rgb;

    // Modifier words in front of a known name.
    const words = text.split(' ');
    const mods = [];
    while (words.length > 1 && COLOR_MODIFIERS[words[0]]) mods.push(words.shift());
    if (mods.length) {
      const base = find(words.join(' '));
      if (base) {
        let hsl = rgbToHsl(base.rgb.r, base.rgb.g, base.rgb.b);
        for (const m of mods) hsl = COLOR_MODIFIERS[m](hsl);
        return hslToRgb(hsl.h, clamp(hsl.s, 0, 100), clamp(hsl.l, 0, 100));
      }
    }

    // A longer word that starts a known name ("oliv" finds Olive).
    if (text.length >= 4) {
      const starts = table.filter((n) => n.key.startsWith(text)).sort((a, b) => a.key.length - b.key.length);
      if (starts.length) return starts[0].rgb;
    }
    return null;
  }

  function expandHex(hex) {
    return hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
  }

  // Returns {r, g, b} for anything we can read, or null.
  function parseColorInput(raw) {
    const text = String(raw || '').trim().toLowerCase()
      .replace(/grey/g, 'gray').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    if (!text) return null;

    let m = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (m) return hexToRgb(expandHex(m[1]));

    m = text.match(/^(?:rgb\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/);
    if (m && [m[1], m[2], m[3]].every((n) => Number(n) <= 255)) return { r: +m[1], g: +m[2], b: +m[3] };

    m = text.match(/^hsl\(?\s*(\d{1,3})\s*°?\s*[, ]\s*(\d{1,3})\s*%?\s*[, ]\s*(\d{1,3})\s*%?\s*\)?$/);
    if (m && +m[2] <= 100 && +m[3] <= 100) return hslToRgb(+m[1], +m[2], +m[3]);

    const named = colorFromName(text);
    if (named) return named;

    // Last, a HEX typed without the # (checked after names, since words like "bed" are valid HEX too).
    m = text.match(/^([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (m) return hexToRgb(expandHex(m[1]));
    return null;
  }

  function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }

  // "Did you mean...": names that share a word with what was typed, or are a typo away.
  function suggestColorNames(raw) {
    const key = String(raw || '').trim().toLowerCase().replace(/grey/g, 'gray');
    if (key.length < 3) return [];
    const words = key.split(/[\s-]+/).filter((w) => w.length > 2);
    return ensureNamedTable()
      .map((n) => {
        let score = 0;
        const nameWords = n.key.split(' ');
        for (const w of words) score += nameWords.includes(w) ? 3 : (n.key.includes(w) ? 1 : 0);
        const d = editDistance(key, n.key);
        if (d <= 2) score += 5 - d;
        return { name: n.name, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.name);
  }

  /* ============================================================
     3. IMAGE LOADING & DOWNSAMPLING
  ============================================================ */

  const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const MAX_ANALYSIS_DIM = 160; // downsample target, keeps pixel analysis fast

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('empty'));
      if (!ACCEPTED_TYPES.includes(file.type)) return reject(new Error('type'));
      if (file.size > 40 * 1024 * 1024) return reject(new Error('size'));

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function downsampleToImageData(img, maxDim = MAX_ANALYSIS_DIM) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, round(img.naturalWidth * scale));
    const h = Math.max(1, round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  /* ============================================================
     4. COLOR EXTRACTION: sampling + k-means clustering
  ============================================================ */

  function collectSamples(imageData) {
    const { data } = imageData;
    const samples = [];
    // Skip near-transparent pixels; sample every pixel of the (already small) downsampled image.
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
    return samples;
  }

  function kMeans(samples, k, iterations = 8) {
    if (samples.length === 0) return [];
    k = Math.min(k, samples.length);

    // Deterministic, spread-out initialization: pick evenly-spaced samples
    // rather than random ones, so results are stable across runs.
    const centroids = [];
    for (let i = 0; i < k; i++) {
      centroids.push([...samples[Math.floor((i / k) * samples.length)]]);
    }

    let assignments = new Array(samples.length).fill(0);

    for (let iter = 0; iter < iterations; iter++) {
      // assign
      for (let i = 0; i < samples.length; i++) {
        let best = 0, bestDist = Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const dr = samples[i][0] - centroids[c][0];
          const dg = samples[i][1] - centroids[c][1];
          const db = samples[i][2] - centroids[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestDist) { bestDist = d; best = c; }
        }
        assignments[i] = best;
      }
      // update
      const sums = centroids.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < samples.length; i++) {
        const c = assignments[i];
        sums[c][0] += samples[i][0];
        sums[c][1] += samples[i][1];
        sums[c][2] += samples[i][2];
        sums[c][3] += 1;
      }
      for (let c = 0; c < centroids.length; c++) {
        if (sums[c][3] > 0) {
          centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
        }
      }
    }

    const counts = new Array(k).fill(0);
    for (const a of assignments) counts[a]++;

    return centroids
      .map((c, i) => ({ r: c[0], g: c[1], b: c[2], count: counts[i] }))
      .filter((c) => c.count > 0);
  }

  function mergeSimilarClusters(clusters, threshold = 20) {
    const merged = [];
    const sorted = [...clusters].sort((a, b) => b.count - a.count);
    for (const c of sorted) {
      const match = merged.find((m) => colorDistanceRgb(m, c) < threshold);
      if (match) {
        const totalCount = match.count + c.count;
        match.r = (match.r * match.count + c.r * c.count) / totalCount;
        match.g = (match.g * match.count + c.g * c.count) / totalCount;
        match.b = (match.b * match.count + c.b * c.count) / totalCount;
        match.count = totalCount;
      } else {
        merged.push({ ...c });
      }
    }
    return merged;
  }

  // Visual-importance score: raw frequency matters, but saturation and
  // "mid-range" lightness are boosted so a huge flat background doesn't
  // automatically win over a smaller but more prominent colored subject.
  function scoreImportance(cluster, totalCount) {
    const freq = cluster.count / totalCount;
    const { s, l } = rgbToHsl(cluster.r, cluster.g, cluster.b);
    const satFactor = 0.35 + 0.65 * (s / 100);
    const midtoneFactor = 1 - Math.abs(l - 50) / 100; // gentle bias away from extremes
    return Math.pow(freq, 0.65) * satFactor * (0.75 + 0.25 * midtoneFactor);
  }

  function extractColorsFound(imageData) {
    const samples = collectSamples(imageData);
    if (samples.length === 0) return [];

    let clusters = kMeans(samples, 8, 8);
    clusters = mergeSimilarClusters(clusters, 22);

    const total = clusters.reduce((s, c) => s + c.count, 0);
    clusters.forEach((c) => { c.score = scoreImportance(c, total); c.pct = (c.count / total) * 100; });
    clusters.sort((a, b) => b.score - a.score);

    return clusters.slice(0, 8).map((c) => ({
      ...colorFromRgb(c.r, c.g, c.b),
      pct: c.pct,
    }));
  }

  function pickDominantSecondaryAccent(colorsFound) {
    if (colorsFound.length === 0) return { dominant: null, secondary: null, accent: null };
    const dominant = colorsFound[0];

    // Secondary: next color with a meaningfully different hue or lightness.
    const secondary = colorsFound.slice(1).find((c) =>
      Math.min(Math.abs(c.h - dominant.h), 360 - Math.abs(c.h - dominant.h)) > 25 ||
      Math.abs(c.l - dominant.l) > 30
    ) || colorsFound[1] || dominant;

    // Accent: most saturated remaining color, distinct from both above.
    const rest = colorsFound.filter((c) => c !== dominant && c !== secondary);
    const accent = [...rest].sort((a, b) => b.s - a.s)[0] || secondary;

    return { dominant, secondary, accent };
  }

  /* ============================================================
     5. COLOR THEORY ENGINE
  ============================================================ */

  const theory = {
    complementary: (h) => [h + 180],
    analogous: (h) => [h + 30, h - 30],
    triadic: (h) => [h + 120, h + 240],
    splitComplementary: (h) => [h + 150, h + 210],
    monochromatic: (h) => [h],
  };

  function tint(c, amt) { return colorFromHsl(c.h, c.s * (1 - amt * 0.3), c.l + (100 - c.l) * amt); }
  function shade(c, amt) { return colorFromHsl(c.h, c.s * (1 - amt * 0.15), c.l * (1 - amt)); }
  function tone(c, amt) { return colorFromHsl(c.h, c.s * (1 - amt), c.l); }

  function hueDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }
  function fmtRatio(r) { return `${r.toFixed(1)}:1`; }
  function wcagNote(r) {
    if (r >= 7) return 'passes AAA';
    if (r >= 4.5) return 'passes AA';
    if (r >= 3) return 'large text only';
    return 'too low for text';
  }
  // Warm hues (red through yellow) score near 1, cool hues near -1.
  function warmth(h) { return Math.cos(((h - 40) * Math.PI) / 180); }

  /* ============================================================
     6. SMART RECOMMENDATION ENGINE
     Rule-based and predictable. Every pick is scored from explicit
     checks (contrast, saturation, lightness, hue relationship, whether
     it echoes the image), never from randomness.
  ============================================================ */

  // The "context" is a quick read of the image that every rule below shares.
  // The anchor is the chromatic color the palette is built around. It is
  // usually the dominant color, but a near-black or grey dominant color
  // (a dark photo, a white backdrop) would make muddy suggestions, so the
  // anchor prefers the strongest color that actually has some chroma.
  function buildContext(colorsFound, dominant, secondary, fromColor = false) {
    const totalPct = colorsFound.reduce((s, c) => s + c.pct, 0) || 1;
    const avgL = colorsFound.reduce((s, c) => s + c.l * c.pct, 0) / totalPct;
    const chromatic = colorsFound.filter((c) => c.s >= 15 && c.l > 10 && c.l < 92);
    const neutral = chromatic.length === 0;

    let anchor = dominant;
    if (!neutral) {
      const weight = (c) => Math.sqrt(c.pct) * (c.s / 100 + 0.3);
      anchor = chromatic.reduce((best, c) => (weight(c) > weight(best) ? c : best));
    }

    // Accent saturation follows the image: muted photos get a measured accent, not a neon one.
    const chromaticPct = chromatic.reduce((sum, c) => sum + c.pct, 0) || 1;
    const avgChromaS = chromatic.reduce((sum, c) => sum + c.s * c.pct, 0) / chromaticPct;

    return {
      colorsFound, dominant, secondary, anchor, neutral, avgL, fromColor,
      accentS: neutral ? 58 : clamp(avgChromaS * 1.1 + 8, 48, 74),
      hue: neutral ? 28 : anchor.h,                       // a warm hue to build on when the image is neutral
      useS: neutral ? 45 : clamp(anchor.s, 38, 78),       // "usable" saturation for design colors
      useL: neutral ? 48 : clamp(anchor.l, 38, 60),       // "usable" lightness for design colors
      label: neutral
        ? (fromColor ? 'your color' : 'the neutrals in your image')
        : (fromColor ? `your ${anchor.name.toLowerCase()}` : `the ${anchor.name.toLowerCase()}`),
    };
  }

  // Which image color (if any) a candidate echoes, by hue.
  function imageEcho(c, ctx) {
    let best = null, bestD = Infinity;
    for (const ic of ctx.colorsFound) {
      if (ic.s < 20) continue;
      const d = hueDiff(ic.h, c.h);
      if (d < 22 && d < bestD) { bestD = d; best = ic; }
    }
    return best;
  }

  // Dark yellow-greens read as dirty. Penalize them.
  function mudPenalty(c) {
    return c.h >= 35 && c.h <= 85 && c.l < 45 && c.s > 25 ? 0.14 : 0;
  }

  // Nudges lightness away from the background until the color reaches a
  // minimum contrast ratio (3:1 is the WCAG minimum for UI elements and large text).
  function ensureContrast(c, bg, minRatio) {
    const dir = relativeLuminance(bg) > 0.4 ? -1 : 1;
    let cur = c;
    for (let i = 0; i < 20 && contrastRatio(cur, bg) < minRatio; i++) {
      cur = colorFromHsl(cur.h, cur.s, cur.l + dir * 3);
    }
    return cur;
  }

  function uniqueByHex(list) {
    const seen = new Set();
    return list.filter((c) => (seen.has(c.hex) ? false : (seen.add(c.hex), true)));
  }

  // Keeps only candidates that are visually distinct from ones already
  // chosen, so a short list never shows near-identical colors.
  function pickDiverse(scoredList, count, minDist = 18, minHue = 0) {
    const chosen = [];
    for (const item of scoredList) {
      if (chosen.length >= count) break;
      const apart = chosen.every((c) => colorDistanceRgb(c.color, item.color) >= minDist);
      const hueApart = !minHue || chosen.every((c) => hueDiff(c.color.h, item.color.h) >= minHue);
      if (apart && hueApart) chosen.push(item);
    }
    // Backfill only with colors that are still clearly different, so a list can be shorter than asked for.
    for (const item of scoredList) {
      if (chosen.length >= count) break;
      if (!chosen.includes(item) && chosen.every((c) => colorDistanceRgb(c.color, item.color) >= 10)) chosen.push(item);
    }
    return chosen;
  }

  // Raw 0-1 rule score becomes the "% suitable" number shown to people.
  function toPct(raw) { return clamp(round(100 * Math.pow(raw, 1.3)), 50, 97); }

  function rank(candidates, scoreFn, whyFn, count, minDist, filterFn, minHue) {
    let pool = uniqueByHex(candidates);
    if (filterFn) {
      const filtered = pool.filter(filterFn);
      if (filtered.length) pool = filtered;
    }
    const scored = pool.map((c) => ({ color: c, raw: scoreFn(c) })).sort((a, b) => b.raw - a.raw);
    return pickDiverse(scored, count, minDist, minHue).map((it) => ({
      color: it.color, score: toPct(it.raw), why: whyFn(it.color),
    }));
  }

  // ---------- Background ----------
  // Light or dark, low saturation, and clearly separated from the subject.
  function backgroundCandidates(ctx) {
    const secH = ctx.secondary.s > 12 ? ctx.secondary.h : ctx.hue;
    const out = [];
    for (const h of [ctx.hue, secH, ctx.hue + 180]) {
      out.push(colorFromHsl(h, 12, 95), colorFromHsl(h, 22, 89), colorFromHsl(h, 26, 12), colorFromHsl(h, 14, 8));
    }
    const byL = [...ctx.colorsFound].sort((a, b) => b.l - a.l);
    const lightest = byL[0], darkest = byL[byL.length - 1];
    if (lightest.l > 72) out.push(colorFromHsl(lightest.h, Math.min(lightest.s, 22), clamp(lightest.l, 88, 96)));
    if (darkest.l < 35) out.push(colorFromHsl(darkest.h, Math.min(darkest.s, 30), clamp(darkest.l, 7, 14)));
    return out;
  }
  function scoreBackground(c, ctx) {
    const separation = clamp((contrastRatio(c, ctx.anchor) - 1.5) / 2.5, 0, 1);    // must not blend into the subject
    const extreme = Math.max(clamp((c.l - 70) / 18, 0, 1), clamp((28 - c.l) / 16, 0, 1)); // backgrounds recede at the ends of the scale
    const quiet = 1 - clamp((c.s - 25) / 35, 0, 1);                                // low saturation
    const harmony = c.s < 8 ? 0.85 : 1 - clamp(hueDiff(c.h, ctx.hue) / 180, 0, 1) * 0.6;
    const lightDefault = c.l > 50 ? 0.08 : 0; // light is the default backdrop unless it can't separate from the subject
    return clamp(0.35 * separation + 0.25 * extreme + 0.2 * quiet + 0.2 * harmony + lightDefault, 0, 1);
  }
  function explainBackground(c, ctx) {
    const cr = contrastRatio(c, ctx.anchor);
    return `A quiet ${c.l > 50 ? 'light' : 'dark'} backdrop. ${fmtRatio(cr)} against ${ctx.label}, so ${ctx.fromColor ? 'your color' : 'the image'} stays the focus.`;
  }

  // ---------- Text ----------
  // Scored on real contrast against the chosen background. Strong but not
  // harsh: contrast peaks around 7:1 to 14:1, since pure black on white tires the eye.
  function textCandidates(ctx) {
    const secH = ctx.secondary.s > 12 ? ctx.secondary.h : ctx.hue + 30;
    const out = [];
    for (const h of [ctx.hue, secH, ctx.hue + 180]) {
      out.push(
        colorFromHsl(h, 22, 11), colorFromHsl(h, 32, 17), colorFromHsl(h, 14, 8),
        colorFromHsl(h, 14, 96), colorFromHsl(h, 28, 90)
      );
    }
    return out;
  }
  function scoreText(c, bg, ctx) {
    const cr = contrastRatio(c, bg);
    let contrastScore;
    if (cr < 4.5) contrastScore = clamp((cr - 3) / 1.5, 0, 1) * 0.5;
    else if (cr < 7) contrastScore = 0.5 + ((cr - 4.5) / 2.5) * 0.3;
    else if (cr <= 14) contrastScore = 0.8 + clamp((cr - 7) / 4, 0, 1) * 0.2;
    else contrastScore = 1 - clamp((cr - 14) / 7, 0, 1) * 0.15;
    const harmony = c.s < 8 ? 0.85 : 1 - clamp(hueDiff(c.h, ctx.hue) / 180, 0, 1) * 0.5;
    const calm = 1 - clamp((c.s - 35) / 40, 0, 1);
    return 0.6 * contrastScore + 0.2 * harmony + 0.2 * calm;
  }
  function explainText(c, bg, ctx) {
    const cr = contrastRatio(c, bg);
    return `${fmtRatio(cr)} on your background pick (${wcagNote(cr)}). ${c.s >= 8 ? `Tinted toward ${ctx.fromColor ? 'your color' : 'the image'} so it feels related, not stark.` : 'A neutral that stays out of the way.'}`;
  }

  // ---------- Accent ----------
  // Hues come from color-wheel relationships to the anchor AND from the
  // image's own colors. Each is tuned to stay visible on the background.
  function accentCandidates(ctx, bg) {
    const hues = [180, 150, 210, 120, 240, 60, -60, 30, -30].map((off) => ctx.hue + off);
    for (const ic of ctx.colorsFound) if (ic.s >= 25 && ic.l > 12 && ic.l < 90) hues.push(ic.h);
    const sT = ctx.accentS;
    const out = [];
    for (const h of hues) {
      const hh = ((h % 360) + 360) % 360;
      const sunny = hh >= 35 && hh <= 100; // yellows and oranges are bright by nature
      for (const [sat, l] of [[sT, 52], [sT - 12, 58], [sT + 8, 47]]) {
        let c = ensureContrast(colorFromHsl(h, sat, l), bg, sunny ? 2 : 3);
        if (sunny && c.l < 44) c = colorFromHsl(c.h, c.s, 44); // never darken a sunny hue into mud
        out.push(c);
      }
    }
    return out;
  }
  function scoreAccent(c, bg, ctx) {
    const visible = clamp((contrastRatio(c, bg) - 1.6) / 3.4, 0, 1);
    const d = ctx.neutral ? 150 : hueDiff(c.h, ctx.anchor.h);
    // Too close to the subject's hue reads as a variant of it, not an accent.
    const relation = d < 20 ? 0.3 : d < 50 ? 0.7 : d < 100 ? 0.78 : d < 140 ? 0.92 : 1;
    const chroma = c.s >= 55 ? 1 : c.s / 55;
    const echo = imageEcho(c, ctx) ? 1 : 0.5; // a color already in the photo feels cohesive
    const midtone = c.l >= 38 && c.l <= 66 ? 1 : 0.7;
    return clamp(0.25 * visible + 0.2 * relation + 0.15 * chroma + 0.25 * echo + 0.1 * midtone - mudPenalty(c), 0, 1);
  }
  function explainAccent(c, bg, ctx) {
    const echo = imageEcho(c, ctx);
    const d = hueDiff(c.h, ctx.anchor.h);
    let rel;
    if (ctx.neutral) rel = `Adds a clear point of color to a neutral ${ctx.fromColor ? 'base' : 'image'}.`;
    else if (d >= 150) rel = `Opposite ${ctx.label} on the wheel, so it pops.`;
    else if (d >= 100) rel = `Balances ${ctx.label} without clashing.`;
    else if (d >= 50) rel = `A clear step away from ${ctx.label}, so it won't blend in.`;
    else rel = `A close neighbour of ${ctx.label}, so a gentler accent.`;
    const cr = contrastRatio(c, bg);
    let tail;
    if (echo && echo !== ctx.anchor) tail = `Echoes the ${echo.name.toLowerCase()} already in your image.`;
    else if (cr >= 3) tail = `${fmtRatio(cr)} on the background keeps it visible.`;
    else tail = 'Best used as a fill with dark text on top.';
    return `${rel} ${tail}`;
  }

  // ---------- Color theory groups ----------
  // Each group applies its wheel relationship to the anchor, then retunes
  // the result to a usable weight, since a raw mathematical complement of a
  // dark or washed-out color is usually unusable as-is.
  const THEORY_VARIANTS = [[1, 0], [0.75, 10], [1.08, -9], [0.6, 0]];
  function theoryCandidates(hues, ctx) {
    const out = [];
    for (const h of hues) for (const [sMul, dl] of THEORY_VARIANTS) {
      out.push(colorFromHsl(h, ctx.useS * sMul, ctx.useL + dl));
    }
    return out;
  }
  // Takes the best-tuned color for each wheel position, then keeps the top few
  // that sit well apart, so options never bunch up on one side of the wheel.
  function rankPerHue(hues, ctx, scoreFn, whyFn, count, minHue) {
    const picks = [];
    for (const h of hues) {
      const top = rank(theoryCandidates([h], ctx), scoreFn, whyFn, 1, 0);
      if (top[0]) picks.push(top[0]);
    }
    picks.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const p of picks) if (chosen.every((c) => hueDiff(c.color.h, p.color.h) >= minHue)) chosen.push(p);
    for (const p of picks) if (chosen.length < count && !chosen.includes(p)) chosen.push(p);
    return chosen.slice(0, count);
  }
  function usability(c, bg) {
    const chroma = c.s >= 35 ? (c.s <= 85 ? 1 : clamp(1 - (c.s - 85) / 40, 0.6, 1)) : c.s / 35;
    const mid = c.l >= 32 && c.l <= 68 ? 1 : 1 - clamp(Math.min(Math.abs(c.l - 32), Math.abs(c.l - 68)) / 25, 0, 0.6);
    const visible = clamp((contrastRatio(c, bg) - 1.5) / 3, 0, 1);
    return clamp(0.35 * chroma + 0.25 * mid + 0.4 * visible - mudPenalty(c), 0, 1);
  }
  function scoreTheory(c, bg, ctx, relationWeight) {
    const distinct = clamp(colorDistanceRgb(c, ctx.anchor) / 70, 0, 1);
    const echo = imageEcho(c, ctx) ? 1 : 0.65;
    return clamp(0.5 * usability(c, bg) + 0.2 * distinct + 0.15 * echo + 0.15 * relationWeight, 0, 1);
  }
  function explainTheory(kind, c, ctx) {
    const echo = imageEcho(c, ctx);
    const echoNote = echo && echo !== ctx.anchor ? ` Echoes the ${echo.name.toLowerCase()} in your image.` : '';
    if (ctx.neutral) {
      const n = ctx.fromColor ? 'your neutral color' : 'the neutrals in your image';
      const neutralText = {
        complementary: `A cool counterpoint that makes ${n} feel richer.`,
        harmonious: `A warm, earthy tone that sits comfortably with ${n}.`,
        contrast: `A distinct hue that adds variety without overpowering ${n}.`,
        subtle: 'A soft, muted tone with a hint of warmth, for panels, borders, and quiet UI.',
      };
      return neutralText[kind];
    }
    if (kind === 'complementary') return `Opposite ${ctx.label} on the wheel, retuned to a usable weight.${echoNote}`;
    if (kind === 'harmonious') {
      const dw = warmth(c.h) - warmth(ctx.hue);
      const dir = dw > 0.08 ? 'warmer' : dw < -0.08 ? 'cooler' : 'neighbouring';
      return `Next door to ${ctx.label} on the wheel (${dir}), so it blends in.${echoNote}`;
    }
    if (kind === 'contrast') return `A split or triadic partner to ${ctx.label}. More variety than a straight opposite, still balanced.${echoNote}`;
    return `A ${c.l > 55 ? 'light' : 'deep'}, low-saturation relative of ${ctx.label} for panels, borders, and quiet UI.`;
  }

  // Subtle: monochromatic tints and shades of the anchor's hue at low saturation.
  function subtleCandidates(ctx) {
    const s = Math.min(ctx.useS * 0.45, 30);
    return [30, 42, 56, 68, 80, 88].map((l) => colorFromHsl(ctx.hue, s, l));
  }
  function scoreSubtle(c, bg, ctx) {
    const quiet = c.s <= 30 ? 1 : clamp(1 - (c.s - 30) / 30, 0, 1);
    const cr = contrastRatio(c, bg);
    const fitsSurface = cr < 1.3 ? 0 : cr <= 6 ? 1 : clamp(1 - (cr - 6) / 10, 0, 1);
    const distinct = clamp(colorDistanceRgb(c, ctx.anchor) / 60, 0, 1);
    return 0.4 * quiet + 0.35 * fitsSurface + 0.25 * distinct;
  }

  function generateRecommendations(ctx) {
    const recs = {};

    // The three practical roles come first, background first since the other two are judged against it.
    const bgPool = backgroundCandidates(ctx);
    const bgScore = (c) => scoreBackground(c, ctx);
    const bgWhy = (c) => explainBackground(c, ctx);
    recs.background = rank(bgPool, bgScore, bgWhy, 3, 12, (c) => contrastRatio(c, ctx.anchor) >= 2);
    // Offer both a light and a dark option when both can work, since that is a real design decision.
    const isLight = (c) => c.l > 50;
    if (recs.background.every((b) => isLight(b.color) === isLight(recs.background[0].color))) {
      // Filter first and only add one if something genuinely qualifies (rank() alone would fall back to weak options).
      const oppositePool = bgPool.filter(
        (c) => isLight(c) !== isLight(recs.background[0].color) && contrastRatio(c, ctx.anchor) >= 2
      );
      if (oppositePool.length) {
        const opposite = rank(oppositePool, bgScore, bgWhy, 1, 0);
        recs.background = [...recs.background.slice(0, 2), opposite[0]];
      }
    }
    const bg = recs.background[0].color;

    recs.accent = rank(
      accentCandidates(ctx, bg), (c) => scoreAccent(c, bg, ctx), (c) => explainAccent(c, bg, ctx), 3, 28,
      (c) => contrastRatio(c, bg) >= 2, 35
    );
    recs.text = rank(
      textCandidates(ctx), (c) => scoreText(c, bg, ctx), (c) => explainText(c, bg, ctx), 3, 14,
      (c) => contrastRatio(c, bg) >= 4.5
    );

    // The four color-theory groups: top two each, ranked by usability.
    recs.complementary = rank(
      theoryCandidates(theory.complementary(ctx.hue), ctx), (c) => scoreTheory(c, bg, ctx, 1),
      (c) => explainTheory('complementary', c, ctx), 2, 26
    );
    recs.harmonious = rankPerHue(
      theory.analogous(ctx.hue), ctx, (c) => scoreTheory(c, bg, ctx, 0.9), (c) => explainTheory('harmonious', c, ctx), 2, 25
    );
    recs.contrast = rankPerHue(
      [...theory.splitComplementary(ctx.hue), ...theory.triadic(ctx.hue)], ctx,
      (c) => scoreTheory(c, bg, ctx, 0.95), (c) => explainTheory('contrast', c, ctx), 2, 45
    );
    const subtleScore = (c) => scoreSubtle(c, bg, ctx);
    const subtleWhy = (c) => explainTheory('subtle', c, ctx);
    const subtleAll = subtleCandidates(ctx);
    recs.subtle = [
      ...rank(subtleAll.filter((c) => c.l <= 46), subtleScore, subtleWhy, 1, 0),
      ...rank(subtleAll.filter((c) => c.l >= 54), subtleScore, subtleWhy, 1, 0),
    ].sort((a, b) => b.score - a.score);

    return recs;
  }

  // The featured Best Pick is the best accent, since that is the choice
  // beginners find hardest. Background and text are the fallback.
  function pickOverallBest(recs) {
    const options = [
      { key: 'accent', label: 'Accent', item: recs.accent[0] },
      { key: 'background', label: 'Background', item: recs.background[0] },
      { key: 'text', label: 'Text', item: recs.text[0] },
    ];
    return options.find((o) => o.item) || null;
  }

  function assembleFullPalette(ctx, recs) {
    const background = recs.background[0].color;
    const text = recs.text[0].color;
    const accent = recs.accent[0].color;

    // Primary is the anchor, kept inside a usable lightness range and visible on the background.
    let primary = ctx.neutral ? ctx.dominant : ctx.anchor;
    if (!ctx.fromColor) { // a typed color is kept exactly as typed
      if (primary.l < 14 || primary.l > 90) {
        primary = colorFromHsl(primary.h, clamp(primary.s, 30, 75), clamp(primary.l, 32, 62));
      }
      primary = ensureContrast(primary, background, 3);
    }

    // Secondary is a distinct chromatic color from the image when there is one.
    const secondary = ctx.colorsFound.find(
      (c) => c.s >= 12 && c.l > 18 && c.l < 88 && colorDistanceRgb(c, primary) > 40 && colorDistanceRgb(c, accent) > 30
    ) || recs.harmonious[0].color;

    // Highlight is a soft tint of the accent, for emphasis behind text (selected rows, badges, marker
    // effects). It stays in the accent's hue so the palette stays restrained, and is kept readable
    // against the text color.
    const bgIsLight = relativeLuminance(background) > 0.4;
    let highlight = colorFromHsl(accent.h, clamp(accent.s * 0.8, 40, 80), bgIsLight ? 84 : 26);
    highlight = ensureContrast(highlight, text, 4.5);

    return { background, primary, secondary, accent, text, highlight };
  }

  /* ============================================================
     7. RENDERING
  ============================================================ */

  function textOn(bgColor) {
    // choose black or white ink for legibility on a swatch
    return contrastRatio(bgColor, { r: 255, g: 255, b: 255 }) > contrastRatio(bgColor, { r: 20, g: 20, b: 20 })
      ? '#FFFFFF' : '#1A1A1A';
  }

  function copyIcon() {
    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="1.5"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;
  }

  function renderColorsFound(colors) {
    dom.colorsFoundGrid.innerHTML = colors.map((c) => `
      <div class="swatch-card">
        <div class="swatch-card__color" style="background:${c.hex}">
          <span class="swatch-card__pct">${round(c.pct)}%</span>
        </div>
        <div class="swatch-card__body">
          <div class="swatch-card__name">${c.name}</div>
          <button class="swatch-card__hex" data-copy="${c.hex}">${copyIcon()} ${c.hex}</button>
          <div class="swatch-card__values">RGB ${round(c.r)}, ${round(c.g)}, ${round(c.b)}<br/>HSL ${round(c.h)}°, ${round(c.s)}%, ${round(c.l)}%</div>
        </div>
      </div>`).join('');
  }

  function renderSwatchTrio(dominant, secondary, accent) {
    const items = [['Dominant', dominant], ['Secondary', secondary], ['Accent', accent]];
    dom.swatchTrio.innerHTML = items.map(([label, c]) => `
      <div class="swatch-trio__item">
        <div class="swatch-trio__chip" style="background:${c.hex}"></div>
        <div class="swatch-trio__label">${label}</div>
        <div class="swatch-trio__hex">${c.hex}</div>
      </div>`).join('');
  }

  const CATEGORY_META = {
    complementary: { title: 'Complementary', desc: 'Opposite your dominant color on the wheel. Built-in contrast.' },
    harmonious: { title: 'Harmonious', desc: 'Close relatives of your dominant color that blend in easily.' },
    contrast: { title: 'Contrast', desc: 'A color that creates stronger visual separation where you need it.' },
    subtle: { title: 'Subtle', desc: 'A low-saturation option suited to minimalist designs.' },
    accent: { title: 'Accent', desc: 'Stronger colors meant to be used sparingly, for emphasis.' },
    background: { title: 'Background', desc: 'Lets your image stay the visual focus instead of competing with it.' },
    text: { title: 'Text', desc: 'Chosen for readability against your background pick.' },
  };
  const MAJOR_USE_KEYS = ['background', 'accent', 'text'];

  function recCardHtml(item, isBest) {
    return `
      <div class="rec-card${isBest ? ' rec-card--best' : ''}">
        ${isBest ? '<span class="rec-card__tag">Best pick</span>' : ''}
        <div class="rec-card__swatch" style="background:${item.color.hex}"></div>
        <div class="rec-card__main">
          <div class="rec-card__top">
            <span class="rec-card__name">${item.color.name}</span>
            <span class="rec-card__score">${item.score}% suitable</span>
          </div>
          <button class="rec-card__hex" data-copy="${item.color.hex}">${copyIcon()} ${item.color.hex}</button>
          <p class="rec-card__why">${item.why}</p>
        </div>
      </div>`;
  }

  function renderBestPick(overall) {
    if (!overall) { dom.bestPickCard.innerHTML = ''; return; }
    const { item, label } = overall;
    dom.bestPickCard.innerHTML = `
      <div class="best-pick__swatch" style="background:${item.color.hex}"></div>
      <div class="best-pick__main">
        <p class="best-pick__badge">Best pick</p>
        <h3 class="best-pick__name">${item.color.name}</h3>
        <button class="best-pick__hex" data-copy="${item.color.hex}">${copyIcon()} ${item.color.hex}</button>
        <p class="best-pick__for">Best for: ${label}</p>
        <p class="best-pick__why">${item.why}</p>
      </div>`;
  }

  function renderRecommendations(recs) {
    dom.recGroups.innerHTML = Object.entries(recs).map(([key, list]) => {
      const meta = CATEGORY_META[key];
      const isMajorUse = MAJOR_USE_KEYS.includes(key);
      const cards = list.map((item, i) => recCardHtml(item, isMajorUse && i === 0)).join('');
      return `
        <div class="rec-group">
          <h3 class="rec-group__title">${meta.title}</h3>
          <p class="rec-group__desc">${meta.desc}</p>
          <div class="rec-row">${cards}</div>
        </div>`;
    }).join('');
  }

  const PALETTE_ROLES = [
    ['background', 'Background'], ['primary', 'Primary'], ['secondary', 'Secondary'],
    ['accent', 'Accent'], ['text', 'Text'], ['highlight', 'Highlight'],
  ];

  function renderFullPalette(palette) {
    dom.fullPaletteGrid.innerHTML = PALETTE_ROLES.map(([key, label]) => {
      const c = palette[key];
      return `
        <div class="palette-slot">
          <div class="palette-slot__swatch" style="background:${c.hex}"></div>
          <div class="palette-slot__body">
            <div class="palette-slot__role">${label}</div>
            <button class="palette-slot__hex" data-copy="${c.hex}">${copyIcon()} ${c.hex}</button>
          </div>
        </div>`;
    }).join('');

    // Practical check, since a palette is only useful if the text is readable.
    const textCr = contrastRatio(palette.text, palette.background);
    const accentCr = contrastRatio(palette.accent, palette.background);
    dom.paletteCheck.textContent =
      `Text on background: ${fmtRatio(textCr)} (${wcagNote(textCr)}). Accent on background: ${fmtRatio(accentCr)} (${wcagNote(accentCr)}).`;
  }

  function gradientCss(type, colorA, colorB) {
    return type === 'radial'
      ? `radial-gradient(circle, ${colorA.hex}, ${colorB.hex})`
      : `linear-gradient(135deg, ${colorA.hex}, ${colorB.hex})`;
  }

  function renderGradient() {
    if (!state.fullPalette) return;
    const a = state.fullPalette.primary, b = state.fullPalette.accent;
    const css = gradientCss(state.gradientType, a, b);
    dom.gradientPreview.style.background = css;
    dom.gradientCode.textContent = `background: ${css};`;
  }

  /* ---- empty-state sample fan (static demo, not derived from an image) ---- */
  function renderSampleFan() {
    const demo = ['#6B7950', '#C96832', '#E8E1D7', '#3E4E63', '#B08968'];
    dom.sampleFan.innerHTML = demo.map((hex, i) => {
      const rot = (i - (demo.length - 1) / 2) * 9;
      return `<div class="fan-chip" style="background:${hex}; transform: rotate(${rot}deg) translateY(${Math.abs(i - 2) * 6}px)"></div>`;
    }).join('');
  }

  /* ============================================================
     8. UI STATE / FLOW
  ============================================================ */

  function showError(msg) {
    dom.errorLine.textContent = msg;
    dom.errorLine.hidden = false;
  }
  function clearError() { dom.errorLine.hidden = true; dom.errorLine.textContent = ''; }

  function setStatus(msg) {
    dom.statusText.textContent = msg;
    dom.statusLine.hidden = false;
  }
  function hideStatus() { dom.statusLine.hidden = true; }

  // wide = a longer, wrapping message (used for install instructions).
  function showToast(msg, ms = 1400, wide = false) {
    dom.toast.textContent = msg;
    dom.toast.classList.toggle('toast--wide', wide);
    dom.toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => dom.toast.classList.remove('is-visible'), ms);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // fallback for older/blocked clipboard permissions
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  function selectTab(key) {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === key)));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== key; });
  }

  // The same workspace serves both an analyzed image and a typed color.
  function setWorkspaceMode(mode) {
    const color = mode === 'color';
    dom.workspaceImg.hidden = color;
    dom.baseColor.hidden = !color;
    dom.swatchTrio.hidden = color;
    dom.baseInfo.hidden = !color;
    document.querySelector('.tab[data-tab="colors"]').hidden = color; // nothing was "found" in a typed color
    dom.startOverBtn.textContent = color ? 'Try another color' : 'Upload another image';
  }

  function renderBaseColor(c) {
    dom.baseColor.style.background = c.hex;
    const steps = [tint(c, 0.85), tint(c, 0.65), tint(c, 0.45), tint(c, 0.25), c, shade(c, 0.2), shade(c, 0.4), shade(c, 0.6), shade(c, 0.8)];
    dom.baseInfo.innerHTML = `
      <div class="base-info__name">${c.name}</div>
      <button class="swatch-card__hex" data-copy="${c.hex}">${copyIcon()} ${c.hex}</button>
      <div class="swatch-card__values">RGB ${round(c.r)}, ${round(c.g)}, ${round(c.b)}<br/>HSL ${round(c.h)}°, ${round(c.s)}%, ${round(c.l)}%</div>
      <div class="scale" role="group" aria-label="Tints and shades of ${c.name}">
        ${steps.map((st, i) => `<button class="scale__chip${i === 4 ? ' is-base' : ''}" style="background:${st.hex}" data-copy="${st.hex}" title="${st.hex}" aria-label="Copy ${st.hex}"></button>`).join('')}
      </div>
      <p class="scale__note">Tints and shades. Click any to copy.</p>`;
  }

  function showColorError(msg) {
    dom.colorError.textContent = msg;
    dom.colorError.hidden = false;
  }

  function updateColorChip() {
    const rgb = parseColorInput(dom.colorInput.value);
    dom.colorChip.style.background = rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : '';
    dom.colorChip.classList.toggle('has-color', Boolean(rgb));
  }

  // A typed color goes through the same engine as an image. It is simply a
  // palette with one color in it.
  function handleColorSubmit(raw) {
    dom.colorError.hidden = true;
    if (!String(raw || '').trim()) {
      showColorError('Type a color first: a HEX code like #6B7950, or a name like sage green.');
      return;
    }
    const rgb = parseColorInput(raw);
    if (!rgb) {
      const tips = suggestColorNames(raw);
      showColorError(
        "We couldn't read that color. Try a HEX like #6B7950, RGB like 107, 121, 80, or a name like sage green." +
        (tips.length ? ` Did you mean ${tips.join(', ')}?` : '')
      );
      return;
    }
    try {
      const base = { ...colorFromRgb(rgb.r, rgb.g, rgb.b), pct: 100 };
      const colorsFound = [base];
      const { dominant, secondary, accent } = pickDominantSecondaryAccent(colorsFound);
      const ctx = buildContext(colorsFound, dominant, secondary, true);
      const recommendations = generateRecommendations(ctx);
      const fullPalette = assembleFullPalette(ctx, recommendations);

      state = { colorsFound, dominant, secondary, accent, recommendations, fullPalette, gradientType: 'linear' };

      setWorkspaceMode('color');
      renderBaseColor(base);
      renderBestPick(pickOverallBest(recommendations));
      renderRecommendations(recommendations);
      renderFullPalette(fullPalette);
      renderGradient();
      selectTab('palette');

      dom.emptySample.hidden = true;
      dom.hero.hidden = true;
      dom.workspace.hidden = false;
      window.scrollTo({ top: 0 });
    } catch (err) {
      showColorError("That color couldn't be turned into a palette. Try a HEX like #6B7950.");
    }
  }

  function resetToEmpty() {
    dom.colorEntry.hidden = false;
    dom.colorError.hidden = true;
    dom.uploaderPreview.hidden = true;
    dom.dropzone.hidden = false;
    dom.workspace.hidden = true;
    dom.emptySample.hidden = false;
    dom.hero.hidden = false;
    hideStatus();
    clearError();
    dom.fileInput.value = '';
    state = { colorsFound: [], dominant: null, secondary: null, accent: null, recommendations: {}, fullPalette: null, gradientType: 'linear' };
  }

  async function handleFile(file) {
    clearError();
    let loaded;
    try {
      loaded = await loadImageFile(file);
    } catch (err) {
      const messages = {
        type: "That file type isn't supported. Try uploading a JPG, PNG, or WebP.",
        size: "That image is too large to analyze. Try a file under 40MB.",
        decode: "That image couldn't be analyzed. Try uploading a JPG, PNG, or WebP.",
        empty: "No image was selected.",
      };
      showError(messages[err.message] || "That image couldn't be analyzed. Try a different file.");
      return;
    }

    dom.previewImg.src = loaded.url;
    dom.colorEntry.hidden = true;
    dom.uploaderPreview.hidden = false;
    dom.dropzone.hidden = true;

    setStatus('Analyzing your image…');
    dom.workspace.hidden = true;
    dom.emptySample.hidden = true;

    // Let the browser paint the "analyzing" state before the (brief) synchronous work.
    await new Promise((r) => setTimeout(r, 30));

    try {
      const imageData = downsampleToImageData(loaded.img);
      const colorsFound = extractColorsFound(imageData);
      if (colorsFound.length === 0) throw new Error('empty-analysis');

      const { dominant, secondary, accent } = pickDominantSecondaryAccent(colorsFound);
      const ctx = buildContext(colorsFound, dominant, secondary);
      const recommendations = generateRecommendations(ctx);
      const fullPalette = assembleFullPalette(ctx, recommendations);
      const overallBest = pickOverallBest(recommendations);

      state = { colorsFound, dominant, secondary, accent, recommendations, fullPalette, gradientType: 'linear' };

      dom.workspaceImg.src = loaded.url;
      setWorkspaceMode('image');
      selectTab('colors');
      renderColorsFound(colorsFound);
      renderSwatchTrio(dominant, secondary, accent);
      renderBestPick(overallBest);
      renderRecommendations(recommendations);
      renderFullPalette(fullPalette);
      renderGradient();

      dom.hero.hidden = true;
      dom.workspace.hidden = false;
    } catch (err) {
      showError("That image couldn't be analyzed. Try uploading a JPG, PNG, or WebP.");
    } finally {
      // Always clears, whether analysis succeeded or failed, so the interface
      // never gets stuck showing "Analyzing your image..." indefinitely.
      hideStatus();
    }
  }

  /* ============================================================
     9. EVENT WIRING
  ============================================================ */

  dom.browseBtn.addEventListener('click', () => dom.fileInput.click());
  dom.dropzone.addEventListener('click', () => dom.fileInput.click());
  dom.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.fileInput.click(); }
  });

  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dom.dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dom.dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dom.dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dom.dropzone.classList.remove('is-dragover');
    });
  });
  dom.dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  dom.replaceBtn.addEventListener('click', () => dom.fileInput.click());

  // start from a typed color
  dom.colorNames.innerHTML = ensureNamedTable().map((n) => `<option value="${n.name}"></option>`).join('');
  dom.colorForm.addEventListener('submit', (e) => { e.preventDefault(); handleColorSubmit(dom.colorInput.value); });
  dom.colorInput.addEventListener('input', () => { dom.colorError.hidden = true; updateColorChip(); });
  dom.removeBtn.addEventListener('click', resetToEmpty);
  dom.startOverBtn.addEventListener('click', resetToEmpty);

  // tabs
  dom.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    selectTab(btn.dataset.tab);
  });

  // gradient type toggle
  dom.gradientTypeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented__btn');
    if (!btn) return;
    document.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    state.gradientType = btn.dataset.gradtype;
    renderGradient();
  });

  dom.copyGradientBtn.addEventListener('click', async () => {
    const ok = await copyText(dom.gradientCode.textContent);
    showToast(ok ? 'Copied!' : "Couldn't copy. Select and copy manually");
  });

  dom.copyAllHexBtn.addEventListener('click', async () => {
    if (!state.fullPalette) return;
    const list = PALETTE_ROLES.map(([key, label]) => `${label}: ${state.fullPalette[key].hex}`).join('\n');
    const ok = await copyText(list);
    showToast(ok ? 'Copied!' : "Couldn't copy. Select and copy manually");
  });

  dom.copyCssVarsBtn.addEventListener('click', async () => {
    if (!state.fullPalette) return;
    const p = state.fullPalette;
    const css = [
      ':root {',
      `  --color-primary: ${p.primary.hex};`,
      `  --color-secondary: ${p.secondary.hex};`,
      `  --color-accent: ${p.accent.hex};`,
      `  --color-background: ${p.background.hex};`,
      `  --color-text: ${p.text.hex};`,
      `  --color-highlight: ${p.highlight.hex};`,
      '}',
    ].join('\n');
    const ok = await copyText(css);
    showToast(ok ? 'Copied!' : "Couldn't copy. Select and copy manually");
  });

  // event delegation for every "copy hex" style button rendered dynamically
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const ok = await copyText(btn.dataset.copy);
    showToast(ok ? 'Copied!' : "Couldn't copy. Select and copy manually");
  });

  /* ============================================================
     10. PWA: install button + service worker registration
     (Uploaded images are read via URL.createObjectURL()/FileReader,
     never fetched over the network, so the service worker never
     sees them and never caches them, only app-shell files do.)
  ============================================================ */

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* ignore (private mode, etc.) */ }
  }

  const INSTALLED_KEY = 'gleam-color-installed';
  let deferredInstallPrompt = null;

  function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function hideInstallButton() {
    if (dom.installBtn) dom.installBtn.hidden = true;
  }

  // The button is visible from the start (unless the app is already installed
  // or running as an installed app). Not every browser exposes a native install
  // prompt, and Chrome only offers it once per page load, so waiting for that
  // event meant the button often never appeared. Clicking it uses the native
  // prompt when there is one, and otherwise shows short, platform-specific steps.
  if (dom.installBtn && !isRunningStandalone() && !safeStorageGet(INSTALLED_KEY)) {
    dom.installBtn.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we trigger the browser's own prompt from our button instead
    deferredInstallPrompt = e;
  });

  function installHelpText() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const isFirefox = /Firefox|FxiOS/.test(ua);
    const isEdge = /Edg\//.test(ua);
    const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(ua);

    if (!window.isSecureContext) return 'Installing needs a secure connection (https). Open the published site instead of a local file.';
    if (isIOS) return 'On iPhone or iPad: tap the Share button, then Add to Home Screen.';
    if (isAndroid && isFirefox) return 'In Firefox, open the menu and tap Install.';
    if (isAndroid) return 'Open the browser menu (three dots) and tap Install app or Add to Home screen.';
    if (isFirefox) return "Firefox on desktop can't install web apps. Chrome or Edge can.";
    if (isSafari) return 'In Safari, choose File, then Add to Dock.';
    if (isEdge) return 'Open the menu (three dots), choose Apps, then Install this site as an app.';
    return 'Click the install icon at the right end of the address bar, or open the browser menu and choose Install Gleam Color.';
  }

  if (dom.installBtn) {
    dom.installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showToast(installHelpText(), 8000, true);
        return;
      }
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null; // a prompt event can only be used once
      promptEvent.prompt();
      try {
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') hideInstallButton();
      } catch (_) { /* ignore */ }
    });
  }

  window.addEventListener('appinstalled', () => {
    safeStorageSet(INSTALLED_KEY, '1');
    hideInstallButton();
    deferredInstallPrompt = null;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        // Registration failing shouldn't break the app. It still works fully online.
        console.warn('[Gleam Color] service worker registration failed (needs https or localhost):', err);
      });
    });
  }

  /* ============================================================
     11. INIT
  ============================================================ */
  renderSampleFan();
})();
