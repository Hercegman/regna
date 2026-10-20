#!/usr/bin/env python3
"""Renders the map's sprites, the way these games were actually made.

Transport Tycoon and Locomotion did not have their buildings drawn pixel by
pixel. They were modelled, rendered from a fixed isometric camera at a small
size, and squeezed onto a fixed palette; the pixels are what came out of that,
not what went into it. This does the same, in Blender, from a script: no
hand-placed vertices, so a settlement's size, its walls and its spire are
decided by the same numbers the game uses.

    ~/.local/bin/blender --background --python tools/build-sprites.py

Writes public/sprites.png and src/core/data/sprites.ts. Everything that
belongs to whoever owns the place — banners, shields — is rendered in a marker
colour, and the game swaps that for the owner's at draw time. That is how
these games coloured a hundred companies from one sprite, and it is why a
settlement here can be any of seventy-three.
"""
import math
import os
import struct
import sys
import zlib

import bpy  # type: ignore
import mathutils  # type: ignore

HERE = os.path.dirname(os.path.abspath(os.environ.get('REGNA_TOOLS', __file__)))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OUT_PNG = os.path.join(ROOT, 'public', 'sprites.png')
OUT_TS = os.path.join(ROOT, 'src', 'core', 'data', 'sprites.ts')

# The camera that makes a square of ground a two-to-one diamond: looking down
# thirty degrees, turned forty-five. Anything else and the sprites will not sit
# on the tiles.
ELEVATION = 30.0
AZIMUTH = 45.0

# Rendered at four times the size the map uses and shrunk with hard edges,
# which is how a render becomes pixel art rather than a small photograph.
CELL = 64
SUPERSAMPLE = 4

#: Stands in for whatever the owner's colour is. Pure magenta appears nowhere
#: else, so the swap can never catch anything it should not.
MARKER = (1.0, 0.0, 1.0)

PALETTE_LEVELS = 10


# ---------------------------------------------------------------------------
# Building the models
# ---------------------------------------------------------------------------

def clear():
    """Takes away the last model and nothing else.

    The camera and the lights are set up once and have to survive: deleting
    everything in the scene between sprites takes them with it.
    """
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def srgb(hex_colour):
    """A colour written the way a person writes one, in the form Blender wants.

    Blender's inputs are linear. Handing it the numbers out of a hex colour
    makes everything roughly twice as bright as intended, which is how the
    first sheet came out looking bleached.
    """
    value = int(hex_colour.lstrip('#'), 16)
    return tuple(((value >> shift) & 255) / 255.0 ** 1 for shift in (16, 8, 0)) if False else tuple(
        (((value >> shift) & 255) / 255.0) ** 2.2 for shift in (16, 8, 0)
    )


