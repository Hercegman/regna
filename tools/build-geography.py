#!/usr/bin/env python3
"""Builds src/core/data/geography.ts from Natural Earth physical vectors.

The campaign map is drawn inside a real coastline rather than on a blank
background, and this is where that coastline comes from. The geometry is
Natural Earth's 1:50m physical set, which is in the public domain and may be
used without permission or attribution; the clipping to the theatre and the
simplification are this project's own.

The output is checked in, so this only needs running to change the bounds, the
level of detail, or the source release.

    cd tools
    for set in land lakes rivers_lake_centerlines; do
      curl -LO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_$set.geojson"
      mv "ne_50m_$set.geojson" "ne_50m_$set.json"
    done
    python3 build-geography.py

Simplification is Ramer-Douglas-Peucker. A closed ring cannot be run through
it directly: with the first and last point identical the baseline is
degenerate and the whole ring collapses to two points. So a ring is split at
the point farthest from its first, and the two halves are simplified as open
lines.
"""
import json
import math
import os
import sys

# The theatre: the Atlantic coast to the Caspian, the Sahara to the Arctic.
BBOX = (-18.0, 2.0, 58.0, 73.0)

# Tolerances in degrees. The coast carries the most detail because it is what
# the eye checks; rivers carry the least because they are hints, not borders.
LAND_EPS = 0.025
LAKE_EPS = 0.03
RIVER_EPS = 0.04
MIN_LAKE_AREA = 0.02
MIN_RIVER_LENGTH = 2.0

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'core', 'data', 'geography.ts')


