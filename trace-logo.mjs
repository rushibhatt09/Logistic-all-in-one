// trace-logo.mjs — Runs once to generate dermatouch-logo.svg with skeleton paths
// Usage: node trace-logo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import pako from 'pako';

// ── PNG Decoder ──────────────────────────────────────────────────────────────
function parsePNG(buf) {
  let offset = 8; // skip signature
  let width, height, colorType;
  const idatChunks = [];

  while (offset < buf.length) {
    const len  = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('ascii');
    const data = buf.slice(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idatChunks.push(data);
    else if (type === 'IEND') break;
  }

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = pako.inflate(Buffer.concat(idatChunks));
  const stride = width * bpp + 1;
  const pixels = new Uint8Array(width * height * 4);

  function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
    return pa<=pb&&pa<=pc ? a : pb<=pc ? b : c;
  }

  const recon = new Uint8Array(width * bpp);
  for (let y = 0; y < height; y++) {
    const f   = raw[y * stride];
    const row = raw.slice(y * stride + 1, (y+1)*stride);
    // pr = reconstructed previous row (not raw!) — FIX for filters 2,3,4
    const pr  = y > 0 ? recon.slice() : new Uint8Array(width*bpp);
    const cur = new Uint8Array(row.length);
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? cur[i-bpp]   : 0;   // left (reconstructed, current row)
      const b = pr[i]  || 0;                     // above (reconstructed previous row)
      const c = i >= bpp ? (pr[i-bpp] || 0) : 0; // upper-left
      cur[i] = (f===0 ? row[i] : f===1 ? row[i]+a : f===2 ? row[i]+b :
                f===3 ? row[i]+Math.floor((a+b)/2) : row[i]+paeth(a,b,c)) & 0xff;
    }
    recon.set(cur);
    for (let x = 0; x < width; x++) {
      const di = (y*width+x)*4;
      if (colorType===2)  { pixels[di]=cur[x*3]; pixels[di+1]=cur[x*3+1]; pixels[di+2]=cur[x*3+2]; pixels[di+3]=255; }
      else if (colorType===6) { pixels[di]=cur[x*4]; pixels[di+1]=cur[x*4+1]; pixels[di+2]=cur[x*4+2]; pixels[di+3]=cur[x*4+3]; }
      else { pixels[di]=cur[x]; pixels[di+1]=cur[x]; pixels[di+2]=cur[x]; pixels[di+3]=255; }
    }
  }
  return { width, height, pixels };
}

// ── Zhang-Suen Thinning ──────────────────────────────────────────────────────
function zhangSuen(bin, W, H) {
  const g = new Uint8Array(bin);
  function nb(x,y){
    return [g[(y-1)*W+x],g[(y-1)*W+x+1],g[y*W+x+1],g[(y+1)*W+x+1],
            g[(y+1)*W+x],g[(y+1)*W+x-1],g[y*W+x-1],g[(y-1)*W+x-1]];
  }
  function B(ns){ return ns.reduce((s,v)=>s+v,0); }
  function A(ns){ let c=0; for(let i=0;i<8;i++) if(ns[i]===0&&ns[(i+1)%8]===1)c++; return c; }
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const del = new Uint8Array(W*H);
      for (let y=1; y<H-1; y++) for (let x=1; x<W-1; x++) {
        if (!g[y*W+x]) continue;
        const ns=nb(x,y), b=B(ns), a=A(ns);
        if (b<2||b>6||a!==1) continue;
        if (pass===0){ if(ns[0]*ns[2]*ns[4]!==0) continue; if(ns[2]*ns[4]*ns[6]!==0) continue; }
        else         { if(ns[0]*ns[2]*ns[6]!==0) continue; if(ns[0]*ns[4]*ns[6]!==0) continue; }
        del[y*W+x]=1; changed=true;
      }
      for (let i=0; i<W*H; i++) if(del[i]) g[i]=0;
    }
  }
  return g;
}