def material(name, colour, emissive=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    if emissive:
        shader = nodes.new('ShaderNodeEmission')
        shader.inputs['Color'].default_value = (*colour, 1.0)
        shader.inputs['Strength'].default_value = 1.0
    else:
        shader = nodes.new('ShaderNodeBsdfDiffuse')
        shader.inputs['Color'].default_value = (*colour, 1.0)
    links.new(shader.outputs[0], out.inputs['Surface'])
    return mat


def mesh_from(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def box(name, cx, cy, cz, sx, sy, sz, mat):
    """An axis-aligned box standing on z = cz."""
    hx, hy = sx / 2, sy / 2
    verts = [
        (cx - hx, cy - hy, cz), (cx + hx, cy - hy, cz),
        (cx + hx, cy + hy, cz), (cx - hx, cy + hy, cz),
        (cx - hx, cy - hy, cz + sz), (cx + hx, cy - hy, cz + sz),
        (cx + hx, cy + hy, cz + sz), (cx - hx, cy + hy, cz + sz),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return mesh_from(name, verts, faces, mat)


def gable(name, cx, cy, cz, sx, sy, sz, mat):
    """A roof: a prism with the ridge running along y."""
    hx, hy = sx / 2, sy / 2
    verts = [
        (cx - hx, cy - hy, cz), (cx + hx, cy - hy, cz),
        (cx + hx, cy + hy, cz), (cx - hx, cy + hy, cz),
        (cx, cy - hy, cz + sz), (cx, cy + hy, cz + sz),
    ]
    faces = [(0, 1, 2, 3), (0, 4, 5, 3), (1, 2, 5, 4), (0, 1, 4), (3, 5, 2)]
    return mesh_from(name, verts, faces, mat)


def cone(name, cx, cy, cz, radius, height, mat, sides=8, shoulder=0.0):
    """A cone, optionally standing on a short drum of its own radius.

    Used for two different things: the roof of a church tower, and a fir. A
    fir wants no drum and a narrow base; a roof wants the opposite.
    """
    verts = []
    for z in (cz, cz + height * shoulder):
        for i in range(sides):
            angle = 2 * math.pi * i / sides
            verts.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius, z))
    tip = len(verts)
    verts.append((cx, cy, cz + height))
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
        faces.append((sides + i, sides + j, tip))
    return mesh_from(name, verts, faces, mat)


def church(name, cx, cy, cz, height, stone_mat, roof_mat):
    """A square tower with a spire on it: the one thing visible from outside."""
    side = 0.3
    box(f'{name}-tower', cx, cy, cz, side, side, height, stone_mat)
    cone(f'{name}-spire', cx, cy, cz + height, side * 0.78, height * 0.55, roof_mat, 4)
    # The nave it stands at the end of.
    box(f'{name}-nave', cx, cy - side * 1.5, cz, side * 0.95, side * 2.2, height * 0.42, stone_mat)
    gable(f'{name}-nave-roof', cx, cy - side * 1.5, cz + height * 0.42,
          side * 1.1, side * 2.4, height * 0.2, roof_mat)


def banner(name, cx, cy, cz, height, pole_mat, cloth_mat):
    box(f'{name}-pole', cx, cy, cz, 0.08, 0.08, height, pole_mat)
    verts = [
        (cx, cy, cz + height * 0.58), (cx, cy, cz + height),
        (cx + 0.34, cy, cz + height * 0.92), (cx + 0.34, cy, cz + height * 0.66),
    ]
    return mesh_from(f'{name}-cloth', verts, [(0, 1, 2, 3)], cloth_mat)


def wall_ring(name, radius, height, thickness, towers, mats):
    """A ring of wall with square towers, as a town had."""
    stone, = mats
    sides = 16
    for i in range(sides):
        a0 = 2 * math.pi * i / sides
        a1 = 2 * math.pi * (i + 1) / sides
        x0, y0 = math.cos(a0) * radius, math.sin(a0) * radius
        x1, y1 = math.cos(a1) * radius, math.sin(a1) * radius
        mid = ((x0 + x1) / 2, (y0 + y1) / 2)
        length = math.dist((x0, y0), (x1, y1)) * 1.15
        angle = math.atan2(y1 - y0, x1 - x0)
        obj = box(f'{name}-{i}', 0, 0, 0, length, thickness, height, stone)
        obj.rotation_euler = (0, 0, angle)
        obj.location = (mid[0], mid[1], 0)
    for i in range(towers):
        angle = 2 * math.pi * i / towers
        box(f'{name}-t{i}', math.cos(angle) * radius, math.sin(angle) * radius, 0,
            thickness * 2.2, thickness * 2.2, height * 1.5, stone)


def settlement(rank, walls):
    """A place of the given rank, with walls of the given kind."""
    clear()
    roof_a = material('roof-a', srgb('#8e3a28'))
    roof_b = material('roof-b', srgb('#a55a33'))
    plaster = material('plaster', srgb('#cbbf9f'))
    stone = material('stone', srgb('#9a978c'))
    timber = material('timber', srgb('#5a3f24'))
    cloth = material('cloth', MARKER, emissive=True)

    # How much of the ground it covers, and how many roofs are on it.
    spread = 0.7 + rank * 0.28
    houses = 2 + rank * 2
    for i in range(houses):
        angle = 2.399963 * i          # the golden angle, so nothing lines up
        reach = spread * math.sqrt((i + 0.6) / houses)
        hx, hy = math.cos(angle) * reach, math.sin(angle) * reach
        w = 0.34 + (i % 3) * 0.05
        h = 0.3 + (i % 2) * 0.12
        box(f'house-{i}', hx, hy, 0, w, w * 1.25, h, plaster)
        gable(f'roof-{i}', hx, hy, h, w * 1.18, w * 1.4, 0.2, roof_a if i % 2 else roof_b)

    if rank >= 3:
        # Tall enough to stand clear of the walls, because the one thing you
        # could see of a city from outside it was the church.
        church('church', 0, 0.1, 0, 0.85 + rank * 0.14, stone, roof_a)
    if walls >= 1:
        wall_ring('wall', spread + 0.38, 0.22 if walls == 1 else 0.42,
                  0.1 if walls == 1 else 0.16,
                  0 if walls == 1 else min(8, 3 + walls),
                  (timber if walls == 1 else stone,))
    banner('banner', spread * 0.62, -spread * 0.62, 0, 0.72 + rank * 0.05, timber, cloth)
    return spread + 0.75


def man(name, x, y, mail, cloth, spear_mat, mounted=False):
    """One figure: legs, a surcoat in his lord's colours, a helmet, a spear.

    Small enough that at map size he is three pixels, which is the whole
    point: a body of men is a lot of these, not one big token.
    """
    base = 0.0
    if mounted:
        box(f'{name}-horse', x, y, 0, 0.17, 0.42, 0.24, spear_mat)
        box(f'{name}-neck', x, y + 0.17, 0.24, 0.12, 0.12, 0.14, spear_mat)
        base = 0.26
    box(f'{name}-legs', x, y, base, 0.14, 0.12, 0.16, mail)
    box(f'{name}-body', x, y, base + 0.16, 0.19, 0.15, 0.2, cloth)
    box(f'{name}-head', x, y, base + 0.36, 0.13, 0.13, 0.12, mail)
    # Short enough to read as a spear rather than as a thicket: at map size
    # a tall one is all you can see of the men carrying it.
    box(f'{name}-spear', x + 0.11, y - 0.02, base + 0.1, 0.03, 0.03, 0.46, spear_mat)


def soldiers(mounted):
    """A body of men as the map shows one: ranks of figures under a standard.

    Ranks rather than a row, because a row of figures seen from this angle is
    a picket fence. Two ranks with the back one offset reads as a crowd at
    any size.
    """
    clear()
    mail = material('mail', srgb('#55534c'))
    cloth = material('cloth', MARKER, emissive=True)
    timber = material('timber', srgb('#4a3222'))
    across, deep = (3, 2) if mounted else (4, 2)
    pitch = 0.34 if mounted else 0.24
    for row in range(deep):
        for i in range(across):
            x = (i - (across - 1) / 2) * pitch + (0.5 * pitch if row else 0)
            y = -row * (0.42 if mounted else 0.26)
            man(f'm{row}-{i}', x, y, mail, cloth, timber, mounted)
    banner('standard', 0, -deep * 0.3 - 0.2, 0, 0.95, timber, cloth)
    return 0.95 if not mounted else 1.15


def oneMan(mounted):
    """A single figure, for the battlefield, where there are hundreds."""
    clear()
    mail = material('mail', srgb('#55534c'))
    cloth = material('cloth', MARKER, emissive=True)
    timber = material('timber', srgb('#4a3222'))
    man('one', 0, 0, mail, cloth, timber, mounted)
    return 0.62 if not mounted else 0.74


def agent():
    """A hooded man on foot: no banner, no mail, nothing to identify him."""
    clear()
    cloak = material('cloak', MARKER, emissive=True)
    dark = material('dark', srgb('#3b372f'))
    box('legs', 0, 0, 0, 0.12, 0.1, 0.12, dark)
    box('cloak', 0, 0, 0.12, 0.2, 0.17, 0.26, cloak)
    cone('hood', 0, 0, 0.36, 0.1, 0.14, dark, 6)
    box('staff', 0.12, -0.02, 0, 0.03, 0.03, 0.62, dark)
    return 0.5


def caravan():
    """A pack animal under its load, with the load in the owner's colours."""
    clear()
    beast = material('beast', srgb('#5b452c'))
    load = material('load', MARKER, emissive=True)
    box('body', 0, 0, 0.14, 0.18, 0.46, 0.18, beast)
    box('neck', 0, 0.24, 0.26, 0.12, 0.14, 0.16, beast)
    box('head', 0, 0.3, 0.4, 0.11, 0.16, 0.1, beast)
    for i, (dx, dy) in enumerate(((-0.07, 0.17), (0.07, 0.17), (-0.07, -0.17), (0.07, -0.17))):
        box(f'leg-{i}', dx, dy, 0, 0.05, 0.05, 0.15, beast)
    box('pack', 0, -0.02, 0.32, 0.24, 0.3, 0.16, load)
    return 0.55


def vessel(oared):
    """A hull: a galley with her oars out, or a round ship under sail."""
    clear()
    oak = material('oak', srgb('#6b4a28'))
    cloth = material('cloth', MARKER, emissive=True)
    pale = material('sail', srgb('#ddd6c2'))
    length = 1.5 if oared else 1.0
    beam = 0.22 if oared else 0.4
    box('hull', 0, 0, 0, beam, length, 0.24, oak)
    box('stern', 0, -length * 0.4, 0.24, beam * 0.7, length * 0.18, 0.16, oak)
    box('bow', 0, length * 0.42, 0.24, beam * 0.6, length * 0.16, 0.12, oak)
    if oared:
        for i in range(6):
            y = -length * 0.3 + i * length * 0.12
            box(f'oar-l{i}', -beam * 0.8, y, 0.1, beam * 0.9, 0.03, 0.03, oak)
            box(f'oar-r{i}', beam * 0.8, y, 0.1, beam * 0.9, 0.03, 0.03, oak)
    box('mast', 0, 0, 0.18, 0.05, 0.05, 0.8, oak)
    mesh_from('sail', [
        (-beam * 1.1, 0.02, 0.4), (beam * 1.1, 0.02, 0.4),
        (beam * 1.1, 0.02, 0.92), (-beam * 1.1, 0.02, 0.92),
    ], [(0, 1, 2, 3)], pale if oared else cloth)
    # The frame has to follow the model. Returning the same radius for a
    # forty-metre galley and a short round ship drew the round ship at a
    # third of its size, because the sprite is framed on this number and the
    # game stamps every sprite as a square of the same side.
    return max(length, 1.0) * 0.72


def tree(tall):
    clear()
    trunk = material('trunk', srgb('#3d2a18'))
    leaf = material('leaf', srgb('#2f5f28'))
    box('trunk', 0, 0, 0, 0.09, 0.09, 0.22, trunk)
    # A fir: one narrow cone, not a stack of domes.
    cone('crown', 0, 0, 0.14, 0.3 if tall else 0.26, 1.0 if tall else 0.66, leaf, 6)
    return 0.7


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = CELL * SUPERSAMPLE
    scene.render.resolution_y = CELL * SUPERSAMPLE
    scene.render.filter_size = 0.0

    camera_data = bpy.data.cameras.new('camera')
    camera_data.type = 'ORTHO'
    camera = bpy.data.objects.new('camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 2.6
    sun.data.angle = 0.0
    sun.rotation_euler = (math.radians(55), 0, math.radians(-25))
    scene.collection.objects.link(sun)

    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 0.5
    fill.rotation_euler = (math.radians(120), 0, math.radians(150))
    scene.collection.objects.link(fill)
    scene.world = bpy.data.worlds.new('world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.26, 0.3, 0.38, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.18
    return camera


def aim(camera, radius):
    """Points the camera at the model from the one angle the tiles allow."""
    distance = max(6.0, radius * 4)
    azimuth = math.radians(AZIMUTH)
    elevation = math.radians(ELEVATION)
    camera.location = (
        math.cos(elevation) * math.sin(azimuth) * distance,
        -math.cos(elevation) * math.cos(azimuth) * distance,
        math.sin(elevation) * distance,
    )
    direction = -mathutils.Vector(camera.location)
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    # The model is centred on the ground, so the frame is lifted to leave room
    # for whatever stands up out of it.
    # Room to spare: a frame that fits exactly clips whatever leans out of it.
    camera.data.ortho_scale = radius * 2.05
    camera.data.shift_y = -0.16


def render(camera, radius, path):
    aim(camera, radius)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def read_png_pixels(path):
    """Blender's own loader, so there is no image library to install."""
    image = bpy.data.images.load(path)
    width, height = image.size
    raw = list(image.pixels)
    bpy.data.images.remove(image)
    return width, height, raw


def shrink_and_quantise(width, height, raw, cell):
    """Box-filters down to the cell size, then snaps to a short palette."""
    factor = width // cell
    out = bytearray(cell * cell * 4)
    step = 255.0 / (PALETTE_LEVELS - 1)
    for y in range(cell):
        for x in range(cell):
            r = g = b = a = 0.0
            for sy in range(factor):
                for sx in range(factor):
                    # Blender's buffer runs bottom-up.
                    px = x * factor + sx
                    py = height - 1 - (y * factor + sy)
                    i = (py * width + px) * 4
                    alpha = raw[i + 3]
                    r += raw[i] * alpha
                    g += raw[i + 1] * alpha
                    b += raw[i + 2] * alpha
                    a += alpha
            n = factor * factor
            index = (y * cell + x) * 4
            if a <= 0.001:
                out[index:index + 4] = b'\x00\x00\x00\x00'
                continue
            def channel(total):
                value = max(0.0, min(1.0, (total / a) ** (1 / 2.2))) * 255.0
                return int(round(round(value / step) * step))
            out[index] = channel(r)
            out[index + 1] = channel(g)
            out[index + 2] = channel(b)
            # Hard alpha: a pixel is in the sprite or it is not.
            out[index + 3] = 255 if a / n > 0.35 else 0
    return out


def write_png(path, width, height, rgba):
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        rows.extend(rgba[y * width * 4:(y + 1) * width * 4])

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    blob = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as handle:
        handle.write(blob)


def main():
    camera = setup_scene()
    scratch = os.path.join(ROOT, '.sprite-scratch.png')

    wanted = []
    for rank in range(6):
        walls = 0 if rank == 0 else 1 if rank == 1 else 2 if rank < 4 else 3
        wanted.append((f'town{rank}', lambda r=rank, w=walls: settlement(r, w)))
    wanted.append(('footmen', lambda: soldiers(False)))
    wanted.append(('horsemen', lambda: soldiers(True)))
    wanted.append(('soldier', lambda: oneMan(False)))
    wanted.append(('rider', lambda: oneMan(True)))
    wanted.append(('galley', lambda: vessel(True)))
    wanted.append(('roundship', lambda: vessel(False)))
    wanted.append(('agent', lambda: agent()))
    wanted.append(('caravan', lambda: caravan()))
    wanted.append(('tree', lambda: tree(True)))
    wanted.append(('scrub', lambda: tree(False)))

    columns = 4
    rows = (len(wanted) + columns - 1) // columns
    sheet = bytearray(columns * CELL * rows * CELL * 4)
    index = []

    for i, (name, build) in enumerate(wanted):
        radius = build()
        render(camera, radius, scratch)
        width, height, raw = read_png_pixels(scratch)
        cell = shrink_and_quantise(width, height, raw, CELL)
        column, row = i % columns, i // columns
        for y in range(CELL):
            start = ((row * CELL + y) * columns * CELL + column * CELL) * 4
            sheet[start:start + CELL * 4] = cell[y * CELL * 4:(y + 1) * CELL * 4]
        index.append((name, column * CELL, row * CELL))
        print(f'  {name}', flush=True)

    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    write_png(OUT_PNG, columns * CELL, rows * CELL, sheet)
    if os.path.exists(scratch):
        os.remove(scratch)

    entries = ',\n'.join(
        f"  {name}: {{ x: {x}, y: {y}, width: {CELL}, height: {CELL} }}" for name, x, y in index
    )
    with open(OUT_TS, 'w') as handle:
        handle.write(f'''/**
 * Where each sprite sits on the sheet.
 *
 * The sheet is modelled and rendered rather than drawn: see
 * tools/build-sprites.py, which puts every piece in front of the one camera
 * angle the tiles allow and shrinks the result onto a short palette. Do not
 * edit by hand.
 *
 * Anything belonging to whoever owns a thing is rendered in pure magenta and
 * swapped for the owner's colour when the sprite is first asked for. That is
 * how these games coloured a hundred companies from one drawing, and it is
 * why a settlement here can be any of seventy-three.
 */

export const SPRITE_MARKER = {{ r: 255, g: 0, b: 255 }} as const;

/** Where the sheet is served from. */
export const SPRITE_SHEET = 'sprites.png';

export const SPRITES = {{
{entries},
}} as const;

export type SpriteName = keyof typeof SPRITES;
''')
    print(f'wrote {os.path.relpath(OUT_PNG, ROOT)} and {os.path.relpath(OUT_TS, ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
