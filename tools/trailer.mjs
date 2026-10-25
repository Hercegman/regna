#!/usr/bin/env node
/**
 * Records a trailer out of the game actually running.
 *
 *     npm run dev            # in one terminal
 *     node tools/trailer.mjs # in another
 *
 * Nothing here is faked or re-enacted. Every shot is the game opened at a
 * known state through the development URLs the README lists, left to run by
 * itself, and photographed sixty times a second through the browser's own
 * screencast. The campaign shots are driven by dispatching the mouse events
 * a person would have made — a drag across Europe, a turn of the wheel —
 * rather than by reaching inside the renderer, so what comes out is a
 * recording of the game and not of a script pretending to be one.
 *
 * Shots are cut together with ffmpeg at the end. The frame rate is measured
 * rather than assumed: the browser sends a frame when it has painted one,
 * and a battle under load paints fewer than a map sitting still.
 *
 * A development tool. It is not part of the game and nothing imports it.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOST = process.env.REGNA_HOST ?? 'http://localhost:5173';
const OUT = process.env.REGNA_TRAILER ?? path.join(process.cwd(), 'trailer.mp4');
const WORK = path.join(os.tmpdir(), 'regna-trailer');
const PORT = 9333;
const WIDTH = 1280;
const HEIGHT = 720;

/** How long the browser is given to reach the state before recording starts. */
const SETTLE = 2600;

// ---------------------------------------------------------------------------
// The storyboard
// ---------------------------------------------------------------------------

/**
 * Each shot is a URL the game understands and a few seconds of it running.
 *
 * `drive` is handed the page and the number of seconds the shot lasts, and
 * may dispatch input while the recording runs. It is the only way the
 * campaign map moves: the battle runs itself.
 */
const SHOTS = [
  {
    name: 'menu',
    url: '/',
    seconds: 3.4,
    still: true,
  },
  {
    // The continent, held. A map of Europe with seventy-three frontiers on
    // it is worth three seconds of standing still, and standing still is
    // also what it is best at: see `edgePan` for why it is not panned here.
    name: 'europe',
    url: '/?faction=croatia&look=knin&zoom=26',
    seconds: 3.8,
    still: true,
  },
  {
    // Close enough that the map redraws quickly, running east over the
    // Adriatic: towns, frontiers, trade roads and the swell on the water.
    name: 'closer',
    url: '/?faction=venice&turns=60&look=venice&zoom=52',
    seconds: 4.4,
    settle: 9000,
    drive: (page, seconds) => edgePan(page, { x: 1, y: 1 }, seconds),
  },
  {
    name: 'province',
    url: '/?faction=venice&turns=60&tab=build',
    seconds: 3.4,
    settle: 9000,
    still: true,
  },
  {
    name: 'lines',
    url: '/?demo=battle&play=1&weather=clear&hour=day&at=150&bzoom=4',
    seconds: 7,
  },
  {
    name: 'contact',
    url: '/?demo=battle&play=1&weather=clear&hour=day&at=430&bzoom=9&blook=700,470',
    seconds: 7.5,
  },
  {
    name: 'horse',
    url: '/?demo=battle&play=1&weather=clear&hour=day&at=330&bzoom=7&blook=760,560',
    seconds: 6,
  },
  {
    name: 'assault',
    url: '/?demo=siege&play=1&at=330&bzoom=5&blook=700,260',
    seconds: 7,
  },
  {
    name: 'sea',
    url: '/?demo=sea&play=1&weather=clear&hour=day&at=30',
    seconds: 7,
  },
  {
    name: 'snow',
    url: '/?demo=battle&play=1&weather=snow&hour=dusk&at=220&bzoom=6',
    seconds: 5.5,
  },
];

// ---------------------------------------------------------------------------
// Talking to the browser
// ---------------------------------------------------------------------------

/** A page of a headless browser, spoken to over the devtools protocol. */
class Page {
  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.waiting = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (!pending) return;
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const handler = this.listeners.get(message.method);
      if (handler) handler(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }

