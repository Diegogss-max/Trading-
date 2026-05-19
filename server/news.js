const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const CACHE_FILE = path.join(__dirname, 'calendar_cache.json');
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour in milliseconds
const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

/**
 * Native HTTPS helper to fetch JSON data from a URL.
 * Works on all Node.js versions without external dependencies.
 * @param {string} url 
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed with status code ${res.statusCode}`));
        return;
      }
      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Maps the Forex Factory impact level string to a star rating (0 to 3)
 * @param {string} impact 
 * @returns {number}
 */
function getStarRating(impact) {
  switch (String(impact).toLowerCase()) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0; // Holiday or other neutral items
  }
}

/**
 * Fetches the macroeconomic calendar from Forex Factory JSON feed (via Fair Economy CDN)
 * and maintains a local cache file to respect server rate-limits.
 * Filters strictly for USD events.
 * 
 * @returns {Promise<Array>} List of filtered macroeconomic news
 */
async function getMacroNews() {
  let cacheExists = false;
  let cacheStats = null;

  try {
    cacheStats = await fs.stat(CACHE_FILE);
    cacheExists = true;
  } catch (err) {
    cacheExists = false;
  }

  const now = Date.now();

  // If cache exists and is fresh (less than 1 hour old), serve from cache
  if (cacheExists && cacheStats && (now - cacheStats.mtimeMs < CACHE_DURATION_MS)) {
    try {
      const data = await fs.readFile(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    } catch (parseErr) {
      console.error('Error reading/parsing news cache file:', parseErr.message);
      // If reading/parsing fails, we fall through to fetch fresh data
    }
  }

  console.log('Macro News cache is stale or missing. Fetching fresh data from Forex Factory feed...');
  try {
    const rawData = await fetchJson(FEED_URL);

    // Filter strictly for USD events
    const usdEvents = rawData
      .filter(event => event.country === 'USD')
      .map(event => ({
        title: event.title,
        country: event.country,
        date: event.date, // Format: ISO 8601 e.g. "2026-05-19T08:30:00-04:00"
        impact: event.impact, // "Low", "Medium", "High", "Holiday"
        stars: getStarRating(event.impact), // 1, 2, 3 stars
        forecast: event.forecast || '--',
        previous: event.previous || '--'
      }));

    // Save filtered results to local cache file
    await fs.writeFile(CACHE_FILE, JSON.stringify(usdEvents, null, 2), 'utf8');
    console.log(`Macro News successfully cached. Found ${usdEvents.length} USD events.`);

    return usdEvents;
  } catch (fetchErr) {
    console.error('Failed to fetch fresh macroeconomic news:', fetchErr.message);

    // Stale-on-error fallback: If fetch fails but we have an old cache file, use it
    if (cacheExists) {
      console.log('Serving stale macroeconomic news cache as fallback...');
      try {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        return JSON.parse(data);
      } catch (readErr) {
        console.error('Failed to read stale cache fallback:', readErr.message);
      }
    }

    // If everything fails, return empty list
    return [];
  }
}

module.exports = {
  getMacroNews
};
