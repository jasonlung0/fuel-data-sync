async function run() {
  try {
    const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY;
    
    // ---------------------------------------------------------
    // 1. Get the OAuth Access Token via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Requesting access token...");
    const tokenTargetUrl = 'https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token';
    const saTokenUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(tokenTargetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=false`;

    const tokenResponse = await fetch(saTokenUrl, {
      method: 'POST',
      headers: {
        // Use the 'Ant-' prefix for any headers the government API requires
        'Ant-Content-Type': 'application/json',
        'Ant-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        client_id: process.env.GOV_CLIENT_ID,
        client_secret: process.env.GOV_CLIENT_SECRET
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token request failed: ${tokenResponse.status} - ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    console.log("Access token obtained successfully.");

    // ---------------------------------------------------------
    // 2. Fetch Fuel Prices via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Fetching fuel prices...");
    const pricesTargetUrl = 'https://www.fuel-finder.service.gov.uk/api/v1/prices';
    const saPricesUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(pricesTargetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=false`;

    const pricesResponse = await fetch(saPricesUrl, {
      method: 'GET',
      headers: {
        // Forward the Authorization bearer token using the prefix
        'Ant-Authorization': `Bearer ${accessToken}`,
        'Ant-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!pricesResponse.ok) {
      const errorText = await pricesResponse.text();
      throw new Error(`Prices request failed: ${pricesResponse.status} - ${errorText}`);
    }

    const pricesData = await pricesResponse.json();
    console.log(`Fetched ${pricesData.stations?.length || 0} stations.`);

    // ---------------------------------------------------------
    // 3. Upload to Cloudflare KV (Direct)
    // ---------------------------------------------------------
    console.log("Uploading to Cloudflare KV...");
    // We do not proxy this request because Cloudflare's API does not block GitHub Actions.
    const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_NAMESPACE_ID}/values/latest_fuel_data`;

    const cfResponse = await fetch(cfUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pricesData)
    });

    if (!cfResponse.ok) {
      const errorText = await cfResponse.text();
      throw new Error(`Cloudflare KV upload failed: ${cfResponse.status} - ${errorText}`);
    }

    console.log("Upload successful!");

  } catch (error) {
    console.error("Error in sync process:", error.message);
    process.exit(1);
  }
}

run();