// ── Path Tracing ─────────────────────────────────────────────────────────────
function tracePaths(skel, W, H) {
  function nb8(x,y){
    const r=[];
    for(const [dx,dy] of [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]]){
      const nx=x+dx,ny=y+dy;
      if(nx>=0&&nx<W&&ny>=0&&ny<H&&skel[ny*W+nx]) r.push([nx,ny]);
    }
    return r;
  }
  const visited = new Uint8Array(W*H);
  const paths = [];

  for (let pass = 0; pass < 2; pass++) {
    for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
      if (!skel[y*W+x]||visited[y*W+x]) continue;
      const nbs = nb8(x,y);
      if (pass===0 && nbs.length > 2) continue; // endpoints first
      const path=[];
      let cx=x, cy=y, prevX=-1, prevY=-1;
      while (true) {
        visited[cy*W+cx]=1; path.push([cx,cy]);
        const ns = nb8(cx,cy).filter(([nx,ny])=>!visited[ny*W+nx]);
        if (!ns.length) break;
        const dx=cx-prevX, dy=cy-prevY;
        ns.sort(([ax,ay],[bx,by])=>{
          const da=Math.abs((ax-cx)-dx)+Math.abs((ay-cy)-dy);
          const db=Math.abs((bx-cx)-dx)+Math.abs((by-cy)-dy);
          return da-db;
        });
        prevX=cx; prevY=cy; [cx,cy]=ns[0];
      }
      if (path.length>=2) paths.push(path);
    }
  }
  return paths;
}

// ── Douglas-Peucker ──────────────────────────────────────────────────────────
function dp(pts, eps) {
  if (pts.length<=2) return pts;
  const [x1,y1]=pts[0],[xn,yn]=pts[pts.length-1];
  let maxD=0,maxI=0;
  for (let i=1;i<pts.length-1;i++) {
    const [px,py]=pts[i], dx=xn-x1, dy=yn-y1, len=Math.sqrt(dx*dx+dy*dy)||1;
    const d=Math.abs(dy*px-dx*py+xn*y1-yn*x1)/len;
    if(d>maxD){maxD=d;maxI=i;}
  }
  if(maxD>eps){ const l=dp(pts.slice(0,maxI+1),eps); const r=dp(pts.slice(maxI),eps); return [...l.slice(0,-1),...r]; }
  return [pts[0],pts[pts.length-1]];
}

// ── Main ─────────────────────────────────────────────────────────────────────
const buf = readFileSync('./public/dermatouch-logo-hires.png');
const { width: W, height: H, pixels } = parsePNG(buf);
console.log(`Decoded PNG: ${W}×${H}`);

// Build binary mask
const bin = new Uint8Array(W*H);
for (let i=0;i<W*H;i++) {
  const r=pixels[i*4],g=pixels[i*4+1],b=pixels[i*4+2],a=pixels[i*4+3];
  if (a>100 && (r+g+b)/3<100) bin[i]=1;
}

// Thin
const skel = zhangSuen(bin, W, H);
const skelCount = skel.reduce((s,v)=>s+v,0);
console.log(`Skeleton: ${skelCount} pixels`);

// Trace paths
const rawPaths = tracePaths(skel, W, H);
console.log(`Raw paths: ${rawPaths.length}`);

// Simplify + filter
const simplified = rawPaths
  .filter(p=>p.length>=5)       // drop tiny noise fragments
  .map(p=>dp(p,0.8))            // slightly looser simplification = smoother curves
  .filter(p=>p.length>=2);
console.log(`Simplified paths: ${simplified.length}`);

// Sort: icon (y<=136) first, then text sorted by leftmost x
const ICON_BOTTOM = 136;
const iconPaths = simplified.filter(p=>p.some(([,y])=>y<=ICON_BOTTOM));
const textPaths = simplified.filter(p=>p.every(([,y])=>y>ICON_BOTTOM));

// Sort text paths left-to-right by their leftmost x
textPaths.sort((a,b)=>Math.min(...a.map(([x])=>x)) - Math.min(...b.map(([x])=>x)));

// Build SVG
const SW = 11; // stroke-width matching original logo stroke thickness
const allPaths = [...iconPaths, ...textPaths];

const pathEls = allPaths.map((pts, i) => {
  const isIcon = pts.some(([,y])=>y<=ICON_BOTTOM);
  const d = 'M'+pts.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join('L');
  return `  <path d="${d}" class="dt-stroke ${isIcon?'dt-icon':'dt-text'}"/>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round" id="dtLogoSVG">\n${pathEls}\n</svg>`;

writeFileSync('./public/dermatouch-logo.svg', svg, 'utf8');
console.log(`Saved dermatouch-logo.svg (${svg.length} chars, ${allPaths.length} paths)`);
