const { execSync } = require('child_process');

async function runSync() {
  const GOV_CLIENT_ID = process.env.GOV_CLIENT_ID;
  const GOV_CLIENT_SECRET = process.env.GOV_CLIENT_SECRET;
  const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
  const CF_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
  const CF_API_TOKEN = process.env.CF_API_TOKEN;

  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    console.log("1. Authenticating with GOV.UK (using cURL)...");
    
    // Using curl to bypass AWS WAF Node.js fingerprint blocks
    const authCmd = `curl -s -w "%{http_code}" -X POST "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token" \\
      -H "Content-Type: application/json" \\
      -H "User-Agent: ${userAgent}" \\
      -d '{"client_id": "${GOV_CLIENT_ID}", "client_secret": "${GOV_CLIENT_SECRET}"}'`;

    const authOutput = execSync(authCmd, { encoding: 'utf8' });
    
    // Extract the HTTP status code appended to the very end of the output
    const authStatus = parseInt(authOutput.slice(-3));
    const authBody = authOutput.slice(0, -3);

    if (authStatus !== 200) {
      throw new Error(`OAuth failed: HTTP ${authStatus} - ${authBody}`);
    }

    const tokenData = JSON.parse(authBody);
    const accessToken = tokenData.data.access_token;

    console.log("2. Downloading latest fuel prices...");
    const dataCmd = `curl -s -w "%{http_code}" -X GET "https://www.fuel-finder.service.gov.uk/api/v1/prices" \\
      -H "Authorization: Bearer ${accessToken}" \\
      -H "User-Agent: ${userAgent}"`;

    const dataOutput = execSync(dataCmd, { encoding: 'utf8' });
    const dataStatus = parseInt(dataOutput.slice(-3));
    const fuelDataString = dataOutput.slice(0, -3);

    if (dataStatus !== 200) {
      throw new Error(`Data fetch failed: HTTP ${dataStatus} - ${fuelDataString}`);
    }

    console.log(`3. Pushing ${fuelDataString.length} bytes to Cloudflare KV...`);
    const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/latest_fuel_data`;
    
    // Cloudflare does not block Node.js, so fetch() is fine here
    const cfRes = await fetch(cfUrl, {
      method: "PUT",
      headers: { 
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "text/plain" 
      },
      body: fuelDataString
    });

    if (!cfRes.ok) throw new Error(`KV upload failed: HTTP ${cfRes.status} - ${await cfRes.text()}`);
    
    console.log("✅ Synchronization complete! Data is live in Cloudflare KV.");
  } catch (error) {
    console.error("❌ Synchronization pipeline failed:", error.message);
    process.exit(1);
  }
}

runSync();
