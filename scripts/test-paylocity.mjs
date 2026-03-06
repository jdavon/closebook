/**
 * Test script for Paylocity API connectivity
 * Run: node --env-file=.env.local scripts/test-paylocity.mjs
 */

const NG_CLIENT_ID = process.env.PAYLOCITY_NG_CLIENT_ID;
const NG_CLIENT_SECRET = process.env.PAYLOCITY_NG_CLIENT_SECRET;
const WL_CLIENT_ID = process.env.PAYLOCITY_WL_CLIENT_ID;
const WL_CLIENT_SECRET = process.env.PAYLOCITY_WL_CLIENT_SECRET;
const COMPANY_ID = process.env.PAYLOCITY_COMPANY_ID;

if (!NG_CLIENT_ID || !WL_CLIENT_ID) {
  console.error("Missing PAYLOCITY env vars. Run: node --env-file=.env.local scripts/test-paylocity.mjs");
  process.exit(1);
}

async function getToken(url, clientId, clientSecret, scope) {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  if (scope) body.set("scope", scope);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`Auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  console.log("=== NextGen API Auth ===");
  const ngToken = await getToken("https://dc1prodgwext.paylocity.com/public/security/v1/token", NG_CLIENT_ID, NG_CLIENT_SECRET);
  console.log("NextGen token obtained");

  console.log("\n=== Cost Center Structure ===");
  const ccRes = await fetch(`https://dc1prodgwext.paylocity.com/apiHub/corehr/v1/companies/${COMPANY_ID}/costCentersAndLevels`, {
    headers: { Authorization: `Bearer ${ngToken}` },
  });
  const ccData = await ccRes.json();
  for (const level of ccData) {
    console.log(`\nLevel ${level.level} - ${level.description}`);
    for (const cc of level.costCenters) {
      console.log(`  ${cc.code} - ${cc.name}${cc.isActive ? "" : " (INACTIVE)"}`);
    }
  }

  console.log("\n=== All Active Employees ===");
  const allEmployees = [];
  let nextToken = undefined;
  do {
    const params = new URLSearchParams({ include: "info,position,payrate", limit: "20", activeOnly: "true" });
    if (nextToken) params.set("nextToken", nextToken);
    const empRes = await fetch(`https://dc1prodgwext.paylocity.com/coreHr/v1/companies/${COMPANY_ID}/employees?${params}`, {
      headers: { Authorization: `Bearer ${ngToken}` },
    });
    const empData = await empRes.json();
    allEmployees.push(...(empData.employees || []));
    nextToken = empData.nextToken;
  } while (nextToken);

  console.log(`Total active employees: ${allEmployees.length}`);

  const byDept = {};
  for (const e of allEmployees) {
    const dept = e.position?.costCenter1 || "Unknown";
    if (!byDept[dept]) byDept[dept] = [];
    byDept[dept].push({
      id: e.id,
      name: `${e.info?.firstName || ""} ${e.info?.lastName || e.lastName || ""}`.trim(),
      jobTitle: e.info?.jobTitle || "",
      payType: e.currentPayRate?.payType || "",
      annualSalary: e.currentPayRate?.annualSalary || 0,
      baseRate: e.currentPayRate?.baseRate || 0,
    });
  }

  let totalAnnualPayroll = 0;
  for (const [dept, emps] of Object.entries(byDept)) {
    let deptTotal = 0;
    console.log(`\n${dept} (${emps.length} employees):`);
    for (const e of emps) {
      const annual = e.annualSalary || (e.baseRate * 2080);
      deptTotal += annual;
      console.log(`  ${String(e.id).padEnd(6)} ${e.name.padEnd(25)} ${e.jobTitle.padEnd(30)} ${e.payType.padEnd(8)} $${annual.toLocaleString()}`);
    }
    console.log(`  Department Total: $${deptTotal.toLocaleString()}`);
    totalAnnualPayroll += deptTotal;
  }
  console.log(`\nTotal Annual Payroll: $${totalAnnualPayroll.toLocaleString()}`);
  console.log(`Estimated Monthly Payroll: $${(totalAnnualPayroll / 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  console.log("\n=== WebLink API Auth ===");
  const wlToken = await getToken("https://api.paylocity.com/IdentityServer/connect/token", WL_CLIENT_ID, WL_CLIENT_SECRET, "WebLinkAPI");
  console.log("WebLink token obtained");

  const firstEmpId = allEmployees.find(e => e.position?.costCenter1)?.id;
  if (firstEmpId) {
    console.log(`\n=== Pay Statements for Employee ${firstEmpId} (2026) ===`);
    const payRes = await fetch(`https://api.paylocity.com/api/v2/companies/${COMPANY_ID}/employees/${firstEmpId}/paystatement/summary/2026?pagesize=10&pagenumber=0`, {
      headers: { Authorization: `Bearer ${wlToken}` },
    });
    console.log(`Status: ${payRes.status}`);
    if (payRes.ok) {
      const payData = await payRes.json();
      console.log(`Pay statements found: ${Array.isArray(payData) ? payData.length : "N/A"}`);
      if (Array.isArray(payData)) {
        for (const ps of payData.slice(0, 5)) {
          console.log(`  Check: ${ps.checkDate} | Gross: $${ps.grossPay} | Net: $${ps.netPay} | Hrs: ${ps.hours}`);
        }
      }
    } else {
      console.log(`Error: ${await payRes.text()}`);
    }
  }
}

main().catch(console.error);
