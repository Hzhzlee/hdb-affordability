/**
 * Serverless function for geocoding Singapore addresses via OneMap Search API.
 * Includes in-memory caching, token management fallback, rate limit retry, and concurrency throttling.
 */

// In-memory cache keyed by normalized address
// Value: { lat?: number, lng?: number, matched: boolean }
const geocodeCache = new Map();

// Token cache for OneMap authentication
let cachedToken = null;
let tokenExpiresAt = 0;

async function getOneMapToken() {
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;

  if (!email || !password || !email.trim() || !password.trim()) {
    return {
      errorStatus: 503,
      errorReason: 'OneMap authentication required but ONEMAP_EMAIL or ONEMAP_PASSWORD is not configured',
    };
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) {
    return { token: cachedToken };
  }

  try {
    let response = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password: password.trim() }),
    });

    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1000));
      response = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      if (response.status === 429) {
        return { errorStatus: 429, errorReason: 'OneMap rate limit reached during token request' };
      }
    }

    if (!response.ok) {
      return {
        errorStatus: response.status,
        errorReason: `OneMap token authentication returned HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    if (!data.access_token) {
      return {
        errorStatus: 502,
        errorReason: 'OneMap token response missing access_token',
      };
    }

    cachedToken = data.access_token;
    // Expiry timestamp can be seconds or a date string
    const expiryNum = Number(data.expiry_timestamp);
    if (!isNaN(expiryNum) && expiryNum > 0) {
      tokenExpiresAt = expiryNum > 1e11 ? expiryNum : expiryNum * 1000;
    } else {
      tokenExpiresAt = now + 3 * 24 * 3600 * 1000; // default 3 days
    }

    return { token: cachedToken };
  } catch {
    return {
      errorStatus: 502,
      errorReason: 'Failed to contact OneMap authentication service',
    };
  }
}

async function searchOneMap(address, token = null) {
  const encoded = encodeURIComponent(address.trim());
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encoded}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(url, { headers });

  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 1000));
    response = await fetch(url, { headers });
    if (response.status === 429) {
      return { errorStatus: 429, errorReason: 'OneMap rate limit reached (HTTP 429)' };
    }
  }

  if (response.status === 401 || response.status === 403) {
    // Attempt to obtain token and retry once
    const tokenResult = await getOneMapToken();
    if (tokenResult.errorStatus) {
      return tokenResult;
    }

    headers['Authorization'] = `Bearer ${tokenResult.token}`;
    response = await fetch(url, { headers });

    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1000));
      response = await fetch(url, { headers });
      if (response.status === 429) {
        return { errorStatus: 429, errorReason: 'OneMap rate limit reached (HTTP 429)' };
      }
    }
  }

  if (!response.ok) {
    return {
      errorStatus: response.status,
      errorReason: `OneMap Search upstream returned HTTP ${response.status}`,
    };
  }

  try {
    const data = await response.json();
    return { data };
  } catch {
    return {
      errorStatus: 502,
      errorReason: 'Failed to parse OneMap JSON response',
    };
  }
}

async function geocodeSingle(address) {
  const normKey = address.trim().toUpperCase();
  if (geocodeCache.has(normKey)) {
    const cached = geocodeCache.get(normKey);
    if (cached.matched && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
      return { result: { address, lat: cached.lat, lng: cached.lng } };
    }
    return { result: { address } };
  }

  const searchRes = await searchOneMap(address, cachedToken);
  if (searchRes.errorStatus) {
    return { fatalError: searchRes };
  }

  const results = searchRes.data?.results;
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0];
    const lat = Number(first.LATITUDE);
    const lng = Number(first.LONGITUDE);

    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      geocodeCache.set(normKey, { lat, lng, matched: true });
      return { result: { address, lat, lng } };
    }
  }

  // No match or coordinates invalid
  geocodeCache.set(normKey, { matched: false });
  return { result: { address } };
}

export default async function handler(req, res) {
  let rawAddresses = [];

  if (req.method === 'POST') {
    if (Array.isArray(req.body?.addresses)) {
      rawAddresses = req.body.addresses;
    }
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    const qParam = req.query?.addresses || req.query?.q;
    if (Array.isArray(qParam)) {
      rawAddresses = qParam;
    } else if (typeof qParam === 'string' && qParam.trim().length > 0) {
      try {
        const parsed = JSON.parse(qParam);
        if (Array.isArray(parsed)) {
          rawAddresses = parsed;
        } else {
          rawAddresses = [qParam];
        }
      } catch {
        if (qParam.includes('|')) {
          rawAddresses = qParam.split('|');
        } else {
          rawAddresses = [qParam];
        }
      }
    }
  } else {
    res.setHeader('Allow', 'GET, POST, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const addresses = rawAddresses
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 50);

  if (addresses.length === 0) {
    res.setHeader('Cache-Control', 's-maxage=604800');
    return res.status(200).json({ results: [] });
  }

  // Throttle with small concurrency cap to stay well within OneMap rate limits
  const CONCURRENCY = 4;
  const finalResults = [];

  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const chunk = addresses.slice(i, i + CONCURRENCY);
    const chunkPromises = chunk.map((addr) => geocodeSingle(addr));
    const stepOutputs = await Promise.all(chunkPromises);

    for (const out of stepOutputs) {
      if (out.fatalError) {
        return res.status(out.fatalError.errorStatus).json({ error: out.fatalError.errorReason });
      }
      finalResults.push(out.result);
    }

    if (i + CONCURRENCY < addresses.length) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  res.setHeader('Cache-Control', 's-maxage=604800');
  return res.status(200).json({ results: finalResults });
}
