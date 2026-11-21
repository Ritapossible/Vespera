/**
 * Rate card from the weekend-gap dataset (docs/PRICING.md).
 *
 * Per (ticker, band [u, l]) as fractions of R:
 *   payoff(g)  = clamp(u - (1 + g), 0, u - l)                       per unit notional
 *   E_emp      = mean payoff over observed weekends
 *   E_model    = E[payoff] with g ~ Student-t(nu = 3) scaled to sd = sigma,
 *                sigma = max(sample sd, SIGMA_FLOOR). Fat tails on purpose: a normal model
 *                says a 3% weekend drop almost never happens, and history disagrees.
 *   premium    = max(FLOOR, LOAD * max(E_emp, E_model))
 *
 * The model term exists because the on-chain history is short (feeds went live in 2026) and
 * contains no tail weekend; the empirical term keeps us honest if the sample is worse than the
 * model. Both are published with every quote.
 *
 * Usage: npx tsx src/ratecard.ts [--bands 9700:8500,9900:9500] [--load 2] [--floor 10] [--sigma-floor 0.01]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DATA = arg("--data", join(__dirname, "../../../data/weekend-gaps.csv"));
const LOAD = Number(arg("--load", "2"));
const FLOOR_BPS = Number(arg("--floor", "10"));
const SIGMA_FLOOR = Number(arg("--sigma-floor", "0.01"));
const BANDS = arg("--bands", "9900:9500,9700:9000,9700:8500").split(",").map((b) => b.split(":").map(Number) as [number, number]);

export function payoff(gap: number, u: number, l: number) {
  return Math.min(Math.max(u - (1 + gap), 0), u - l);
}

const NU = 3;
// Student-t pdf with nu degrees of freedom (unit scale).
function tPdf(x: number, nu = NU) {
  const lg = (z: number) => { // log-gamma (Lanczos)
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = z, t = z + 5.5; t -= (z + 0.5) * Math.log(t); let ser = 1.000000000190015;
    for (const k of c) ser += k / ++y;
    return -t + Math.log((2.5066282746310005 * ser) / z);
  };
  return Math.exp(lg((nu + 1) / 2) - lg(nu / 2)) / Math.sqrt(nu * Math.PI) * Math.pow(1 + (x * x) / nu, -(nu + 1) / 2);
}

/** E[spread payoff] with gap = scale * T, T ~ t(nu), scale chosen so sd(gap) = sigma. */
export function modelE(u: number, l: number, sigma: number) {
  const scale = sigma * Math.sqrt((NU - 2) / NU);
  // integrate payoff(g) * density over g in [-1, 0] (payoff is 0 for g >= u - 1 >= 0 bound)
  const N = 20000; let acc = 0;
  for (let i = 0; i < N; i++) {
    const g = -1 + (i + 0.5) / N; // midpoint rule on [-1, 0]
    acc += payoff(g, u, l) * tPdf(g / scale) / scale;
  }
  return acc / N;
}

type Row = { ticker: string; gap: number };

function main() {
  const lines = readFileSync(DATA, "utf8").trim().split("\n");
  const head = lines[0].split(",");
  const rows: Row[] = lines.slice(1).map((l) => {
    const c = l.split(",");
    return { ticker: c[head.indexOf("ticker")], gap: Number(c[head.indexOf("gap")]) };
  });
  const tickers = [...new Set(rows.map((r) => r.ticker))];
  const out: any = { generatedAt: new Date().toISOString(), method: { LOAD, FLOOR_BPS, SIGMA_FLOOR }, source: DATA.split("/").slice(-2).join("/"), stocks: {} };

  console.log("ticker  n  sd%   band        hit%  E_emp_bps  E_model_bps  premium_bps");
  for (const t of tickers) {
    const g = rows.filter((r) => r.ticker === t).map((r) => r.gap);
    const n = g.length;
    const mean = g.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const sigma = Math.max(sd, SIGMA_FLOOR);
    const bands = BANDS.map(([ub, lb]) => {
      const u = ub / 1e4, l = lb / 1e4;
      const eEmp = g.reduce((a, x) => a + payoff(x, u, l), 0) / n;
      const eModel = modelE(u, l, sigma);
      const hits = g.filter((x) => payoff(x, u, l) > 0).length;
      const premiumBps = Math.ceil(Math.max(FLOOR_BPS, LOAD * Math.max(eEmp, eModel) * 1e4));
      console.log(`${t.padEnd(6)} ${n} ${(sd * 100).toFixed(2).padStart(5)}  ${ub}/${lb}  ${((hits / n) * 100).toFixed(0).padStart(4)}  ${(eEmp * 1e4).toFixed(1).padStart(9)}  ${(eModel * 1e4).toFixed(1).padStart(11)}  ${String(premiumBps).padStart(11)}`);
      return { upperBps: ub, lowerBps: lb, premiumBps, stats: { n, hits, sampleSd: sd, sigmaUsed: sigma, eEmpBps: eEmp * 1e4, eModelBps: eModel * 1e4 } };
    });
    out.stocks[t] = bands;
  }
  const dest = join(__dirname, "../../../data/ratecard.json");
  writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${dest}`);
}

if (require.main === module) main();
