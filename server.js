import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.TWELVE_DATA_API_KEY;
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const STOCKS_TO_TRACK = 'RKLB,NVDA,NBIS,BTC/USD';
let globalStockCache = null;

const STAGGER_DELAY_MS = 0.3; // seconds between each card entranc
const STAGGER_DURATION_S = 0.9; // how long each card's animation takes

const DEV_MODE = process.env.NODE_ENV !== 'production';

const MOCK_STOCKS = [
  { symbol: 'RKLB', name: 'Rocket Lab USA', close: '24.31', change: '0.87', percent_change: '3.71', trend: [22.1, 22.5, 23.2, 22.8, 23.5, 24.0, 24.31] },
  { symbol: 'NVDA', name: 'NVIDIA Corp', close: '875.40', change: '-12.30', percent_change: '-1.39', trend: [910.2, 905.1, 890.5, 885.2, 880.0, 878.5, 875.40] },
  { symbol: 'NBIS', name: 'Nebius Group', close: '18.92', change: '0.44', percent_change: '2.38', trend: [17.5, 17.8, 18.2, 18.0, 18.5, 18.7, 18.92] },
  { symbol: 'BTC/USD', name: 'Bitcoin', close: '83241.00', change: '-1024.00', percent_change: '-1.21', trend: [85000, 84200, 84800, 83500, 84000, 83800, 83241] },
];

function getChangeColor(change) {
  if (change > 0) return '#00e5a0';
  if (change < 0) return '#ff5c5c';
  return '#888';
}

function getArrow(change) {
  if (change > 0) return '▲';
  if (change < 0) return '▼';
  return '–';
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
    }
  });
}

