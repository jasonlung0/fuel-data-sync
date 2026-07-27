async function run() {
  try {
    const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY;

    // Safety Checks
    if (!SCRAPINGANT_API_KEY) throw new Error("Missing SCRAPINGANT_API_KEY");
    if (!process.env.GOV_CLIENT_ID || !process.env.GOV_CLIENT_SECRET) {
      throw new Error("Missing GOV_CLIENT_ID or GOV_CLIENT_SECRET");
    }

    // ---------------------------------------------------------
    // 1. Get the OAuth Access Token
    // ---------------------------------------------------------
    console.log("Requesting access token...");

    // CONFIGURATION:
    // 1. Target URL MUST include 'www'.
    // 2. We use 'browser: false' to avoid the "Welcome" page redirect.
    const tokenTargetUrl = 'https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token';
    
    // We construct the payload here to pass it into the 'data' query parameter
    const authPayload = JSON.stringify({
      client_id: process.env.GOV_CLIENT_ID,
      client_secret: process.env.GOV_CLIENT_SECRET
    });

    const tokenParams = new URLSearchParams({
      'x-api-key': SCRAPINGANT_API_KEY,
      'url': tokenTargetUrl,
      'method': 'POST',            // Tell ScrapingAnt to POST to the target
      'data': authPayload,         // The body to send
      'header_Content-Type': 'application/json', // Target header
      'header_Accept': 'application/json',       // Target header
      'proxy_type': 'residential', 
      'proxy_country': 'gb',
      'browser': 'false' 
    });

    // IMPORTANT: We send a GET request to ScrapingAnt. 
    // ScrapingAnt reads the params and performs the POST for us.
    const tokenResponse = await fetch(`https://scrapingant.com{tokenParams.toString()}`, {
      method: 'GET' 
    });

    const rawTokenText = await tokenResponse.text();

    if (!tokenResponse.ok) {
      console.error(`Token Request Failed: ${tokenResponse.status}`);
      console.error(`Response Body: ${rawTokenText.substring(0, 500)}`);
      throw new Error(`Token request failed.`);
    }

    let tokenData;
    try {
      tokenData = JSON.parse(rawTokenText);
    } catch (e) {
      console.error("CRITICAL: Received HTML instead of JSON.");
      console.error(`Snippet: ${rawTokenText.substring(0, 200)}`);
      throw new Error("Invalid JSON response.");
    }

    const accessToken = tokenData.access_token;
    console.log("Access token obtained successfully.");

    // ---------------------------------------------------------
    // 2. Fetch Fuel Prices
    // ---------------------------------------------------------
    console.log("Fetching fuel prices...");
    
    const pricesTargetUrl = 'https://service.gov.uk';
    
    const pricesParams = new URLSearchParams({
      'url': pricesTargetUrl,
      'x-api-key': SCRAPINGANT_API_KEY,
      'method': 'GET',
      'header_Authorization': `Bearer ${accessToken}`, // Pass token via header param
      'header_Accept': 'application/json',
      'proxy_type': 'residential',
      'proxy_country': 'gb',
      'browser': 'false'
    });

    const pricesResponse = await fetch(`https://scrapingant.com{pricesParams.toString()}`, {
      method: 'GET'
    });

    const rawPricesText = await pricesResponse.text();

    if (!pricesResponse.ok) {
      console.error(`Prices Request Failed: ${pricesResponse.status}`);
      console.error(`Response Body: ${rawPricesText.substring(0, 500)}`);
      throw new Error("Prices request failed.");
    }

    const pricesData = JSON.parse(rawPricesText);
    console.log(`Fetched fuel data successfully.`);

    // ---------------------------------------------------------
    // 3. Upload to Cloudflare KV
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
      throw new Error(`Cloudflare Upload Failed: ${cfResponse.status} - ${errorText}`);
    }

    console.log("Upload successful!");

  } catch (error) {
    console.error("Error in sync process:", error.message);
    process.exit(1);
  }
}

run();
