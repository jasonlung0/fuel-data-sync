async function run() {
  try {
    const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY;
    
    // Safety Validation: Prevent execution if GitHub Action Secrets aren't loading
    if (!SCRAPINGANT_API_KEY || SCRAPINGANT_API_KEY.trim() === "") {
      throw new Error("CRITICAL: SCRAPINGANT_API_KEY is undefined or empty. Check your GitHub Secrets configuration.");
    }
    if (!process.env.GOV_CLIENT_ID || !process.env.GOV_CLIENT_SECRET) {
      throw new Error("CRITICAL: GOV_CLIENT_ID or GOV_CLIENT_SECRET is missing from the environment variables.");
    }

    // ---------------------------------------------------------
    // 1. Get the OAuth Access Token via ScrapingAnt Proxy
    // ---------------------------------------------------------
    console.log("Requesting access token...");
    const tokenTargetUrl = 'https://service.gov.uk';
    
    // Base URL is strictly hardcoded with no variables to avoid domain corruption
    const saBaseUrl = 'https://scrapingant.com';

    // Construct clean URL search parameters cleanly away from the domain string
    const tokenParams = new URLSearchParams({
      'x-api-key': SCRAPINGANT_API_KEY
    });

    let tokenResponse;
    try {
      tokenResponse = await fetch(`${saBaseUrl}?${tokenParams.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ant-Content-Type': 'application/json',
          'Ant-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          url: tokenTargetUrl,
          method: 'POST',
          browser: true,
          proxy_type: 'residential',
          proxy_country: 'gb',
          data: JSON.stringify({
            client_id: process.env.GOV_CLIENT_ID,
            client_secret: process.env.GOV_CLIENT_SECRET
          })
        })
      });
    } catch (networkError) {
      console.error("Network Error Details:", networkError.cause || networkError);
      throw new Error(`Connection to ScrapingAnt endpoint failed completely: ${networkError.message}`);
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token request failed with status ${tokenResponse.status}: ${errorText.substring(0, 500)}`);
    }

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
    
    const pricesParams = new URLSearchParams({
      'url': pricesTargetUrl,
      'x-api-key': SCRAPINGANT_API_KEY,
      'browser': 'true',
      'proxy_type': 'residential',
      'proxy_country': 'gb'
    });

    let pricesResponse;
    try {
      pricesResponse = await fetch(`${saBaseUrl}?${pricesParams.toString()}`, {
        method: 'GET',
        headers: {
          'Ant-Authorization': 'Bearer ' + accessToken,
          'Ant-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
    } catch (networkError) {
      console.error("Prices Network Error Details:", networkError.cause || networkError);
      throw new Error(`Connection to ScrapingAnt during data extraction failed: ${networkError.message}`);
    }

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
    const cfUrl = 'https://cloudflare.com' + process.env.CF_ACCOUNT_ID + '/storage/kv/namespaces/' + process.env.CF_NAMESPACE_ID + '/values/latest_fuel_data';

    let cfResponse;
    try {
      cfResponse = await fetch(cfUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + process.env.CF_API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(pricesData)
      });
    } catch (networkError) {
      console.error("Cloudflare Network Error Details:", networkError.cause || networkError);
      throw new Error(`Connection to Cloudflare API failed: ${networkError.message}`);
    }

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
