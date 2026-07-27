// Native Node.js script to fetch fuel data and push to Cloudflare KV
async function runSync() {
  const GOV_CLIENT_ID = process.env.GOV_CLIENT_ID;
  const GOV_CLIENT_SECRET = process.env.GOV_CLIENT_SECRET;
  const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
  const CF_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
  const CF_API_TOKEN = process.env.CF_API_TOKEN;

  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    console.log("1. Authenticating with GOV.UK...");
    const tokenRes = await fetch("https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": userAgent },
      body: JSON.stringify({ client_id: GOV_CLIENT_ID, client_secret: GOV_CLIENT_SECRET })
    });
    
    if (!tokenRes.ok) throw new Error(`OAuth failed: HTTP ${tokenRes.status} - ${await tokenRes.text()}`);
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.data.access_token;

    console.log("2. Downloading latest fuel prices...");
    const dataRes = await fetch("https://www.fuel-finder.service.gov.uk/api/v1/prices", {
      headers: { "Authorization": `Bearer ${accessToken}`, "User-Agent": userAgent }
    });
    
    if (!dataRes.ok) throw new Error(`Data fetch failed: HTTP ${dataRes.status} - ${await dataRes.text()}`);
    const fuelDataString = await dataRes.text(); // Extract as raw text

    console.log(`3. Pushing ${fuelDataString.length} bytes to Cloudflare KV...`);
    const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/latest_fuel_data`;
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
    process.exit(1); // Force GitHub Actions to mark the run as failed
  }
}

runSync();
