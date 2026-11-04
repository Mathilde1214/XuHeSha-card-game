// #64 Physics 的公式库（只放服务端，客户端拿不到答案）。
// 起步版约 40 条，按游戏设计师的提案（engine/PROPOSALS.md）补到 60 条左右即可，格式：一行一条，等号两边任写。
export const FORMULAS: string[] = [
  'v=s/t', 'a=Δv/t', 'v=v0+at', 's=v0t+1/2at^2', 'v^2-v0^2=2as', 'F=ma', 'G=mg', 'f=μN', 'p=mv', 'I=Ft',
  'W=Fs', 'P=W/t', 'P=Fv', 'Ek=1/2mv^2', 'Ep=mgh', 'W=1/2mv^2-1/2mv0^2', 'F=kx', 'ρ=m/V', 'p=F/S', 'p=ρgh',
  'F浮=ρgV排', 'F=Gm1m2/r^2', 'F=mv^2/r', 'a=v^2/r', 'ω=2π/T', 'v=ωr', 'T=2π√(l/g)', 'I=U/R', 'U=IR', 'P=UI',
  'Q=I^2Rt', 'W=UIt', 'R=ρl/S', 'F=kq1q2/r^2', 'E=F/q', 'U=Ed', 'C=Q/U', 'F=BIL', 'F=qvB', 'E=BLv',
  'Φ=BS', 'E=nΔΦ/Δt', 'v=λf', 'n=c/v', 'E=hν', 'E=mc^2', 'pV=nRT', 'Q=cmΔt', 'η=W有/W总', 'λ=h/p',
];

// 统一写法：去空格、小写、统一乘号/平方/除号，等号两边顺序无关
export function normalize(s: string): string {
  const t = s.toLowerCase().replace(/\s+/g, '').replace(/[×·*]/g, '').replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/÷/g, '/').replace(/（/g, '(').replace(/）/g, ')').replace(/½/g, '1/2').replace(/＝/g, '=');
  const sides = t.split('='); if (sides.length !== 2 || !sides[0] || !sides[1]) return '';
  return sides.sort().join('=');
}
const LIB = new Map(FORMULAS.map((f) => [normalize(f), f]));

/** 3 条都在库里且互不相同才算通过 */
export function checkFormulas(lines: string[]): { pass: boolean; matched: (string | null)[] } {
  const seen = new Set<string>();
  const matched = lines.slice(0, 3).map((l) => {
    const n = normalize(String(l ?? '')); const hit = LIB.get(n);
    if (!hit || seen.has(n)) return null; seen.add(n); return hit;
  });
  while (matched.length < 3) matched.push(null);
  return { pass: matched.every((m) => m !== null), matched };
}
