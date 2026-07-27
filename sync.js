async function run() {
  try {
    const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY;
    
    // Check for critical credentials before beginning execution
    if (!SCRAPINGANT_API_KEY) {
      throw new Error("Missing SCRAPINGANT_API_KEY in environment variables.");
    }

    // ---------------------------------------------------------
    // 1. Get the OAuth Access Token via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Requesting access token...");
    const tokenTargetUrl = 'https://service.gov.uk';
    const saBaseUrl = `https://scrapingant.com{SCRAPINGANT_API_KEY}`;

    const tokenResponse = await fetch(saBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ant-Content-Type': 'application/json',
        'Ant-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        url: tokenTargetUrl,
        browser: true,
        proxy_type: 'residential',
        proxy_country: 'gb',
        method: 'POST', 
        data: JSON.stringify({
          client_id: process.env.GOV_CLIENT_ID,
          client_secret: process.env.GOV_CLIENT_SECRET
        })
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token request failed with status ${tokenResponse.status}: ${errorText.substring(0, 500)}`);
    }

    // Defensive parsing to catch HTML responses before they crash the runtime
    const rawTokenText = await tokenResponse.text();
    let tokenData;
    try {
      tokenData = JSON.parse(rawTokenText);
    } catch (e) {
      throw new Error(`Token response was not valid JSON. Raw body: ${rawTokenText.substring(0, 500)}`);
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error(`Access token missing from response payload. Response: ${rawTokenText}`);
    }
    console.log("Access token obtained successfully.");

    // ---------------------------------------------------------
    // 2. Fetch Fuel Prices via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Fetching fuel prices...");
    const pricesTargetUrl = 'https://service.gov.uk';
    
    // For GET requests, parameters can safely sit inside the query string
    const saPricesUrl = `https://scrapingant.com{encodeURIComponent(pricesTargetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=true&proxy_type=residential&proxy_country=gb`;

    const pricesResponse = await fetch(saPricesUrl, {
      method: 'GET',
      headers: {
        'Ant-Authorization': `Bearer ${accessToken}`,
        'Ant-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!pricesResponse.ok) {
      const errorText = await pricesResponse.text();
      throw new Error(`Prices request failed with status ${pricesResponse.status}: ${errorText.substring(0, 500)}`);
    }

    const rawPricesText = await pricesResponse.text();
    let pricesData;
    try {
      pricesData = JSON.parse(rawPricesText);
    } catch (e) {
      throw new Error(`Prices response was not valid JSON. Raw body: ${rawPricesText.substring(0, 500)}`);
    }

    console.log(`Fetched fuel data successfully.`);

    // ---------------------------------------------------------
    // 3. Upload to Cloudflare KV (Direct)
    // ---------------------------------------------------------
    console.log("Uploading to Cloudflare KV...");
    const cfUrl = `https://cloudflare.com{process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_NAMESPACE_ID}/values/latest_fuel_data`;

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
      throw new Error(`Cloudflare KV upload failed with status ${cfResponse.status}: ${errorText.substring(0, 500)}`);
    }

    console.log("Upload successful!");

  } catch (error) {
    console.error("Error in sync process:", error.message);
    process.exit(1);
  }
}

run();
