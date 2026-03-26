const BASE = "https://hdr.rentalworks.cloud";
const PW = "&4^*D2aDy3uEi%VM";

async function run() {
  const authRes = await fetch(BASE + "/api/v1/jwt", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "XMLHttpRequest" },
    body: JSON.stringify({ UserName: "jd@avonrents.com", Password: PW })
  });
  const auth = await authRes.json();
  const token = auth.access_token;
  const h = { Authorization: "Bearer " + token, "x-requested-with": "XMLHttpRequest", "Content-Type": "application/json" };

  // Try various browse endpoints that might have I-code + description
  const endpoints = ["contractitem", "quoteitem", "salesinventory", "partsinventory", "partsitem", "partsorderitem"];
  for (const ep of endpoints) {
    console.log("=== " + ep + "/browse ===");
    try {
      const r = await fetch(BASE + "/api/v1/" + ep + "/browse", {
        method: "POST", headers: h,
        body: JSON.stringify({ miscfields:{}, module:"", options:{}, top:0, pageno:1, pagesize:3,
          searchfields:[], searchfieldoperators:[], searchfieldvalues:[],
          searchfieldtypes:[], searchseparators:[], searchcondition:[], uniqueids:{} })
      });
      console.log("Status:", r.status);
      if (r.status === 200) {
        const d = await r.json();
        const cols = Object.keys(d.ColumnIndex || {});
        const relevant = cols.filter(c => /code|desc|icode/i.test(c));
        console.log("Total:", d.TotalRows, "Relevant cols:", relevant.join(", "));
      }
    } catch(e) { console.log(e.message); }
  }

  // Also try the purchaseorderitem which might have ICode
  console.log("\n=== purchaseorderitem/browse ===");
  try {
    const r = await fetch(BASE + "/api/v1/purchaseorderitem/browse", {
      method: "POST", headers: h,
      body: JSON.stringify({ miscfields:{}, module:"", options:{}, top:0, pageno:1, pagesize:5,
        searchfields:["ICode"], searchfieldoperators:["="], searchfieldvalues:["100057"],
        searchfieldtypes:[""], searchseparators:[""], searchcondition:[""], uniqueids:{} })
    });
    console.log("Status:", r.status);
    if (r.status === 200) {
      const d = await r.json();
      const cols = Object.keys(d.ColumnIndex || {});
      console.log("Total:", d.TotalRows, "Cols:", cols.filter(c => /code|desc|icode/i.test(c)).join(", "));
      if (d.Rows && d.Rows[0]) {
        const ci = d.ColumnIndex;
        if (ci.ICode !== undefined) console.log("ICode:", d.Rows[0][ci.ICode]);
        if (ci.Description !== undefined) console.log("Description:", d.Rows[0][ci.Description]);
      }
    }
  } catch(e) { console.log(e.message); }
}
run();
