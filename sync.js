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

    // FIX 1: Removed 'www.' from the URL. 
    // If this fails, try 'api.fuel-finder.service.gov.uk' instead.
    const tokenTargetUrl = 'https://service.gov.uk';
    const saBaseUrl = 'https://scrapingant.com';

    // FIX 2: Configs in Query String, browser=false (Pure API mode)
    const tokenParams = new URLSearchParams({
      'x-api-key': SCRAPINGANT_API_KEY,
      'url': tokenTargetUrl,
      'proxy_type': 'residential', 
      'proxy_country': 'gb',
      'browser': 'false' // Do not render HTML; we want raw JSON response
    });

    const tokenResponse = await fetch(`${saBaseUrl}?${tokenParams.toString()}`, {
      method: 'POST',
      headers: {
        'Ant-Content-Type': 'application/json', // Pass JSON body through proxy
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GOV_CLIENT_ID,
        client_secret: process.env.GOV_CLIENT_SECRET
      })
    });

    // Debugging: If it fails, print the TEXT (not JSON) to see if it's HTML
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
      console.error("CRITICAL: Received HTML instead of JSON. The URL might be wrong.");
      console.error(`Snippet: ${rawTokenText.substring(0, 200)}`);
      throw new Error("Invalid JSON response.");
    }

    const accessToken = tokenData.access_token;
    console.log("Access token obtained successfully.");

    // ---------------------------------------------------------
    // 2. Fetch Fuel Prices
    // ---------------------------------------------------------
    console.log("Fetching fuel prices...");
    
    // FIX 3: Removed 'www.' from prices URL as well
    const pricesTargetUrl = 'https://service.gov.uk';
    
    const pricesParams = new URLSearchParams({
      'url': pricesTargetUrl,
      'x-api-key': SCRAPINGANT_API_KEY,
      'browser': 'false',
      'proxy_type': 'residential',
      'proxy_country': 'gb'
    });

    const pricesResponse = await fetch(`${saBaseUrl}?${pricesParams.toString()}`, {
      method: 'GET',
      headers: {
        'Ant-Authorization': `Bearer ${accessToken}`,
        'Ant-Accept': 'application/json'
      }
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
      throw new Error(`Cloudflare Upload Failed: ${cfResponse.status}`);
    }

    console.log("Upload successful!");

  } catch (error) {
    console.error("Error in sync process:", error.message);
    process.exit(1);
  }
}

run();
