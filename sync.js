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
    const saBaseUrl = 'https://api.scrapingant.com/v2/general';
    
    // CONFIGURATION:
    // 1. All ScrapingAnt settings go in the URL Query String.
    // 2. We enable 'browser: true' to pass Cloudflare/WAF checks.
    const tokenParams = new URLSearchParams({
      'x-api-key': SCRAPINGANT_API_KEY,
      'url': tokenTargetUrl,
      'proxy_type': 'residential', // Essential for bypassing geo-blocks
      'proxy_country': 'gb',
      'browser': 'true' // Renders the request in a real browser to pass WAF
    });

    const saTokenUrl = `${saBaseUrl}?${tokenParams.toString()}`;

    let tokenResponse;
    try {
      tokenResponse = await fetch(saTokenUrl, {
        method: 'POST',
        headers: {
          // Tell ScrapingAnt to forward the body as JSON
          'Ant-Content-Type': 'application/json',
          // Tell the Gov API we strictly accept JSON (helps prevent HTML error pages)
          'Ant-Accept': 'application/json', 
          'Content-Type': 'application/json' 
        },
        // The Data Payload for the Gov API
        body: JSON.stringify({
          client_id: process.env.GOV_CLIENT_ID,
          client_secret: process.env.GOV_CLIENT_SECRET
        })
      });
    } catch (networkError) {
      console.error("Network Error Details:", networkError.cause || networkError);
      throw new Error(`Connection to ScrapingAnt endpoint failed: ${networkError.message}`);
    }

    // ROBUST ERROR HANDLING:
    // We read the text first to inspect it, preventing the "Unexpected token <" crash.
    const rawTokenText = await tokenResponse.text();

    if (!tokenResponse.ok) {
      // Log the specific HTML error to identify the block (e.g., "Cloudflare", "403 Forbidden")
      console.error(`Request Failed with Status ${tokenResponse.status}`);
      console.error(`Raw Error Body: ${rawTokenText.substring(0, 1000)}...`); 
      throw new Error(`Token request failed: ${tokenResponse.status}`);
    }

    let tokenData;
    try {
      tokenData = JSON.parse(rawTokenText);
    } catch (e) {
      // If we still get HTML here, it means the site returned a 200 OK but with an HTML captcha/block page
      console.error(`CRITICAL: Expected JSON but got HTML. Raw Body:\n${rawTokenText.substring(0, 500)}`);
      throw new Error("Target API returned HTML instead of JSON. You are likely being blocked by a WAF.");
    }

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
      'browser': 'true', 
      'proxy_type': 'residential',
      'proxy_country': 'gb'
    });

    const saPricesUrl = `${saBaseUrl}?${pricesParams.toString()}`;

    const pricesResponse = await fetch(saPricesUrl, {
      method: 'GET',
      headers: {
        'Ant-Authorization': `Bearer ${accessToken}`,
        'Ant-Accept': 'application/json', // Ensure we ask for JSON here too
        'Ant-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const rawPricesText = await pricesResponse.text();

    if (!pricesResponse.ok) {
      console.error(`Prices Request Failed: ${pricesResponse.status}`);
      console.error(`Raw Body: ${rawPricesText.substring(0, 500)}`);
      throw new Error(`Prices request failed.`);
    }

    let pricesData;
    try {
      pricesData = JSON.parse(rawPricesText);
    } catch (e) {
      console.error(`CRITICAL: Prices response was not JSON. Raw Body:\n${rawPricesText.substring(0, 500)}`);
      throw new Error("Prices endpoint returned HTML. WAF Block likely.");
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
      throw new Error(`Cloudflare KV upload failed: ${cfResponse.status} - ${errorText}`);
    }

    console.log("Upload successful!");

  } catch (error) {
    console.error("Error in sync process:", error.message);
    process.exit(1);
  }
}

run();
