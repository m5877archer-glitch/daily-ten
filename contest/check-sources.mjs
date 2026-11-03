// Run by contest-deploy.yml after the keys are set: confirms the dashboard's
// outside sources answer. Prints only "ok" or the error for each, never the
// numbers, since the deploy log is public.
import { fromCloudflare, fromKit, fromFourthwall } from "./admin.js";
const now = new Date();
const show = async (name, p) => {
  try {
    const r = await p;
    console.log(name + ": " + (r && r.error ? "ERROR " + r.error : "ok (" + Object.keys(r).join(", ") + ")"));
  } catch (e) { console.log(name + ": ERROR " + String(e).slice(0, 300)); }
};
await show("Cloudflare", fromCloudflare(process.env.CF_API_TOKEN, now));
await show("Kit", fromKit(process.env.KIT_API_KEY, now));
await show("Fourthwall", fromFourthwall(process.env.FOURTHWALL_USER, process.env.FOURTHWALL_PASS, now));