function buildBanner(stocks, theme = 'dark') {
  const themes = {
    dark: {
      bg: '#151515',
      symbol: '#f0f6fc',
      name: '#8b949e',
      price: '#f0f6fc',
      border: '#30363d',
      trendOpacity: '0.4'
    },
    light: {
      bg: '#ffffff',
      symbol: '#1f2328',
      name: '#636c76',
      price: '#1f2328',
      border: '#d0d7de',
      stroke: '#d0d7de',
      trendOpacity: '0.2'
    },
    matrix: {
      bg: '#000000',
      symbol: '#00ff41',
      name: '#008f11',
      price: '#00ff41',
      border: '#003b00',
      pos: '#00ff41',
      neg: '#ff0000',
      trendOpacity: '0.5'
    },
    sunset: {
      bg: '#2d1b33',
      symbol: '#ff7e5f',
      name: '#feb47b',
      price: '#ffffff',
      border: '#4a304d',
      pos: '#ff7e5f',
      neg: '#feb47b',
      trendOpacity: '0.4'
    },
    dracula: {
      bg: '#282a36',
      symbol: '#bd93f9',
      name: '#6272a4',
      price: '#f8f8f2',
      border: '#44475a',
      pos: '#50fa7b',
      neg: '#ff5555',
      trendOpacity: '0.4'
    },
    forest: {
      bg: '#1a1d1a',
      symbol: '#a7c957',
      name: '#6a994e',
      price: '#f2e8cf',
      border: '#386641',
      pos: '#a7c957',
      neg: '#bc4749',
      trendOpacity: '0.4'
    }
  };

  const currentTheme = themes[theme] || themes.dark;
  const isLight = theme === 'light';

  const cardWidth = 240;
  const height = 80;
  const totalWidth = stocks.length * cardWidth;

  let content = '';

  stocks.forEach((stock, i) => {
    const xOffset = i * cardWidth;
    const isPositive = parseFloat(stock.change) >= 0;
    
    // Theme-specific or default colors for positive/negative
    const color = isPositive 
      ? (currentTheme.pos || '#39d353') 
      : (currentTheme.neg || '#ff7b72');

    const arrow = isPositive ? '▲' : '▼';
    const sign = isPositive ? '+' : '';

    const priceStr = parseFloat(stock.close).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pctStr = `${sign}${parseFloat(stock.percent_change).toFixed(2)}%`;
    const displayName = escapeXml(stock.symbol.toUpperCase());
    const truncName = (stock.name || '').length > 18 ? stock.name.slice(0, 18) + '...' : stock.name;
    const escapedName = escapeXml(truncName.toUpperCase());

    // Generate Sparkline Path
    let sparklinePath = '';
    if (stock.trend && stock.trend.length > 1) {
      const points = stock.trend.map(p => parseFloat(p));
      const min = Math.min(...points);
      const max = Math.max(...points);
      const range = max - min || 1;
      
      const chartW = 80;
      const chartH = 25;
      const chartX = 145;
      const chartY = 12;

      const coords = points.map((p, idx) => {
        const x = chartX + (idx / (points.length - 1)) * chartW;
        const y = chartY + chartH - ((p - min) / range) * chartH;
        return `${x},${y}`;
      });
      sparklinePath = coords.join(' L ');
    }

    // Each card gets its own clipPath to contain the slide animation
    content += `
      <defs>
        <clipPath id="clip-${i}">
          <rect x="${xOffset}" y="0" width="${cardWidth}" height="${height}" />
        </clipPath>
      </defs>
      <g clip-path="url(#clip-${i})">
        <g transform="translate(${xOffset}, 0)">
          <g class="stock-group stock-group-${i}">
            ${i > 0 ? `<line x1="0" y1="15" x2="0" y2="65" stroke="${currentTheme.border}" stroke-width="1"/>` : ''}

            <text x="20" y="26" class="text symbol">${displayName}</text>
            <text x="20" y="38" class="text name">${escapedName}</text>
            <text x="20" y="62" class="text price">$${priceStr}</text>

            ${sparklinePath ? `
            <path d="M ${sparklinePath}" 
                  fill="none" 
                  stroke="${color}" 
                  stroke-width="1.5" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"
                  opacity="${currentTheme.trendOpacity}"
                  class="trend-line" />` : ''}

            <g transform="translate(145, 42)">
              <g class="change-indicator">
                <rect width="75" height="20" rx="10" fill="${color}" fill-opacity="0.15"/>
                <text x="37.5" y="14" text-anchor="middle" class="text change" fill="${color}">${arrow} ${pctStr}</text>
              </g>
            </g>
          </g>
        </g>
      </g>`;
  });

  // Build per-card keyframe delays in the style block
  const staggerStyles = stocks.map((_, i) => `
    .stock-group-${i} {
      animation: slideUp ${STAGGER_DURATION_S}s cubic-bezier(0.22, 1, 0.36, 1) both;
      animation-delay: ${i * STAGGER_DELAY_MS}s;
    }
  `).join('');

  return `<svg width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
        .symbol { fill: ${currentTheme.symbol}; font-size: 13px; font-weight: 600; }
        .name { fill: ${currentTheme.name}; font-size: 9px; font-weight: 500; letter-spacing: 0.5px; }
        .price { fill: ${currentTheme.price}; font-size: 18px; font-weight: 600; }
        .change { font-size: 11px; font-weight: 600; }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes breathe {
          0%   { opacity: 0.6; }
          50%  { opacity: 1; }
          100% { opacity: 0.6; }
        }

        .change-indicator {
          animation: breathe 3s ease-in-out infinite;
          transform-box: fill-box;
          transform-origin: center;
        }

        .trend-line {
          animation: fadeIn 2s ease-in-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: ${currentTheme.trendOpacity}; }
        }

        ${staggerStyles}
      </style>
    </defs>

    <rect width="${totalWidth}" height="${height}" rx="6" fill="${currentTheme.bg}" ${currentTheme.stroke ? `stroke="${currentTheme.stroke}" stroke-width="1"` : ''} />

    ${content}
  </svg>`;
}

async function updateStockData() {
  if (DEV_MODE) {
    globalStockCache = MOCK_STOCKS;
    console.log("DEV MODE: using mock stock data");
    return;
  }
  try {
    const symbols = STOCKS_TO_TRACK.split(',');
    const results = await Promise.all(symbols.map(async (s) => {
      const quoteUrl = `https://api.twelvedata.com/quote?symbol=${s}&apikey=${API_KEY}`;
      const seriesUrl = `https://api.twelvedata.com/time_series?symbol=${s}&interval=1day&outputsize=7&order=ASC&apikey=${API_KEY}`;
      
      const [quoteR, seriesR] = await Promise.all([fetch(quoteUrl), fetch(seriesUrl)]);
      const quoteData = await quoteR.json();
      const seriesData = await seriesR.json();

      if (quoteData.code || seriesData.code) return null;

      return {
        ...quoteData,
        trend: seriesData.values ? seriesData.values.map(v => v.close) : []
      };
    }));

    globalStockCache = results.filter(Boolean);
    console.log(`Cache updated at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error('Failed to refresh stocks:', err);
  }
}

app.get('/banner/:symbols', async (req, res) => {
  const rawPath = req.params.symbols.replace('.svg', '');
  const symbols = rawPath.toUpperCase();
  const theme = req.query.theme || 'dark';

  if (DEV_MODE) {
    const svg = buildBanner(MOCK_STOCKS, theme);
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(svg);
  }

  const cachedData = cache.get(symbols);

  try {
    const symbolsList = symbols.split(',');
    const stockArray = await Promise.all(symbolsList.map(async (s) => {
      const quoteUrl = `https://api.twelvedata.com/quote?symbol=${s}&apikey=${API_KEY}`;
      const seriesUrl = `https://api.twelvedata.com/time_series?symbol=${s}&interval=1day&outputsize=7&order=ASC&apikey=${API_KEY}`;
      
      const [quoteR, seriesR] = await Promise.all([fetch(quoteUrl), fetch(seriesUrl)]);
      const quoteData = await quoteR.json();
      const seriesData = await seriesR.json();

      if (quoteData.code || seriesData.code) return null;

      return {
        ...quoteData,
        trend: seriesData.values ? seriesData.values.map(v => v.close) : []
      };
    }));

    const finalArray = stockArray.filter(Boolean);

    // Save the result to cache before sending
    cache.set(symbols, {
      data: finalArray,
      timestamp: Date.now()
    });

    const svg = buildBanner(finalArray, theme);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);

  } catch (err) {
    // If API fails but we have OLD data, serve the old data as a fallback
    if (cachedData) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(buildBanner(cachedData.data, theme));
    }
    console.error(`Error fetching symbols ${symbols}:`, err);
    res.status(500).send('Error');
  }
});