  on(method, handler) {
    this.listeners.set(method, handler);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openBrowser() {
  const profile = path.join(WORK, 'profile');
  await mkdir(profile, { recursive: true });
  const child = spawn('chromium', [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-gpu',
    '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { stdio: 'ignore' });

  for (let tries = 0; tries < 80; tries++) {
    await wait(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const target = list.find((entry) => entry.type === 'page');
      if (target?.webSocketDebuggerUrl) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true });
          socket.addEventListener('error', reject, { once: true });
        });
        return { child, page: new Page(socket) };
      }
    } catch {
      // Not up yet.
    }
  }
  throw new Error('chromium never came up on the debugging port');
}

// ---------------------------------------------------------------------------
// Driving it
// ---------------------------------------------------------------------------

/**
 * One mouse event, posted and not waited for.
 *
 * Waiting on the reply costs a round trip to the browser and back, and a
 * drag is two hundred of them: the first cut of this spent forty seconds
 * recording a six-second pan, and the map only repainted as fast as the
 * replies came. The events are ordered on the socket anyway, so the only
 * thing the wait bought was the latency.
 */
const mouse = (page, type, x, y, extra = {}) => {
  void page.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'none', buttons: 0, clickCount: 0, ...extra,
  }).catch(() => undefined);
};

/**
 * The map's own edge pan, started and then left alone.
 *
 * A drag has to be fed a mouse event for every frame it is to draw, and the
 * campaign map takes a sixth of a second to redraw a continent — so a drag
 * at thirty events a second piles up a queue the main thread never gets out
 * of, and the compositor finds a moment to publish a frame about twice a
 * second. The edge pan is the game's own loop: one mouse event puts the
 * pointer in the margin, and from there it pans and redraws inside
 * `requestAnimationFrame` at whatever rate it can manage, with the gaps
 * between frames that a compositor needs to get a picture out.
 *
 * Which corner it runs towards is the sign of the two offsets.
 */
async function edgePan(page, towards, seconds) {
  const margin = 12;
  const x = towards.x < 0 ? margin : towards.x > 0 ? WIDTH - margin : WIDTH / 2;
  const y = towards.y < 0 ? margin : towards.y > 0 ? HEIGHT - margin : HEIGHT / 2;
  mouse(page, 'mouseMoved', x, y);
  await wait(seconds * 1000);
  // Back to the middle, or it would still be panning when the next shot is
  // set up on the same page.
  mouse(page, 'mouseMoved', WIDTH / 2, HEIGHT / 2);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

async function record(page, shot, into) {
  await mkdir(into, { recursive: true });
  await page.send('Page.navigate', { url: `${HOST}${shot.url}` });
  await wait(shot.settle ?? SETTLE);

  let count = 0;
  const started = Date.now();
  page.on('Page.screencastFrame', (params) => {
    const file = path.join(into, `f${String(++count).padStart(5, '0')}.jpg`);
    void writeFile(file, Buffer.from(params.data, 'base64'));
    void page.send('Page.screencastFrameAck', { sessionId: params.sessionId });
  });

  await page.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
    everyNthFrame: 1,
  });
  const driving = shot.drive ? shot.drive(page, shot.seconds) : wait(shot.seconds * 1000);
  await driving;
  await page.send('Page.stopScreencast');
  await wait(220);

  const elapsed = (Date.now() - started) / 1000;
  const fps = Math.max(8, Math.min(60, count / elapsed));
  console.log(`  ${shot.name}: ${count} frames in ${elapsed.toFixed(1)}s (${fps.toFixed(1)} fps)`);
  return { fps, count };
}

// ---------------------------------------------------------------------------
// Cutting it together
// ---------------------------------------------------------------------------

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let noise = '';
    child.stderr.on('data', (chunk) => { noise += chunk; });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(noise.slice(-900)))));
  });
}

const FONT = existsSync('/usr/share/fonts/liberation/LiberationSerif-Regular.ttf')
  ? '/usr/share/fonts/liberation/LiberationSerif-Regular.ttf'
  : '/usr/share/fonts/TTF/DejaVuSerif.ttf';

