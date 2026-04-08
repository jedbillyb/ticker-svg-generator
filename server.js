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
  { symbol: 'RKLB', name: 'Rocket Lab USA', close: '24.31', change: '0.87', percent_change: '3.71' },
  { symbol: 'NVDA', name: 'NVIDIA Corp', close: '875.40', change: '-12.30', percent_change: '-1.39' },
  { symbol: 'NBIS', name: 'Nebius Group', close: '18.92', change: '0.44', percent_change: '2.38' },
  { symbol: 'BTC/USD', name: 'Bitcoin', close: '83241.00', change: '-1024.00', percent_change: '-1.21' },
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
  const isLight = theme === 'light';
  const colors = {
    bg: isLight ? '#ffffff' : '#151515',
    symbol: isLight ? '#1f2328' : '#f0f6fc',
    name: isLight ? '#636c76' : '#8b949e',
    price: isLight ? '#1f2328' : '#f0f6fc',
    border: isLight ? '#d0d7de' : '#30363d'
  };

  const cardWidth = 240;
  const height = 80;
  const totalWidth = stocks.length * cardWidth;

  let content = '';

  stocks.forEach((stock, i) => {
    const xOffset = i * cardWidth;
    const isPositive = parseFloat(stock.change) >= 0;
    const color = isPositive ? '#39d353' : '#ff7b72';
    const arrow = isPositive ? '▲' : '▼';
    const sign = isPositive ? '+' : '';

    const priceStr = parseFloat(stock.close).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pctStr = `${sign}${parseFloat(stock.percent_change).toFixed(2)}%`;
    const displayName = escapeXml(stock.symbol.toUpperCase());
    const truncName = (stock.name || '').length > 18 ? stock.name.slice(0, 18) + '...' : stock.name;
    const escapedName = escapeXml(truncName.toUpperCase());

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
            ${i > 0 ? `<line x1="0" y1="15" x2="0" y2="65" stroke="${colors.border}" stroke-width="1"/>` : ''}

            <text x="20" y="26" class="text symbol">${displayName}</text>
            <text x="20" y="38" class="text name">${escapedName}</text>
            <text x="20" y="62" class="text price">$${priceStr}</text>

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
        .symbol { fill: ${colors.symbol}; font-size: 13px; font-weight: 600; }
        .name { fill: ${colors.name}; font-size: 9px; font-weight: 500; letter-spacing: 0.5px; }
        .price { fill: ${colors.price}; font-size: 18px; font-weight: 600; }
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

        ${staggerStyles}
      </style>
    </defs>

    <rect width="${totalWidth}" height="${height}" rx="6" fill="${colors.bg}" ${isLight ? 'stroke="#d0d7de" stroke-width="1"' : ''} />

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
    const url = `https://api.twelvedata.com/quote?symbol=${STOCKS_TO_TRACK}&apikey=${API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok || data.code) {
        console.error('API Error during background refresh:', data);
        return;
    }

    // Convert API response to array
    const symbols = STOCKS_TO_TRACK.split(',');
    globalStockCache = symbols.map(s => (symbols.length === 1 ? data : data[s])).filter(Boolean);
    
    console.log(`Cache updated at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error('Failed to refresh stocks:', err);
  }
}

app.get('/banner/:symbols', async (req, res) => {
  const rawPath = req.params.symbols.replace('.svg', '');
  const symbols = rawPath.toUpperCase();
  const theme = req.query.theme === 'light' ? 'light' : 'dark';

  if (DEV_MODE) {
    const svg = buildBanner(MOCK_STOCKS, theme);
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(svg);
  }

  const cachedData = cache.get(symbols);

  try {
    const url = `https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok || data.code) throw new Error('API Error');

    let symbolsArray = symbols.split(',');
    let stockArray = symbolsArray.map(s => 
      symbolsArray.length === 1 ? data : data[s]
    ).filter(Boolean);

    // 2. Save the result to cache before sending
    cache.set(symbols, {
      data: stockArray,
      timestamp: Date.now()
    });

    const svg = buildBanner(stockArray, theme);
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

  const theme = req.query.theme === 'light' ? 'light' : 'dark';
  const svg = buildBanner(globalStockCache, theme);

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(svg);
});