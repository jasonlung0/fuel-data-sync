async function run() {
  try {
    const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY;
    
    // Safety Validation
    if (!SCRAPINGANT_API_KEY || SCRAPINGANT_API_KEY.trim() === "") {
      throw new Error("CRITICAL: SCRAPINGANT_API_KEY is undefined or empty.");
    }
    if (!process.env.GOV_CLIENT_ID || !process.env.GOV_CLIENT_SECRET) {
      throw new Error("CRITICAL: GOV_CLIENT_ID or GOV_CLIENT_SECRET is missing.");
    }

    // ---------------------------------------------------------
    // 1. Get the OAuth Access Token via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Requesting access token...");
    const tokenTargetUrl = 'https://service.gov.uk';
    
    // CORRECTED: All ScrapingAnt configs MUST be in the query string, not the body.
    const saBaseUrl = 'https://api.scrapingant.com/v2/general';
    const tokenParams = new URLSearchParams({
      'x-api-key': SCRAPINGANT_API_KEY,
      'url': tokenTargetUrl,
      'proxy_type': 'residential',
      'proxy_country': 'gb',
      'browser': 'false' // Use 'false' for pure API POST requests to ensure data passes correctly
    });

    const saTokenUrl = `${saBaseUrl}?${tokenParams.toString()}`;

    let tokenResponse;
    try {
      tokenResponse = await fetch(saTokenUrl, {
        method: 'POST', // We use POST because we are sending data to the Gov API
        headers: {
          // Tell ScrapingAnt the body is JSON
          'Ant-Content-Type': 'application/json', 
          // Standard headers for the target
          'Content-Type': 'application/json'
        },
        // The body contains ONLY the data for the Government API
        body: JSON.stringify({
          client_id: process.env.GOV_CLIENT_ID,
          client_secret: process.env.GOV_CLIENT_SECRET
        })
      });
    } catch (networkError) {
      console.error("Network Error Details:", networkError.cause || networkError);
      throw new Error(`Connection to ScrapingAnt endpoint failed: ${networkError.message}`);
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      // Log the full error to help debug if it fails again
      console.error(`Full Error Response: ${errorText}`);
      throw new Error(`Token request failed with status ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    if (!accessToken) {
      throw new Error(`Access token missing. Full response: ${JSON.stringify(tokenData)}`);
    }
    console.log("Access token obtained successfully.");

    // ---------------------------------------------------------
    // 2. Fetch Fuel Prices via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Fetching fuel prices...");
    const pricesTargetUrl = 'https://service.gov.uk';
    
    const pricesParams = new URLSearchParams({
      'url': pricesTargetUrl,
      'x-api-key': SCRAPINGANT_API_KEY,
      'browser': 'false', // Faster for JSON APIs
      'proxy_type': 'residential',
      'proxy_country': 'gb'
    });

    const saPricesUrl = `${saBaseUrl}?${pricesParams.toString()}`;

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

    const pricesData = await pricesResponse.json();
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
      throw new Error(`Cloudflare KV upload failed: ${cfResponse.status} - ${errorText}`);
    }

    console.log("Upload successful!");

  } catch (error) {
    console.error("Error in sync process:", error.message);
    process.exit(1);
  }
}

run();