/** A card of type on the game's own background, for the two ends. */
async function card(file, lines, seconds) {
  const draws = lines.map((line, i) =>
    `drawtext=fontfile=${FONT}:text='${line.text}':fontcolor=${line.colour}:fontsize=${line.size}` +
    `:x=(w-text_w)/2:y=(h/2)+${line.offset}:alpha='min(1,max(0,(t-${0.15 + i * 0.25})*2.2))'`
  ).join(',');
  await run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=0x12161a:s=${WIDTH}x${HEIGHT}:d=${seconds}:r=30`,
    '-vf', `${draws},fade=t=out:st=${seconds - 0.5}:d=0.5`,
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18', file,
  ]);
}

async function clip(folder, fps, file, shot, fade) {
  const shots = (await readdir(folder)).filter((name) => name.endsWith('.jpg'));
  if (shots.length === 0) throw new Error(`${folder} caught nothing at all`);
  // A screen that is not moving is painted once and then never again, so the
  // browser sends one frame and stops. That is not a fault to work around —
  // a still is what the front of the game and an open dossier are — so the
  // one frame is simply held for as long as the shot was asked for.
  const still = shot.still || shots.length < 4;
  const seconds = still ? shot.seconds : shots.length / fps;
  const filters = ['scale=1280:720:flags=neighbor', 'fade=t=in:st=0:d=0.3'];
  if (fade) filters.push(`fade=t=out:st=${Math.max(0, seconds - 0.4)}:d=0.4`);
  const input = still
    ? ['-loop', '1', '-t', seconds.toFixed(2), '-i',
       path.join(folder, shots[shots.length - 1])]
    : ['-framerate', fps.toFixed(3), '-i', path.join(folder, 'f%05d.jpg')];
  await run('ffmpeg', [
    '-y', ...input, '-vf', filters.join(','), '-r', '30',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '19', '-preset', 'slow', file,
  ]);
}

async function main() {
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });

  console.log(`recording from ${HOST}`);
  const { child, page } = await openBrowser();
  try {
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });
    // `REGNA_SHOTS=menu,sea` records a couple of them, for working on one
    // shot without sitting through the whole storyboard.
    const only = (process.env.REGNA_SHOTS ?? '').split(',').filter(Boolean);
    const wanted = only.length ? SHOTS.filter((shot) => only.includes(shot.name)) : SHOTS;
    const taken = [];
    for (const shot of wanted) {
      const folder = path.join(WORK, shot.name);
      const { fps } = await record(page, shot, folder);
      taken.push({ shot, folder, fps });
    }

    console.log('cutting');
    const pieces = [];
    const opening = path.join(WORK, '00-open.mp4');
    await card(opening, [
      { text: 'REGNA', colour: '0xd9b55f', size: 92, offset: -70 },
      { text: 'Age of Kingdoms', colour: '0xe4e0d4', size: 36, offset: 20 },
      { text: 'Europe, 1080 to 1530  ·  seventy-three realms', colour: '0x9aa3a8', size: 22, offset: 86 },
    ], 3.6);
    pieces.push(opening);

    for (const [i, { shot, folder, fps }] of taken.entries()) {
      const file = path.join(WORK, `${String(i + 1).padStart(2, '0')}-${shot.name}.mp4`);
      await clip(folder, fps, file, shot, i === taken.length - 1);
      pieces.push(file);
    }

    const closing = path.join(WORK, '99-close.mp4');
    await card(closing, [
      { text: 'REGNA', colour: '0xd9b55f', size: 72, offset: -56 },
      { text: 'github.com/Hercegman/regna', colour: '0xe4e0d4', size: 30, offset: 18 },
      { text: 'no engine, no art folder, no runtime dependencies', colour: '0x9aa3a8', size: 20, offset: 74 },
    ], 4.2);
    pieces.push(closing);

    const list = path.join(WORK, 'cut.txt');
    await writeFile(list, pieces.map((file) => `file '${file}'`).join('\n'));
    await run('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-c:v', 'libx264', '-crf', '19', '-preset', 'slow', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', OUT,
    ]);
    console.log(`wrote ${OUT}`);
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