def rdp_open(points, eps):
    """Ramer-Douglas-Peucker on an open polyline."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if norm < 1e-12:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, bi = d, i
        if best > eps and bi >= 0:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(points, keep) if k]


def rdp_ring(ring, eps):
    """Simplifies a closed ring by splitting it into two open halves first."""
    pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
    if len(pts) < 4:
        return pts + [pts[0]]
    far = max(
        range(len(pts)),
        key=lambda k: (pts[k][0] - pts[0][0]) ** 2 + (pts[k][1] - pts[0][1]) ** 2,
    )
    first = rdp_open(pts[: far + 1], eps)
    second = rdp_open(pts[far:] + [pts[0]], eps)
    out = first[:-1] + second[:-1]
    return out + [out[0]] if len(out) >= 3 else None


def clip_poly(poly, edge, value, gt):
    """One Sutherland-Hodgman pass against an axis-aligned half-plane."""
    out = []
    for i in range(len(poly)):
        cur, prev = poly[i], poly[i - 1]
        cin = cur[edge] >= value if gt else cur[edge] <= value
        pin = prev[edge] >= value if gt else prev[edge] <= value
        if cin:
            if not pin:
                t = (value - prev[edge]) / (cur[edge] - prev[edge])
                out.append((prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t))
            out.append(cur)
        elif pin:
            t = (value - prev[edge]) / (cur[edge] - prev[edge])
            out.append((prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t))
    return out


def clip_to_box(ring):
    poly = ring[:-1] if ring[0] == ring[-1] else list(ring)
    for edge, value, gt in (
        (0, BBOX[0], True),
        (0, BBOX[2], False),
        (1, BBOX[1], True),
        (1, BBOX[3], False),
    ):
        if not poly:
            return None
        poly = clip_poly(poly, edge, value, gt)
    return poly + [poly[0]] if len(poly) >= 3 else None


def hits(ring):
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return not (
        max(lons) < BBOX[0]
        or min(lons) > BBOX[2]
        or max(lats) < BBOX[1]
        or min(lats) > BBOX[3]
    )


def polygons(path, eps, min_area=0.0):
    data = json.load(open(path))
    out = []
    for feature in data['features']:
        geometry = feature.get('geometry')
        if not geometry:
            continue
        if geometry['type'] == 'Polygon':
            rings = geometry['coordinates']
        else:
            rings = [ring for poly in geometry['coordinates'] for ring in poly]
        for ring in rings:
            ring = [(p[0], p[1]) for p in ring if len(p) >= 2]
            if len(ring) < 4 or not hits(ring):
                continue
            clipped = clip_to_box(ring)
            if not clipped:
                continue
            simple = rdp_ring(clipped, eps)
            if not simple or len(simple) < 4:
                continue
            area = abs(
                sum(
                    simple[i][0] * simple[i + 1][1] - simple[i + 1][0] * simple[i][1]
                    for i in range(len(simple) - 1)
                )
            ) / 2
            if area < min_area:
                continue
            out.append([[round(x, 3), round(y, 3)] for x, y in simple])
    return out


def lines(path, eps, min_length):
    data = json.load(open(path))
    runs = []
    for feature in data['features']:
        geometry = feature.get('geometry')
        if not geometry:
            continue
        parts = (
            [geometry['coordinates']]
            if geometry['type'] == 'LineString'
            else geometry['coordinates']
        )
        for part in parts:
            run = []
            for p in part:
                if len(p) < 2:
                    continue
                inside = BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]
                if inside:
                    run.append((p[0], p[1]))
                else:
                    if len(run) >= 3:
                        runs.append(run)
                    run = []
            if len(run) >= 3:
                runs.append(run)
    out = []
    for run in runs:
        simple = rdp_open(run, eps)
        if len(simple) < 3:
            continue
        length = sum(
            math.hypot(simple[i + 1][0] - simple[i][0], simple[i + 1][1] - simple[i][1])
            for i in range(len(simple) - 1)
        )
        if length >= min_length:
            out.append([[round(x, 3), round(y, 3)] for x, y in simple])
    return out


HEADER = '''/**
 * The coastline.
 *
 * Land, lakes and the great rivers of the theatre, clipped to the map's own
 * bounds and simplified until a ring is a few dozen points rather than a few
 * thousand. This is what makes the campaign map a map: the provinces are drawn
 * inside this outline rather than floating as shapes on a background.
 *
 * Source: Natural Earth 1:50m physical vectors, which are in the public domain
 * and may be used without permission or attribution. The clipping and the
 * simplification are this project's own; the geometry is theirs.
 *
 * Generated by tools/build-geography.py. Do not edit by hand.
 *
 * Coordinates are [longitude, latitude], as everything else on the map is, so
 * they project through the same camera the provinces do.
 */

export type Ring = readonly (readonly [number, number])[];

'''


def emit(name, rings, doc):
    out = ['/** %s */' % doc, 'export const %s: readonly Ring[] = [' % name]
    for ring in rings:
        out.append('  [' + ','.join('[%g,%g]' % (x, y) for x, y in ring) + '],')
    out += ['];', '']
    return '\n'.join(out)


def main():
    missing = [
        name
        for name in ('ne_50m_land.json', 'ne_50m_lakes.json', 'ne_50m_rivers_lake_centerlines.json')
        if not os.path.exists(os.path.join(HERE, name))
    ]
    if missing:
        sys.exit('missing source data: %s\nsee the header of this file' % ', '.join(missing))

    land = polygons(os.path.join(HERE, 'ne_50m_land.json'), LAND_EPS)
    lakes = polygons(os.path.join(HERE, 'ne_50m_lakes.json'), LAKE_EPS, MIN_LAKE_AREA)
    rivers = lines(
        os.path.join(HERE, 'ne_50m_rivers_lake_centerlines.json'), RIVER_EPS, MIN_RIVER_LENGTH
    )
    print(
        'land %d/%d  lakes %d/%d  rivers %d/%d'
        % (
            len(land),
            sum(len(r) for r in land),
            len(lakes),
            sum(len(r) for r in lakes),
            len(rivers),
            sum(len(r) for r in rivers),
        )
    )

    body = HEADER
    body += emit('LAND_RINGS', land, 'Closed rings of coastline. Every island is a ring of its own.') + '\n'
    body += emit('LAKE_RINGS', lakes, 'Inland water, drawn back over the land.') + '\n'
    body += emit('RIVER_LINES', rivers, 'Open polylines along the great rivers.')
    body += '''
/** The bounds the geometry was clipped to, in degrees. */
export const GEO_BOUNDS = { west: %g, south: %g, east: %g, north: %g } as const;
''' % BBOX

    with open(OUT, 'w') as handle:
        handle.write(body)
    print('wrote %s (%d bytes)' % (os.path.relpath(OUT), os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
