/** A look at the isometric map, drawn from the real campaign. */
import { newCampaign, endTurn } from './core/campaign';
import { factionId } from './core/types';
import { createCamera } from './render/projection';
import { loadGround } from './render/iso/elevation';
import { drawGround } from './render/iso/terrain';
import { isoTransform } from './render/iso/view';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLElement;

const SCALE = Number(params.get('scale') ?? 3);
const vw = document.documentElement.clientWidth;
const vh = document.documentElement.clientHeight;
const W = Math.floor(vw / SCALE);
const H = Math.floor(vh / SCALE);
canvas.width = W;
canvas.height = H;
canvas.style.width = `${W * SCALE}px`;
canvas.style.height = `${H * SCALE}px`;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const state = newCampaign({ seed: 'iso', player: factionId(params.get('faction') ?? 'croatia') });
const turns = Number(params.get('turns') ?? 0);
for (let turn = 0; turn < turns; turn++) endTurn(state);

const camera = createCamera();
camera.centreLon = Number(params.get('lon') ?? 14);
camera.centreLat = Number(params.get('lat') ?? 45.5);
camera.zoom = Number(params.get('zoom') ?? 40);

void loadGround().then((ground) => {
  const started = performance.now();
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  const transform = isoTransform(camera, { width: vw, height: vh }, SCALE);
  const painted = drawGround(ctx, { state, ground, transform, width: W, height: H });
  const took = performance.now() - started;
  info.textContent =
    `${painted} tiles  tile ${(transform.halfWidth * 2).toFixed(1)}px  ` +
    `${transform.unitsPerTile} deg  step ${transform.stepPixels}px\n` +
    `camera ${camera.centreLon.toFixed(1)},${camera.centreLat.toFixed(1)} zoom ${camera.zoom}  ` +
    `picture ${W}x${H} at ${SCALE}x\n` +
    `drawn in ${took.toFixed(0)}ms`;
});
