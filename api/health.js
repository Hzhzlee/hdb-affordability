/**
 * Health check endpoint.
 * Reports whether each optional credential is configured (as boolean only)
 * and whether data.gov.sg and OneMap each answered, with their upstream HTTP status.
 * Never prints any credential or part of one.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const dataGovApiKeyConfigured = Boolean(
    process.env.DATA_GOV_SG_API_KEY && process.env.DATA_GOV_SG_API_KEY.trim().length > 0
  );
  const oneMapEmailConfigured = Boolean(
    process.env.ONEMAP_EMAIL && process.env.ONEMAP_EMAIL.trim().length > 0
  );
  const oneMapPasswordConfigured = Boolean(
    process.env.ONEMAP_PASSWORD && process.env.ONEMAP_PASSWORD.trim().length > 0
  );

  // Check data.gov.sg
  let dataGovStatus = null;
  let dataGovOk = false;
  try {
    const dataGovHeaders = {};
    if (dataGovApiKeyConfigured) {
      dataGovHeaders['x-api-key'] = process.env.DATA_GOV_SG_API_KEY.trim();
    }
    const dgRes = await fetch(
      'https://data.gov.sg/api/action/datastore_search?resource_id=d_8b84c4ee58e3cfc0ece0d773c8ca6abc&limit=1',
      { headers: dataGovHeaders }
    );
    dataGovStatus = dgRes.status;
    dataGovOk = dgRes.ok;
  } catch {
    dataGovStatus = 503;
    dataGovOk = false;
  }

  // Check OneMap
  let oneMapStatus = null;
  let oneMapOk = false;
  try {
    const omRes = await fetch(
      'https://www.onemap.gov.sg/api/common/elastic/search?searchVal=Singapore&returnGeom=Y&getAddrDetails=Y&pageNum=1'
    );
    oneMapStatus = omRes.status;
    oneMapOk = omRes.ok;
  } catch {
    oneMapStatus = 503;
    oneMapOk = false;
  }

  return res.status(200).json({
    status: dataGovOk && oneMapOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    credentials: {
      data_gov_sg_api_key_configured: dataGovApiKeyConfigured,
      onemap_email_configured: oneMapEmailConfigured,
      onemap_password_configured: oneMapPasswordConfigured,
    },
    upstream: {
      data_gov_sg: {
        status: dataGovStatus,
        ok: dataGovOk,
      },
      onemap: {
        status: oneMapStatus,
        ok: oneMapOk,
      },
    },
  });
}
