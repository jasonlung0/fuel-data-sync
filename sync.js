async function run() {
  try {
    const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY;
    
    // Safety Validation
    if (!SCRAPINGANT_API_KEY || SCRAPINGANT_API_KEY.trim() === "") {
      throw new Error("CRITICAL: SCRAPINGANT_API_KEY is undefined or empty. Check GitHub Secrets.");
    }
    if (!process.env.GOV_CLIENT_ID || !process.env.GOV_CLIENT_SECRET) {
      throw new Error("CRITICAL: GOV_CLIENT_ID or GOV_CLIENT_SECRET is missing.");
    }

    // ---------------------------------------------------------
    // 1. Get the OAuth Access Token via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Requesting access token...");
    const tokenTargetUrl = 'https://service.gov.uk';
    
    // CORRECTED: ScrapingAnt configs must be query parameters for POST requests
    const saBaseUrl = 'https://api.scrapingant.com/v2/general';
    const tokenParams = new URLSearchParams({
      'x-api-key': SCRAPINGANT_API_KEY,
      'url': tokenTargetUrl, 
      'proxy_type': 'residential', // Standard often gets blocked by Gov sites
      'proxy_country': 'gb',
      'browser': 'false' // Use false for pure API calls to avoid rendering overhead
    });

    // Final URL: https://scrapingant.com...
    const saTokenUrl = `${saBaseUrl}?${tokenParams.toString()}`;

    let tokenResponse;
    try {
      tokenResponse = await fetch(saTokenUrl, {
        method: 'POST', // Method matches the target API requirement
        headers: {
          'Ant-Content-Type': 'application/json', // Instructs ScrapingAnt to forward body as JSON
          'Content-Type': 'application/json'      // Standard header for good measure
        },
        // Body contains ONLY the data for the Government API
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
      // Log the HTML to see exactly what the error page says
      console.error(`Full Error Response (HTML): ${errorText.substring(0, 500)}...`); 
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
    
    // For GET requests, everything goes in the query string
    const pricesParams = new URLSearchParams({
      'url': pricesTargetUrl,
      'x-api-key': SCRAPINGANT_API_KEY,
      'browser': 'false', 
      'proxy_type': 'residential',
      'proxy_country': 'gb'
    });

    const saPricesUrl = `${saBaseUrl}?${pricesParams.toString()}`;

    const pricesResponse = await fetch(saPricesUrl, {
      method: 'GET',
      headers: {
        'Ant-Authorization': `Bearer ${accessToken}`, // Pass the token via Ant header
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
