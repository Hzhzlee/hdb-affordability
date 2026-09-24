/**
 * Serverless function for HDB affordability search.
 * Fetches resale flat transactions from data.gov.sg, computes town medians,
 * and returns within-budget town stats and recent block transactions.
 */

const RESOURCE_ID = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';

function getMonthList(latestMonthStr, count) {
  let year = parseInt(latestMonthStr.slice(0, 4), 10);
  let month = parseInt(latestMonthStr.slice(5, 7), 10);
  if (isNaN(year) || isNaN(month)) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const list = [];
  for (let i = 0; i < count; i++) {
    const mPadded = String(month).padStart(2, '0');
    list.push(`${year}-${mPadded}`);
    month--;
    if (month < 1) {
      month = 12;
      year--;
    }
  }
  return list;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const budgetRaw = req.query?.budget;
  if (budgetRaw === undefined || budgetRaw === null || String(budgetRaw).trim() === '') {
    return res.status(400).json({ error: 'budget is required and must be a whole number (SGD)' });
  }

  const budget = Number(budgetRaw);
  if (!Number.isInteger(budget) || budget <= 0) {
    return res.status(400).json({ error: 'budget must be a positive whole number (SGD)' });
  }

  let months = 12;
  if (req.query?.months !== undefined && req.query?.months !== null && String(req.query.months).trim() !== '') {
    const parsedMonths = Number(req.query.months);
    if (!Number.isInteger(parsedMonths) || parsedMonths < 1) {
      return res.status(400).json({ error: 'months must be a positive whole number between 1 and 24' });
    }
    months = Math.min(parsedMonths, 24);
  }

  const flatTypeRaw = req.query?.flat_type;
  let flatType = null;
  if (flatTypeRaw && typeof flatTypeRaw === 'string' && flatTypeRaw.trim() && flatTypeRaw.trim().toUpperCase() !== 'ALL') {
    flatType = flatTypeRaw.trim().toUpperCase();
  }

  // Tolerance percentage (+/- budget)
  let tolerancePct = 0;
  if (req.query?.tolerance_pct !== undefined && req.query?.tolerance_pct !== null && String(req.query.tolerance_pct).trim() !== '') {
    const parsedTol = Number(req.query.tolerance_pct);
    if (!isNaN(parsedTol) && parsedTol >= 0 && parsedTol <= 100) {
      tolerancePct = parsedTol;
    }
  }

  // Range mode: 'band' (min to max price) or 'ceiling' (up to max price)
  const rangeMode = String(req.query?.range_mode || 'band').toLowerCase() === 'ceiling' ? 'ceiling' : 'band';
  const maxPrice = Math.round(budget * (1 + tolerancePct / 100));
  const minPrice = rangeMode === 'ceiling'
    ? 0
    : tolerancePct === 0
    ? budget
    : Math.max(0, Math.round(budget * (1 - tolerancePct / 100)));

  // Configure headers for data.gov.sg
  const headers = {};
  const dataGovApiKey = process.env.DATA_GOV_SG_API_KEY;
  if (typeof dataGovApiKey === 'string' && dataGovApiKey.trim().length > 0) {
    headers['x-api-key'] = dataGovApiKey.trim();
  }

  async function fetchDatastore(url) {
    let response = await fetch(url, { headers });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await fetch(url, { headers });
      if (response.status === 429) {
        return { errorStatus: 429, errorReason: 'data.gov.sg rate limit exceeded (HTTP 429)' };
      }
    }
    if (!response.ok) {
      return { errorStatus: response.status, errorReason: `data.gov.sg responded with HTTP ${response.status}` };
    }
    try {
      const data = await response.json();
      return { data };
    } catch {
      return { errorStatus: 502, errorReason: 'Failed to parse data.gov.sg JSON response' };
    }
  }

  // 1. Determine latest available month
  let latestMonth = '2026-09';
  const probeUrl = `https://data.gov.sg/api/action/datastore_search?resource_id=${RESOURCE_ID}&limit=1&sort=month%20desc`;
  const probeRes = await fetchDatastore(probeUrl);
  if (probeRes.data?.result?.records?.[0]?.month) {
    latestMonth = probeRes.data.result.records[0].month;
  } else {
    const now = new Date();
    latestMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const monthsList = getMonthList(latestMonth, months);

  const filters = { month: monthsList };
  if (flatType) {
    filters.flat_type = flatType;
  }

  // 2. Page through results until done
  const limit = 10000;
  let offset = 0;
  const allRecords = [];
  let total = null;

  while (true) {
    const pageUrl = `https://data.gov.sg/api/action/datastore_search?resource_id=${RESOURCE_ID}&limit=${limit}&offset=${offset}&filters=${encodeURIComponent(JSON.stringify(filters))}`;
    const pageRes = await fetchDatastore(pageUrl);
    if (pageRes.errorStatus) {
      return res.status(pageRes.errorStatus).json({ error: pageRes.errorReason });
    }

    const records = pageRes.data?.result?.records || [];
    if (pageRes.data?.result?.total !== undefined) {
      total = pageRes.data.result.total;
    }
    allRecords.push(...records);

    if (records.length < limit || (total !== null && allRecords.length >= total)) {
      break;
    }
    offset += records.length;
  }

  // 3. Parse numbers & skip rows that fail
  const validRecords = [];
  for (const rec of allRecords) {
    const resalePrice = Number(rec.resale_price);
    const floorArea = Number(rec.floor_area_sqm);
    if (isNaN(resalePrice) || resalePrice <= 0 || isNaN(floorArea) || floorArea <= 0) {
      continue;
    }

    validRecords.push({
      _id: rec._id,
      month: String(rec.month || '').trim(),
      town: String(rec.town || '').trim().toUpperCase(),
      flat_type: String(rec.flat_type || '').trim().toUpperCase(),
      block: String(rec.block || '').trim(),
      street_name: String(rec.street_name || '').trim().toUpperCase(),
      storey_range: String(rec.storey_range || '').trim(),
      floor_area_sqm: floorArea,
      remaining_lease: String(rec.remaining_lease || '').trim(),
      resale_price: resalePrice,
    });
  }

  // 4. Compute town summaries
  const townMap = new Map();
  for (const rec of validRecords) {
    let t = townMap.get(rec.town);
    if (!t) {
      t = { town: rec.town, prices: [] };
      townMap.set(rec.town, t);
    }
    t.prices.push(rec.resale_price);
  }

  const towns = [];
  for (const [townName, townData] of townMap.entries()) {
    const prices = townData.prices.sort((a, b) => a - b);
    const count = prices.length;
    const lowest = prices[0];
    let median;
    if (count % 2 === 1) {
      median = prices[Math.floor(count / 2)];
    } else {
      median = Math.round((prices[count / 2 - 1] + prices[count / 2]) / 2);
    }

    const isWithinBudget = rangeMode === 'ceiling'
      ? median <= maxPrice
      : tolerancePct === 0
      ? median === budget
      : median >= minPrice && median <= maxPrice;

    towns.push({
      town: townName,
      count,
      median,
      lowest,
      within_budget: isWithinBudget,
      within_ceiling: median <= maxPrice,
    });
  }

  // Sorted by median ascending
  towns.sort((a, b) => a.median - b.median);

  // 5. Compute blocks: up to 50 transactions within budget (or +/- tolerance), most recent first
  const matchingRecords = validRecords.filter(
    (r) => r.resale_price >= minPrice && r.resale_price <= maxPrice
  );
  matchingRecords.sort((a, b) => {
    if (b.month !== a.month) {
      return b.month.localeCompare(a.month);
    }
    return a.resale_price - b.resale_price;
  });

  const blocks = matchingRecords.slice(0, 50).map((r) => ({
    block: r.block,
    street_name: r.street_name,
    town: r.town,
    flat_type: r.flat_type,
    storey_range: r.storey_range,
    floor_area_sqm: r.floor_area_sqm,
    remaining_lease: r.remaining_lease,
    resale_price: r.resale_price,
    month: r.month,
  }));

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({
    towns,
    blocks,
    budget,
    tolerance_pct: tolerancePct,
    min_price: minPrice,
    max_price: maxPrice,
    range_mode: rangeMode,
    flat_type: flatType,
    months,
    total_found: matchingRecords.length,
    latest_month_analyzed: latestMonth,
  });
}
