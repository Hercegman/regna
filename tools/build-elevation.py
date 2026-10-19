#!/usr/bin/env python3
"""Builds the elevation layer the 3D campaign map is shaped from.

The 2D map was drawn from coastlines alone, which is all a flat map needs. A
map you can tilt needs to know how high the ground is, so this fetches the
theatre's elevation and writes it as a plain grid of metres.

Source: ETOPO (NOAA NCEI), via the NOAA CoastWatch ERDDAP subset service. The
data are in the public domain and may be used without permission or
attribution. ERDDAP is used rather than the published GeoTIFF because it
returns exactly the window and resolution asked for, as plain text, which
means no GDAL and no gigabyte download for a corner of the world.

The output is a raw little-endian Int16 grid of metres, row-major from the
NORTH edge southwards and from the WEST edge eastwards — the order a texture
and a mesh both want — plus a small TypeScript module describing its shape.
Raw rather than a PNG because a browser decodes a 16-bit PNG to 8 bits and
the heights have to stay exact: the campaign map reads them on the CPU to
stand settlements and armies on the ground.

    python3 tools/build-elevation.py

Re-run only to change the bounds or the resolution; the output is checked in.
"""
import math
import os
import struct
import sys
import time
import urllib.error
import urllib.request

# The same theatre the coastline is clipped to; see build-geography.py.
WEST, SOUTH, EAST, NORTH = -18.0, 2.0, 58.0, 73.0

# ETOPO is on a one arc-minute grid. Taking every fourth sample gives about
# 7.4 km between posts, which is finer than any province and coarse enough to
# keep the file to a couple of megabytes.
STRIDE = 4
STEP = STRIDE / 60.0

DATASET = 'etopo180'
BASE = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap'

# Latitude is fetched in bands; one request for the whole theatre times out.
BAND = 4.0

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BIN = os.path.join(HERE, '..', 'public', 'elevation.bin')
OUT_TS = os.path.join(HERE, '..', 'src', 'core', 'data', 'elevation.ts')


def grid_size():
    """Posts across and down, counted the way ERDDAP steps through them."""
    width = int(math.floor((EAST - WEST) / STEP)) + 1
    height = int(math.floor((NORTH - SOUTH) / STEP)) + 1
    return width, height


def fetch(south, north):
    """One band of the grid, as {(lat, lon): metres}."""
    query = (
        f'{BASE}/{DATASET}.csv?altitude'
        f'%5B({south}):{STRIDE}:({north})%5D'
        f'%5B({WEST}):{STRIDE}:({EAST})%5D'
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(query, timeout=180) as response:
                return response.read().decode('utf-8')
        except (urllib.error.URLError, TimeoutError) as problem:
            if attempt == 3:
                raise
            print(f'    retrying ({problem})', flush=True)
            time.sleep(5 * (attempt + 1))
    return ''


def main():
    width, height = grid_size()
    print(f'grid {width} x {height} at {STEP:.6f} degrees ({STRIDE} arc-minutes)')

    # Filled from the north down, which is the order the file is written in.
    heights = [None] * (width * height)
    filled = 0

    south = SOUTH
    while south < NORTH:
        north = min(NORTH, south + BAND)
        print(f'  {south:.1f}..{north:.1f}', flush=True)
        text = fetch(south, north)
        for line in text.splitlines()[2:]:
            parts = line.split(',')
            if len(parts) < 3 or not parts[2]:
                continue
            lat = float(parts[0])
            lon = float(parts[1])
            try:
                metres = int(round(float(parts[2])))
            except ValueError:
                continue
            column = int(round((lon - WEST) / STEP))
            row = int(round((NORTH - lat) / STEP))
            if not (0 <= column < width and 0 <= row < height):
                continue
            index = row * width + column
            if heights[index] is None:
                filled += 1
            heights[index] = max(-32000, min(32000, metres))
        south = north

    missing = width * height - filled
    if missing:
        print(f'  {missing} posts had no value; filling them from their neighbours')
        for index in range(len(heights)):
            if heights[index] is not None:
                continue
            # The gaps are single posts at band seams, so the post above is
            # the right answer and the sea is the right answer at the edge.
            above = index - width
            heights[index] = heights[above] if above >= 0 and heights[above] is not None else 0

    os.makedirs(os.path.dirname(OUT_BIN), exist_ok=True)
    with open(OUT_BIN, 'wb') as handle:
        handle.write(struct.pack(f'<{len(heights)}h', *heights))
    print(f'wrote {os.path.relpath(OUT_BIN)} ({os.path.getsize(OUT_BIN)} bytes)')

    land = [h for h in heights if h > 0]
    peak = max(heights)
    deep = min(heights)
    with open(OUT_TS, 'w') as handle:
        handle.write(f'''/**
 * The shape of the ground.
 *
 * Elevation in metres across the theatre, on a regular grid of longitude and
 * latitude. The values themselves are in `public/elevation.bin` as raw
 * little-endian 16-bit integers, row-major from the north edge southwards and
 * from the west edge eastwards: {width} across by {height} down.
 *
 * Source: ETOPO (NOAA NCEI), which is in the public domain. Generated by
 * tools/build-elevation.py. Do not edit by hand.
 *
 * It is a separate file rather than a TypeScript array because {width * height}
 * numbers do not belong in a module, and raw rather than a PNG because a
 * browser decodes a 16-bit PNG down to 8 bits and these heights are read on
 * the CPU to stand settlements and armies on the ground.
 */

export const ELEVATION = {{
  /** Posts across, west to east. */
  width: {width},
  /** Posts down, north to south. */
  height: {height},
  /** Degrees between posts, the same in both directions. */
  step: {STEP!r},
  west: {WEST},
  south: {SOUTH},
  east: {EAST},
  north: {NORTH},
  /** Where the grid is served from. */
  url: 'elevation.bin',
  /** The highest and lowest posts in the theatre, in metres. */
  peak: {peak},
  deepest: {deep},
}} as const;
''')
    print(f'wrote {os.path.relpath(OUT_TS)}')
    print(f'  land posts {len(land)} of {len(heights)}, peak {peak} m, deepest {deep} m')


if __name__ == '__main__':
    sys.exit(main())
