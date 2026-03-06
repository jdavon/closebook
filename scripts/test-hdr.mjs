/**
 * Test Paylocity API access for company 316791 (Hollywood Depot Rentals)
 * Run: node --env-file=.env.local scripts/test-hdr.mjs
 */

const NG_CLIENT_ID = process.env.PAYLOCITY_NG_CLIENT_ID;
const NG_CLIENT_SECRET = process.env.PAYLOCITY_NG_CLIENT_SECRET;
const HDR_COMPANY_ID = "316791";

if (!NG_CLIENT_ID) {
  console.error("Missing env vars. Run: node --env-file=.env.local scripts/test-hdr.mjs");
  process.exit(1);
}

async function getToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: NG_CLIENT_ID,
    client_secret: NG_CLIENT_SECRET,
  });
  const res = await fetch("https://dc1prodgwext.paylocity.com/public/security/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  console.log("=== Testing HDR (Company 316791) ===\n");

  const token = await getToken();
  console.log("NextGen auth OK\n");

  // Cost Centers
  console.log("--- Cost Centers ---");
  const ccRes = await fetch(
    `https://dc1prodgwext.paylocity.com/apiHub/corehr/v1/companies/${HDR_COMPANY_ID}/costCentersAndLevels`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log(`Status: ${ccRes.status}`);
  if (ccRes.ok) {
    const ccData = await ccRes.json();
    for (const level of ccData) {
      console.log(`\nLevel ${level.level} - ${level.description}`);
      for (const cc of level.costCenters) {
        console.log(`  ${cc.code} - ${cc.name}${cc.isActive ? "" : " (INACTIVE)"}`);
      }
    }
  } else {
    console.log(`Error: ${await ccRes.text()}`);
  }

  // Employees (first page)
  console.log("\n--- Active Employees (first 20) ---");
  const empRes = await fetch(
    `https://dc1prodgwext.paylocity.com/coreHr/v1/companies/${HDR_COMPANY_ID}/employees?include=info,position,payrate&limit=20&activeOnly=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log(`Status: ${empRes.status}`);
  if (empRes.ok) {
    const empData = await empRes.json();
    console.log(`Employees in page: ${empData.employees?.length ?? 0}`);
    if (empData.nextToken) console.log(`More pages available (nextToken present)`);

    let totalAnnual = 0;
    for (const e of empData.employees || []) {
      const annual = e.currentPayRate?.annualSalary || (e.currentPayRate?.baseRate || 0) * 2080;
      totalAnnual += annual;
      const cc = e.position?.costCenter1 || "N/A";
      const name = e.displayName || `${e.info?.firstName || ""} ${e.lastName || ""}`.trim();
      const title = e.info?.jobTitle || "";
      const payType = e.currentPayRate?.payType || "";
      console.log(`  ${String(e.id).padEnd(7)} ${name.padEnd(28)} CC:${cc.padEnd(6)} ${title.padEnd(30)} ${payType.padEnd(8)} $${annual.toLocaleString()}`);
    }
    console.log(`\nPage total annual: $${totalAnnual.toLocaleString()}`);

    // Paginate to count all
    let allCount = empData.employees?.length ?? 0;
    let nextToken = empData.nextToken;
    let grandTotal = totalAnnual;
    while (nextToken) {
      const params = new URLSearchParams({ include: "info,position,payrate", limit: "20", activeOnly: "true", nextToken });
      const pageRes = await fetch(
        `https://dc1prodgwext.paylocity.com/coreHr/v1/companies/${HDR_COMPANY_ID}/employees?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!pageRes.ok) break;
      const pageData = await pageRes.json();
      for (const e of pageData.employees || []) {
        const annual = e.currentPayRate?.annualSalary || (e.currentPayRate?.baseRate || 0) * 2080;
        grandTotal += annual;
        const name = e.displayName || `${e.info?.firstName || ""} ${e.lastName || ""}`.trim();
        const cc = e.position?.costCenter1 || "N/A";
        const title = e.info?.jobTitle || "";
        const payType = e.currentPayRate?.payType || "";
        console.log(`  ${String(e.id).padEnd(7)} ${name.padEnd(28)} CC:${cc.padEnd(6)} ${title.padEnd(30)} ${payType.padEnd(8)} $${annual.toLocaleString()}`);
      }
      allCount += pageData.employees?.length ?? 0;
      nextToken = pageData.nextToken;
    }
    console.log(`\nTotal active employees: ${allCount}`);
    console.log(`Total annual payroll: $${grandTotal.toLocaleString()}`);
    console.log(`Estimated monthly: $${(grandTotal / 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  } else {
    console.log(`Error: ${await empRes.text()}`);
  }

  // Also test WebLink for pay statements
  console.log("\n--- WebLink API (Pay Statements) ---");
  const wlBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.PAYLOCITY_WL_CLIENT_ID,
    client_secret: process.env.PAYLOCITY_WL_CLIENT_SECRET,
    scope: "WebLinkAPI",
  });
  const wlAuthRes = await fetch("https://api.paylocity.com/IdentityServer/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: wlBody,
  });
  if (!wlAuthRes.ok) {
    console.log(`WebLink auth failed: ${wlAuthRes.status}`);
    return;
  }
  const wlToken = (await wlAuthRes.json()).access_token;
  console.log("WebLink auth OK");

  // Try fetching a pay statement for a 316791 employee
  const payRes = await fetch(
    `https://api.paylocity.com/api/v2/companies/${HDR_COMPANY_ID}/employees/0/paystatement/summary/2026?pagesize=1&pagenumber=0`,
    { headers: { Authorization: `Bearer ${wlToken}` } }
  );
  console.log(`Pay statement test status: ${payRes.status}`);
  if (!payRes.ok) {
    console.log(`Response: ${await payRes.text()}`);
  }
}

main().catch(console.error);
