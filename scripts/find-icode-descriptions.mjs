const BASE = "https://hdr.rentalworks.cloud";

async function run() {
  const authRes = await fetch(BASE + "/api/v1/jwt", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "XMLHttpRequest" },
    body: JSON.stringify({ UserName: "jd@avonrents.com", Password: "&4^*D2aDy3uEi%VM" })
  });
  const auth = await authRes.json();
  const token = auth.access_token;
  const headers = { Authorization: "Bearer " + token, "x-requested-with": "XMLHttpRequest", "Content-Type": "application/json" };

  // Get recent invoices
  const invRes = await fetch(BASE + "/api/v1/invoice/browse", {
    method: "POST", headers,
    body: JSON.stringify({ miscfields:{}, module:"", options:{}, top:0, pageno:1, pagesize:50,
      orderby:"InvoiceDate", orderbydirection:"desc",
      searchfields:[], searchfieldoperators:[], searchfieldvalues:[],
      searchfieldtypes:[], searchseparators:[], searchcondition:[] })
  });
  const invData = await invRes.json();
  const ci = invData.ColumnIndex;
  console.log("Total invoices:", invData.TotalRows, "Fetched:", invData.Rows.length);

  const missingCodes = new Set(["100057","100306","101207","100986","101337"]);
  const found = {};

  for (let i = 0; i < invData.Rows.length; i++) {
    const row = invData.Rows[i];
    const invId = row[ci.InvoiceId];
    const itemRes = await fetch(BASE + "/api/v1/invoiceitem/browse", {
      method: "POST", headers,
      body: JSON.stringify({ miscfields:{}, module:"", options:{}, top:0, pageno:1, pagesize:500,
        searchfields:[], searchfieldoperators:[], searchfieldvalues:[],
        searchfieldtypes:[], searchseparators:[], searchcondition:[],
        uniqueids: { InvoiceId: invId } })
    });
    const itemData = await itemRes.json();
    const ici = itemData.ColumnIndex;
    for (const item of (itemData.Rows || [])) {
      const code = (item[ici.ICode] || "").trim();
      if (missingCodes.has(code) && !(code in found)) {
        found[code] = item[ici.Description];
        console.log("Found", code, "->", item[ici.Description]);
      }
    }
    if (Object.keys(found).length === missingCodes.size) {
      console.log("All found!");
      break;
    }
    if (i % 10 === 9) console.log("Checked", i + 1, "invoices, found", Object.keys(found).length, "/", missingCodes.size);
  }
  console.log("\nResults:", JSON.stringify(found, null, 2));
  console.log("Still missing:", [...missingCodes].filter(c => !(c in found)));
}
run();