app.listen(PORT, () => {
  console.log(`ticker-svg running on :${PORT}`);
});

updateStockData(); 
setInterval(updateStockData, 5 * 60 * 1000);

app.get('/banner', (req, res) => {
  if (!globalStockCache) {
    return res.status(503).send('Server warming up... refresh in 5 seconds.');
  }

  const theme = req.query.theme || 'dark';
  const svg = buildBanner(globalStockCache, theme);

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(svg);
});
const MY_PROJECTS = [
  { name: 'ticker-svg', stack: 'Node.js · Express', desc: 'live animated market ticker for github profiles' },
  { name: 'ghook', stack: 'JavaScript · Express', desc: 'github → discord webhook bridge' },
  { name: 'nz-vehicle-finder', stack: 'React · TS · SQLite', desc: 'search & filter NZ vehicle listings' },
  { name: 'Desmos-Tool', stack: 'JavaScript', desc: 'chrome/firefox extension for Desmos graphs' },
  { name: 'vc-notif-bot', stack: 'JS · Discord.js', desc: 'voice channel join/leave notifications' },
  { name: 'faultline mc', stack: 'PaperMC · Shell', desc: 'minecraft smp community server' }
];

app.get('/projects', (req, res) => {
  const theme = req.query.theme || 'dark';
  const bg = theme === 'light' ? '#ffffff' : '#151515';
  const headerBg = theme === 'light' ? '#f6f8fa' : '#1c1c1c';
  const border = theme === 'light' ? '#d0d7de' : '#30363d';
  const rowBorder = theme === 'light' ? '#d0d7de' : '#21262d';
  const nameColor = theme === 'light' ? '#0969da' : '#58a6ff';
  const stackColor = theme === 'light' ? '#636c76' : '#8b949e';
  const descColor = theme === 'light' ? '#1f2328' : '#c9d1d9';

  const width = 960;
  const rowHeight = 40;
  const headerHeight = 35;
  const height = headerHeight + (MY_PROJECTS.length * rowHeight) + 15;

  const rows = MY_PROJECTS.map((p, i) => `
    <tr class="project-row" style="animation-delay: ${0.1 + (i * 0.1)}s;">
      <td style="padding: 8px 12px; color: ${nameColor}; font-weight: 600; font-size: 12px;">${escapeXml(p.name)}</td>
      <td style="padding: 8px 12px; color: ${stackColor}; font-size: 11px;">${escapeXml(p.stack)}</td>
      <td style="padding: 8px 12px; color: ${descColor}; font-size: 11px;">${escapeXml(p.desc)}</td>
    </tr>
  `).join('');

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .container {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          background: ${bg};
          border: 1px solid ${border};
          border-radius: 6px;
          overflow: hidden;
        }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th {
          background: ${headerBg};
          color: ${stackColor};
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          padding: 10px 12px;
          border-bottom: 1px solid ${border};
        }
        .project-row {
          border-bottom: 1px solid ${rowBorder};
          animation: slideUp 0.5s ease-out both;
        }
        .project-row:last-child { border-bottom: none; }
      </style>
      <div class="container">
        <table>
          <thead>
            <tr>
              <th style="width: 20%;">Project</th>
              <th style="width: 25%;">Stack</th>
              <th style="width: 55%;">What it does</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </foreignObject>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(svg);
});
