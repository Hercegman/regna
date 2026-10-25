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
CELL = 96
SUPERSAMPLE = 4

#: Stands in for whatever the owner's colour is.
#:
#: A surface, not a light. It used to be emissive, which made it come out of
#: the render as flat (255, 0, 255) on every face — so a surcoat was one
#: rectangle of the owner's paint with no lit side and no shaded one, and a
#: block of men in a single colour read as a stain rather than as men. Lit
#: like everything else, it comes out as (k, 0, k) instead: the green channel
#: is nought whatever the light does, because green times nought is nought,
#: so the marker still cannot be confused with anything on the sheet, and k
#: carries how brightly that face was lit. The game multiplies the realm's
#: colour by k, and a surcoat has a shoulder and a flank again.
MARKER = (1.0, 0.0, 1.0)

#: And the second colour a realm is painted in: the device on the shield.
#:
#: One marker gave a shield that was a flat rectangle of the owner's colour,
#: and every shield in Europe looked the same shape in a different paint. A
#: second one costs nothing — no extra renders, because the division is in
#: the model rather than in a variant of it — and buys a cross on the kite
#: shields and a rim on the round ones, in the tincture the realm's own
#: blazon puts there. Pure cyan, for the same reason magenta was chosen: it
#: appears nowhere else on this sheet — and, like the first, it is lit rather
#: than emitted, so the red channel is the one that stays at nought.
DEVICE = (0.0, 1.0, 1.0)

#: How many steps of each channel survive the shrink.
#:
#: The banding is the look, so this stays short. It is longer than it was by
#: four steps, because the figures now carry real shading on their own
#: surfaces rather than three flat faces, and ten steps turned a shoulder
#: into a staircase.
PALETTE_LEVELS = 14


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


def shared(name, colour):
    """A material made once per sprite and used by everything that asks.

    A body of men is twenty figures, and each of them wants the same leather
    for his boots and the same steel for his spearhead. Making those twice a
    man is forty materials nobody needs; `clear` throws the shared one away
    between sprites along with everything else that has stopped being used.
    """
    return bpy.data.materials.get(name) or material(name, colour)


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


def placed(name, sx, sy, sz, mat, at, rot=(0.0, 0.0, 0.0)):
    """A box turned about its own middle, and only then put where it goes.

    `box` writes its vertices at the position it is handed, so setting an
    object rotation afterwards swings those vertices about the world origin
    rather than about the thing itself. Everything built from plain boxes was
    unaffected, which is most of this file, which is why it stood for a long
    time — but it is how a couched lance came to stand upright in front of
    its knight, how a drawn bow lay across its archer as a plank, and how a
    levelled pike ended up a pole on the ground beside him.

    Built at the origin, turned, and then moved. `at` is where the middle of
    it ends up.
    """
    obj = box(name, 0, 0, -sz / 2, sx, sy, sz, mat)
    obj.rotation_euler = rot
    obj.location = at
    return obj


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


def banner(name, cx, cy, cz, height, pole_mat, cloth_mat, width=0.34):
    """A pole with cloth on it.

    The width is worth a parameter. A standard planted over a body of men is
    meant to be the biggest thing in the frame; one carried beside a single
    man is not, and sized the same it makes him an accessory to his own flag.
    """
    box(f'{name}-pole', cx, cy, cz, 0.07, 0.07, height, pole_mat)
    verts = [
        (cx, cy, cz + height * 0.58), (cx, cy, cz + height),
        (cx + width, cy, cz + height * 0.92), (cx + width, cy, cz + height * 0.66),
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
    cloth = material('cloth', MARKER)

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


# ---------------------------------------------------------------------------
# A person
# ---------------------------------------------------------------------------
#
# What was here before was a dozen axis-aligned boxes: a slab for a torso,
# two posts for legs, two posts for arms, a cube for a head. It read as a
# domino with a face on it, and no amount of lighting was going to fix that,
# because the fault was in the shape. A box has eight corners and every one
# of them is a right angle, and a right angle is the one thing a person does
# not have. The legs never bent. The arms never bent. A man walking was a
# man standing with his feet moved apart.
#
# So: a skeleton. Hip, knee, ankle; shoulder, elbow, wrist; a pelvis, a
# tapered chest, a neck and a round head. Every pose is a table of joint
# angles and the limbs are built where those angles put them, which is why
# the knees bend in a stride and the elbow comes up in a fight. At twenty
# pixels you cannot see a knee. You can see that the leg has one.


def norm(v):
    length = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if length < 1e-9:
        return (0.0, 0.0, 1.0)
    return (v[0] / length, v[1] / length, v[2] / length)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def limb(name, a, b, r0, r1, mat, sides=6):
    """A tapered prism from one joint to the next.

    The whole of what makes a jointed figure possible: it goes wherever the
    two ends are, so a shin is the same call whether the knee is straight or
    folded under him. Six sides rather than four, because four is a box
    again and six at ninety pixels is a round limb once the render is
    shrunk.
    """
    direction = norm((b[0] - a[0], b[1] - a[1], b[2] - a[2]))
    helper = (0.0, 0.0, 1.0) if abs(direction[2]) < 0.9 else (1.0, 0.0, 0.0)
    across = norm(cross(direction, helper))
    up = cross(direction, across)
    verts = []
    for end, radius in ((a, r0), (b, r1)):
        for i in range(sides):
            angle = 2 * math.pi * i / sides
            c, s = math.cos(angle), math.sin(angle)
            verts.append((
                end[0] + (across[0] * c + up[0] * s) * radius,
                end[1] + (across[1] * c + up[1] * s) * radius,
                end[2] + (across[2] * c + up[2] * s) * radius,
            ))
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, sides * 2)))
    return mesh_from(name, verts, faces, mat)


def ball(name, centre, rx, ry, rz, mat, rings=4, segments=8):
    """A head. Low enough in the poles that it is still a few flat faces."""
    verts = []
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        for seg in range(segments):
            theta = 2 * math.pi * seg / segments
            verts.append((
                centre[0] + math.sin(phi) * math.cos(theta) * rx,
                centre[1] + math.sin(phi) * math.sin(theta) * ry,
                centre[2] + math.cos(phi) * rz,
            ))
    top = len(verts)
    verts.append((centre[0], centre[1], centre[2] + rz))
    bottom = len(verts)
    verts.append((centre[0], centre[1], centre[2] - rz))
    faces = []
    for ring in range(rings - 2):
        for seg in range(segments):
            nxt = (seg + 1) % segments
            a = ring * segments + seg
            b = ring * segments + nxt
            faces.append((a, b, (ring + 1) * segments + nxt, (ring + 1) * segments + seg))
    for seg in range(segments):
        nxt = (seg + 1) % segments
        faces.append((top, seg, nxt))
        last = (rings - 2) * segments
        faces.append((bottom, last + nxt, last + seg))
    return mesh_from(name, verts, faces, mat)


def taper(name, cx, cy, z0, z1, hx0, hy0, hx1, hy1, mat, lean=0.0):
    """A trunk: a prism that is one width at the bottom and another at the top.

    A torso is wide at the shoulders and narrow at the waist, and that one
    fact is most of what says the shape is a person rather than a crate.
    """
    top_y = cy + lean
    verts = [
        (cx - hx0, cy - hy0, z0), (cx + hx0, cy - hy0, z0),
        (cx + hx0, cy + hy0, z0), (cx - hx0, cy + hy0, z0),
        (cx - hx1, top_y - hy1, z1), (cx + hx1, top_y - hy1, z1),
        (cx + hx1, top_y + hy1, z1), (cx - hx1, top_y + hy1, z1),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return mesh_from(name, verts, faces, mat)


def trunk(name, cx, cy, z0, z1, rx0, ry0, rx1, ry1, mat, sides=8, lean=0.0):
    """A body: an oval in section, wide at the shoulders and narrow at the waist.

    `taper` builds the same shape out of four flat sides, which is a crate.
    A chest is not a crate and at twenty pixels the difference is the whole
    of whether the thing on top of the legs is a person or a parcel: eight
    sides give it a front, two flanks and a back that catch the light
    differently, and the silhouette stops having corners in it.
    """
    verts = []
    for z, rx, ry, shift in ((z0, rx0, ry0, 0.0), (z1, rx1, ry1, lean)):
        for i in range(sides):
            angle = 2 * math.pi * i / sides
            verts.append((cx + math.cos(angle) * rx, cy + shift + math.sin(angle) * ry, z))
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, sides * 2)))
    return mesh_from(name, verts, faces, mat)


def swing(origin, angle, length, sideways=0.0):
    """Where a limb ends, given the angle it hangs at.

    Nought is straight down and forward is positive, which is the way a man
    faces on this sheet. `sideways` is how far the joint itself sits out from
    the middle of him.
    """
    radians = math.radians(angle)
    return (
        origin[0] + sideways,
        origin[1] + math.sin(radians) * length,
        origin[2] - math.cos(radians) * length,
    )


#: Where every joint is, in the units the rest of the file is built in.
#:
#: Taken off the proportions a person actually has rather than off what fits
#: in a stack of boxes: the hips a little under half way up, the shoulders at
#: four fifths, the head a seventh of him. Both the figures this replaced
#: were wrong in the same direction and for different reasons — the boxes
#: made a five-head dwarf, and the first jointed one put the hips too high
#: and turned him into a pair of stilts with a parcel on top. The trunk is
#: the part the eye measures everything else against, and it has to be the
#: longest single run on the figure.
#: How tall a man is, crown to sole, in these units.
#:
#: Written down rather than left implicit because the game needs it: every
#: sprite is framed to fit what is in it, so the cell covers a different
#: amount of world from one to the next, and a man can only be drawn the
#: same size as the man beside him if both ends know what a man measures.
MAN_HEIGHT = 0.618

ANKLE = 0.028
KNEE = 0.158
HIP = 0.292
WAIST = 0.368
SHOULDER = 0.502
NECK = 0.530
SKULL = 0.565
THIGH = HIP - KNEE
SHIN = KNEE - ANKLE
UPPER_ARM = 0.112
FOREARM = 0.100
HIP_SPREAD = 0.038
SHOULDER_SPREAD = 0.068

#: What every pose is, as the angles of the joints that make it.
#:
#: `lean` tips the whole trunk forward, `drop` takes his height off him. The
#: legs run hip and knee, the arms shoulder and elbow; the left side carries
#: the shield and the right side the weapon. A knee only folds one way, so
#: the shin's angle is the thigh's less the bend, never more.
#:
#: `pass` is the frame the old sheet did not have, and the walk did not work
#: without it: a leg that has swung through has to come under the body with
#: the knee up before it goes out again. Standing still in the middle of a
#: stride is not a walk, it is two men taking turns.
STANCE = {
    'idle':   dict(lean=2,  drop=0.0,   hipL=5,   kneeL=4,  hipR=-6,  kneeR=7,
                   shoL=-7,  elbL=14, shoR=7,   elbR=14),
    'pass':   dict(lean=5,  drop=0.012, hipL=3,   kneeL=7,  hipR=-7,  kneeR=48,
                   shoL=8,   elbL=22, shoR=-8,  elbR=22),
    'step-a': dict(lean=7,  drop=0.004, hipL=29,  kneeL=9,  hipR=-25, kneeR=30,
                   shoL=-26, elbL=26, shoR=25,  elbR=20),
    'step-b': dict(lean=7,  drop=0.004, hipL=-25, kneeL=30, hipR=29,  kneeR=9,
                   shoL=25,  elbL=20, shoR=-26, elbR=26),
    'fight':  dict(lean=15, drop=0.022, hipL=27,  kneeL=36, hipR=-31, kneeR=11,
                   shoL=-16, elbL=44, shoR=34,  elbR=46),
    # Set, with his weight down and his shield up: what a man in a line does
    # between swings, and what he does for the quarter hour before anybody
    # swings at all. It is not a pose a line was ever drawn in, and a line
    # that has never been drawn in it reads as a line of men waiting for a
    # bus rather than as a line of men expecting to be hit.
    'brace':  dict(lean=11, drop=0.030, hipL=15,  kneeL=24, hipR=-17, kneeR=26,
                   shoL=28,  elbL=64, shoR=-16, elbR=52),
    # And roaring at the other line, which is most of what men in the front
    # rank of a medieval battle were doing with themselves: weight back,
    # chest out, and whatever he is holding thrown up over his head.
    'shout':  dict(lean=-11, drop=0.002, hipL=13, kneeL=11, hipR=-15, kneeR=13,
                   shoL=-20, elbL=32, shoR=148, elbR=14),
    'flee-a': dict(lean=21, drop=0.012, hipL=48,  kneeL=20, hipR=-34, kneeR=78,
                   shoL=-48, elbL=74, shoR=42,  elbR=66),
    'flee-b': dict(lean=21, drop=0.012, hipL=-34, kneeL=78, hipR=48,  kneeR=20,
                   shoL=42,  elbL=66, shoR=-48, elbR=74),
    'fall-a': dict(lean=-6, drop=0.06,  hipL=32,  kneeL=62, hipR=-8,  kneeR=44,
                   shoL=-74, elbL=26, shoR=62,  elbR=34),
    'fall-b': dict(lean=-18, drop=0.14, hipL=22,  kneeL=92, hipR=12,  kneeR=84,
                   shoL=-98, elbL=16, shoR=88,  elbR=20),
}

#: A man on a horse has his own: thighs out and forward over the barrel,
#: knees bent back under him, and he does not walk.
SEATED = dict(lean=4, drop=0.0, hipL=58, kneeL=66, hipR=58, kneeR=66,
              shoL=-8, elbL=28, shoR=10, elbR=26)


def man(name, x, y, mail, cloth, spear_mat, skin, mounted=False, shield=True,
        spear=True, cloak=False, weapon='spear', barded=False, pose='idle', kit=0):
    """One figure, built on a skeleton rather than out of boxes.

    Hip, knee, ankle; shoulder, elbow, wrist. Every pose in `STANCE` is a
    table of the angles those joints take, and the limbs are built wherever
    the angles put them — which is what makes a stride a stride, with the
    trailing knee folded and the leading one nearly straight, instead of two
    posts moved apart.

    What he is carrying is placed in the hand that is holding it rather than
    at a fixed point beside him, so a spear comes up and across as the arm
    that owns it does.
    """
    leather = shared('leather', srgb('#45321f'))
    steel = shared('steel', srgb('#a8aab0'))
    # Hose. Legs in mail made a man grey from the neck down and, now that the
    # legs are thin, made them read as two metal rods: the commonest thing a
    # soldier had on his legs was wool, and it is the darkest value on the
    # figure, which is exactly where the eye wants one.
    hose = shared('hose', srgb('#3b382c'))
    legs = mail if kit else hose

    base = 0.0
    if mounted:
        base = horse(name, x, y, spear_mat, cloth, barded)
        angles = dict(SEATED)
    else:
        angles = dict(STANCE.get(pose, STANCE['idle']))

    lean = angles['lean']
    drop = angles['drop']
    falling = pose.startswith('fall')
    fleeing = pose.startswith('flee')
    if fleeing or falling:
        # A man running for the treeline has thrown away what he was
        # carrying. It is the one thing that reads as a rout rather than as
        # a march in the wrong direction — and a man being killed lets go of
        # the same things in the same order.
        shield = False
        spear = False

    # The trunk, tipped forward about the hips. Everything above the waist
    # moves with it, which is why the shoulders and the head are worked out
    # from the lean rather than stacked straight up.
    tip = math.radians(lean)
    def above(height):
        """A point on the spine, `height` up from the hips, after the lean."""
        reach = height - (HIP - drop)
        return (x,
                y + math.sin(tip) * reach,
                base + (HIP - drop) + math.cos(tip) * reach)

    hips = (x, y, base + HIP - drop)
    chest = above(SHOULDER)
    crown = above(NECK)
    head_at = above(SKULL)

    # ---- the legs ----------------------------------------------------------
    for side, hip_angle, knee_bend, tag in (
        (-1, angles['hipL'], angles['kneeL'], 'l'),
        (1, angles['hipR'], angles['kneeR'], 'r'),
    ):
        hip = (x + side * HIP_SPREAD, y, base + HIP - drop)
        knee = swing(hip, hip_angle, THIGH)
        ankle = swing(knee, hip_angle - knee_bend, SHIN)
        limb(f'{name}-thigh-{tag}', hip, knee, 0.032, 0.025, legs)
        limb(f'{name}-shin-{tag}', knee, ankle, 0.024, 0.019, legs)
        if not falling:
            # The boot: the dark the figure needs where it meets the ground.
            toe = (ankle[0], ankle[1] + 0.042, max(base, ankle[2] - 0.018))
            limb(f'{name}-boot-{tag}', (ankle[0], ankle[1] - 0.012, ankle[2]),
                 toe, 0.027, 0.020, leather)

    # ---- the trunk ---------------------------------------------------------
    trunk(f'{name}-pelvis', x, y, base + HIP - drop - 0.030, base + WAIST - drop,
          0.056, 0.038, 0.048, 0.034, mail)
    body = cloth if not kit else mail
    trunk(f'{name}-torso', x, y, base + WAIST - drop, chest[2],
          0.048, 0.034, 0.074, 0.040, body, lean=chest[1] - y)
    if kit:
        # The second man in every two: mail to the chest with a coloured
        # band over it rather than a surcoat all the way down. It is the
        # strongest difference available at this size.
        belt_at = above(WAIST + 0.054)
        trunk(f'{name}-band', x, belt_at[1] - (chest[1] - y) * 0.2,
              belt_at[2], belt_at[2] + 0.054, 0.060, 0.038, 0.066, 0.040, cloth)
    else:
        waist_at = above(WAIST + 0.004)
        trunk(f'{name}-belt', x, waist_at[1], waist_at[2], waist_at[2] + 0.022,
              0.052, 0.037, 0.052, 0.037, leather)
    if cloak:
        # Hung off the shoulders and down the back, which is the one thing
        # that says a man is somebody at this size. Behind him and thin,
        # not around him: a cloak built as a limb came out as a slab of his
        # lord's colours with a head on top, and the man was gone.
        trunk(f'{name}-cloak', x, y + 0.040 + (chest[1] - y) * 0.4,
              base + KNEE + 0.03, chest[2] + 0.014,
              0.054, 0.013, 0.078, 0.017, cloth, 6)

    # ---- the head ----------------------------------------------------------
    limb(f'{name}-neck', crown, (crown[0], crown[1] + 0.004, crown[2] + 0.018),
         0.024, 0.022, skin)
    ball(f'{name}-head', head_at, 0.048, 0.045, 0.052, skin)
    if kit:
        # A conical helm with a nasal rather than a flat-topped one, which is
        # a different silhouette and so tells one man from the next even
        # where the colour does not.
        cone(f'{name}-helm', head_at[0], head_at[1], head_at[2] - 0.016,
             0.052, 0.092, mail, 7)
        limb(f'{name}-nasal', (head_at[0], head_at[1] + 0.038, head_at[2] + 0.028),
             (head_at[0], head_at[1] + 0.040, head_at[2] - 0.030), 0.010, 0.009, mail)
    else:
        ball(f'{name}-helm', (head_at[0], head_at[1], head_at[2] + 0.008),
             0.054, 0.052, 0.050, mail, 3, 8)
        limb(f'{name}-brim', (head_at[0], head_at[1] - 0.004, head_at[2] - 0.019),
             (head_at[0], head_at[1] + 0.004, head_at[2] - 0.014), 0.058, 0.058, leather, 8)

    # ---- the arms ----------------------------------------------------------
    hands = {}
    elbows = {}
    for side, shoulder_angle, elbow_bend, tag in (
        (-1, angles['shoL'], angles['elbL'], 'l'),
        (1, angles['shoR'], angles['elbR'], 'r'),
    ):
        shoulder = (chest[0] + side * SHOULDER_SPREAD, chest[1] - 0.004, chest[2] - 0.012)
        elbow = swing(shoulder, shoulder_angle, UPPER_ARM)
        wrist = swing(elbow, shoulder_angle + elbow_bend, FOREARM)
        limb(f'{name}-upper-{tag}', shoulder, elbow, 0.026, 0.021, mail)
        limb(f'{name}-fore-{tag}', elbow, wrist, 0.021, 0.017, mail)
        ball(f'{name}-hand-{tag}', wrist, 0.021, 0.021, 0.021, skin, 3, 6)
        hands[tag] = wrist
        elbows[tag] = elbow

    if shield:
        board_shield(name, hands['l'], elbows['l'], cloth, kit)

    if spear and weapon != 'none':
        carry(name, weapon, pose, hands, elbows, mail, steel, spear_mat, cloth, leather, base)


def board_shield(name, wrist, elbow, cloth, kit):
    """The shield, on the arm that is carrying it rather than beside him.

    A cross on the face of it, in the realm's second tincture. It is the
    commonest thing a medieval shield carried and the only device that
    survives being eighteen pixels tall — a lion at this size is four dark
    pixels. The bars run right through the board so that whichever face the
    camera has, it has the cross.
    """
    device = device_material()
    # Strapped across the forearm and standing a little out from it, with the
    # face of it turned the way he is: a board that covers a man is broad
    # across him and thin front to back, which is the one thing the first
    # version of this had the wrong way round — it gave every soldier a plank
    # sticking out of his side.
    cx = (wrist[0] + elbow[0]) / 2 - 0.022
    cy = (wrist[1] + elbow[1]) / 2 - 0.008
    cz = (wrist[2] + elbow[2]) / 2 + 0.034
    face = cy - 0.016
    if kit:
        disc = cone(f'{name}-shield', 0, 0, 0, 0.082, 0.024, cloth, 8, 0.92)
        disc.rotation_euler = (math.radians(90), 0, 0)
        disc.location = (cx, cy, cz)
        box(f'{name}-shield-pale', cx, face, cz - 0.074, 0.026, 0.014, 0.148, device)
        box(f'{name}-shield-fess', cx, face, cz - 0.013, 0.148, 0.014, 0.026, device)
    else:
        # A kite: broad at the shoulder and drawn to a point at the foot.
        taper(f'{name}-shield', cx, cy, cz - 0.118, cz + 0.064,
              0.016, 0.013, 0.080, 0.018, cloth)
        box(f'{name}-shield-pale', cx, face, cz - 0.102, 0.024, 0.011, 0.170, device)
        box(f'{name}-shield-fess', cx, face, cz + 0.016, 0.138, 0.011, 0.024, device)


def carry(name, weapon, pose, hands, elbows, mail, steel, timber, cloth, leather, base):
    """What he is holding, held where his hand is.

    The whole of what tells one kind of soldier from another in a silhouette
    this size, and the reason the hand positions are worked out before this
    runs: a spear that is levelled because the arm that owns it came forward
    is a different picture from a spear drawn at a fixed angle beside a man
    who happens to be leaning.
    """
    right = hands['r']
    left = hands['l']
    fighting = pose == 'fight'
    # The hand is over his head in a shout, and a spear that stands on the
    # ground from a hand up there is a spear through his own skull. What is
    # in that hand is brandished: up, forward and well clear of him.
    aloft = pose == 'shout'

    if weapon == 'spear':
        if aloft:
            butt = (right[0] - 0.01, right[1] - 0.20, right[2] - 0.16)
            point = (right[0] + 0.01, right[1] + 0.26, right[2] + 0.30)
        elif fighting:
            butt = (right[0], right[1] - 0.16, right[2] - 0.02)
            point = (right[0], right[1] + 0.40, right[2] + 0.03)
        else:
            butt = (right[0] + 0.004, right[1] - 0.01, base + 0.01)
            point = (right[0] + 0.004, right[1] + 0.01, base + 0.60)
        limb(f'{name}-spear', butt, point, 0.014, 0.012, timber, 5)
        head_to = (point[0] + (point[0] - butt[0]) * 0.16,
                   point[1] + (point[1] - butt[1]) * 0.16,
                   point[2] + (point[2] - butt[2]) * 0.16)
        limb(f'{name}-spear-head', point, head_to, 0.022, 0.004, steel, 5)

    elif weapon == 'pike':
        if aloft:
            butt = (right[0] - 0.01, right[1] - 0.34, right[2] - 0.30)
            point = (right[0] + 0.02, right[1] + 0.42, right[2] + 0.52)
        elif fighting:
            # Brought down to the level: a hedge, not a forest. Both hands on
            # it, which is why it comes across the body.
            butt = (right[0], right[1] - 0.30, right[2] - 0.06)
            point = (right[0] - 0.02, right[1] + 0.70, right[2] + 0.02)
        else:
            butt = (right[0] + 0.004, right[1] - 0.01, base + 0.01)
            point = (right[0] + 0.004, right[1] + 0.01, base + 1.02)
        limb(f'{name}-pike', butt, point, 0.014, 0.011, timber, 5)
        head_to = (point[0] + (point[0] - butt[0]) * 0.1,
                   point[1] + (point[1] - butt[1]) * 0.1,
                   point[2] + (point[2] - butt[2]) * 0.1)
        limb(f'{name}-pike-head', point, head_to, 0.020, 0.004, steel, 5)

    elif weapon == 'sword':
        # Raised, because a sword held down is a stick against the leg.
        high = 0.10 if fighting else 0.0
        tip = (right[0] + 0.012, right[1] - 0.03 + high * 0.4, right[2] + 0.24 + high)
        limb(f'{name}-grip', right, (right[0] + 0.004, right[1] - 0.008, right[2] + 0.046),
             0.015, 0.014, leather, 5)
        limb(f'{name}-sword', (right[0] + 0.004, right[1] - 0.008, right[2] + 0.046),
             tip, 0.017, 0.009, steel, 4)
        limb(f'{name}-guard', (right[0] - 0.052, right[1] - 0.008, right[2] + 0.044),
             (right[0] + 0.060, right[1] - 0.008, right[2] + 0.044), 0.009, 0.009, steel, 4)

    elif weapon == 'bow':
        # A stave taller than he is, held out in the left hand. No shield
        # goes with it, and that absence is half of what says archer. Drawn,
        # the stave comes across the body and the right hand goes to the ear.
        if fighting:
            top = (left[0], left[1] + 0.02, left[2] + 0.30)
            foot = (left[0], left[1] - 0.02, left[2] - 0.30)
            limb(f'{name}-bow', foot, top, 0.009, 0.009, timber, 4)
            limb(f'{name}-string', foot, right, 0.004, 0.004, skin_thread(), 3)
            limb(f'{name}-string-b', right, top, 0.004, 0.004, skin_thread(), 3)
            limb(f'{name}-arrow', (right[0], right[1] - 0.02, right[2]),
                 (left[0], left[1] + 0.03, left[2] + 0.01), 0.006, 0.006, timber, 3)
        else:
            top = (left[0] + 0.01, left[1], left[2] + 0.32)
            foot = (left[0] + 0.01, left[1], left[2] - 0.28)
            limb(f'{name}-bow', foot, top, 0.009, 0.009, timber, 4)
            limb(f'{name}-string', foot, top, 0.004, 0.004, skin_thread(), 3)
        limb(f'{name}-quiver', (left[0] - 0.02, left[1] - 0.09, base + 0.30),
             (left[0] - 0.03, left[1] - 0.12, base + 0.46), 0.024, 0.022, leather, 5)

    elif weapon == 'crossbow':
        # Held level across the chest: a cross shape, which is exactly how
        # the thing was recognised. Brought up to the shoulder to shoot.
        mid = ((right[0] + left[0]) / 2, (right[1] + left[1]) / 2 + 0.02,
               (right[2] + left[2]) / 2 + (0.05 if fighting else 0.0))
        if aloft:
            # One hand is over his head. A crossbow slung between it and the
            # other would stand on end, so it hangs off the hand that stayed.
            mid = (left[0] + 0.040, left[1] + 0.030, left[2] + 0.050)
        limb(f'{name}-stock', (mid[0], mid[1] - 0.14, mid[2] - 0.01),
             (mid[0], mid[1] + 0.16, mid[2]), 0.016, 0.012, timber, 4)
        limb(f'{name}-prod', (mid[0] - 0.15, mid[1] + 0.12, mid[2]),
             (mid[0] + 0.15, mid[1] + 0.12, mid[2]), 0.012, 0.012, steel, 4)

    elif weapon == 'gun':
        mid = ((right[0] + left[0]) / 2 + 0.01, (right[1] + left[1]) / 2,
               (right[2] + left[2]) / 2 + 0.06)
        if aloft:
            mid = (left[0] + 0.045, left[1] + 0.020, left[2] + 0.060)
        limb(f'{name}-butt', (mid[0], mid[1] - 0.17, mid[2] - 0.03),
             (mid[0], mid[1] - 0.04, mid[2] - 0.01), 0.022, 0.016, leather, 5)
        limb(f'{name}-barrel', (mid[0], mid[1] - 0.04, mid[2] - 0.01),
             (mid[0], mid[1] + 0.24, mid[2] + 0.02), 0.014, 0.012, steel, 5)
        limb(f'{name}-rest', (mid[0] + 0.07, mid[1] + 0.16, base),
             (mid[0] + 0.05, mid[1] + 0.14, mid[2]), 0.010, 0.010, timber, 4)

    elif weapon == 'lance':
        # Couched: tucked under the arm and run forward past the horse's head.
        tuck = (elbows['r'][0] + 0.012, elbows['r'][1] - 0.16, elbows['r'][2] - 0.01)
        point = (right[0] + 0.004, right[1] + 0.74, right[2] + 0.02)
        if aloft:
            tuck = (right[0] - 0.01, right[1] - 0.26, right[2] - 0.22)
            point = (right[0] + 0.02, right[1] + 0.36, right[2] + 0.42)
        elif pose != 'fight':
            point = (right[0] + 0.07, right[1] + 0.22, right[2] + 0.62)
        limb(f'{name}-lance', tuck, point, 0.016, 0.011, timber, 5)
        head_to = (point[0] + (point[0] - tuck[0]) * 0.1,
                   point[1] + (point[1] - tuck[1]) * 0.1,
                   point[2] + (point[2] - tuck[2]) * 0.1)
        limb(f'{name}-lance-head', point, head_to, 0.020, 0.004, steel, 5)
        pennon = (point[0] + (tuck[0] - point[0]) * 0.22,
                  point[1] + (tuck[1] - point[1]) * 0.22,
                  point[2] + (tuck[2] - point[2]) * 0.22)
        box(f'{name}-pennon', pennon[0], pennon[1], pennon[2], 0.012, 0.09, 0.07, cloth)


def skin_thread():
    """A bowstring, which is the one thing on the sheet that is almost nothing."""
    return shared('cord', srgb('#cfc4a8'))


def horse(name, x, y, hide, cloth, barded):
    """The animal under him, built the same way the man is.

    Four legs with knees in them, a barrel that is deeper than it is wide, a
    neck that rises and a head that comes down off it. A horse is the other
    half of a cavalry silhouette and it used to be a box on four posts.

    Returns how high the saddle is, which is where the rider is built from.
    """
    leather = shared('leather', srgb('#45321f'))
    # A horse is longer than a man is tall and stands as high at the withers
    # as he does at the shoulder, which the box on four posts never was: it
    # was a pony, and the rider sat on it like a man on a stool.
    back = 0.435
    belly = 0.315
    # The barrel, nose to tail, with the chest deeper than the flank.
    trunk(f'{name}-barrel', x, y - 0.01, belly - 0.020, back,
          0.092, 0.275, 0.084, 0.262, hide)
    limb(f'{name}-chest', (x, y + 0.255, belly + 0.02), (x, y + 0.295, back - 0.03),
         0.082, 0.064, hide, 6)
    limb(f'{name}-croup', (x, y - 0.255, back - 0.01), (x, y - 0.315, back - 0.09),
         0.080, 0.058, hide, 6)
    # Neck and head, which is what a horse is recognised by at any size.
    withers = (x, y + 0.262, back - 0.005)
    poll = (x, y + 0.360, back + 0.160)
    limb(f'{name}-neck', withers, poll, 0.060, 0.036, hide, 6)
    muzzle = (x, y + 0.455, back + 0.092)
    limb(f'{name}-head', poll, muzzle, 0.036, 0.024, hide, 6)
    limb(f'{name}-tail', (x, y - 0.312, back - 0.02), (x, y - 0.375, belly - 0.14),
         0.024, 0.010, hide, 5)
    # The legs: a hock halfway down each, so they are not four posts.
    for i, (dx, dy, fore) in enumerate((
        (-0.066, 0.215, True), (0.066, 0.215, True),
        (-0.066, -0.205, False), (0.066, -0.205, False),
    )):
        top = (x + dx, y + dy, belly + 0.01)
        hock = (x + dx, y + dy + (0.014 if fore else -0.026), belly - 0.155)
        hoof = (x + dx, y + dy + (0.004 if fore else 0.014), 0.0)
        limb(f'{name}-upper-{i}', top, hock, 0.040, 0.025, hide, 5)
        limb(f'{name}-lower-{i}', hock, hoof, 0.023, 0.018, hide, 5)
    if barded:
        # A trapper over the horse in his lord's colours, which is what tells
        # a knight from a man on a horse at any distance.
        trunk(f'{name}-bard', x, y - 0.01, belly - 0.085, back - 0.01,
              0.106, 0.268, 0.098, 0.256, cloth)
        limb(f'{name}-chamfron', (x, y + 0.365, back + 0.155), (x, y + 0.445, back + 0.098),
             0.040, 0.030, cloth, 6)
    # The saddle, and the height it puts him at.
    trunk(f'{name}-saddle', x, y - 0.015, back - 0.012, back + 0.024,
          0.074, 0.112, 0.062, 0.094, leather, 6)
    return back + 0.034 - HIP


def spin(degrees):
    """Turns everything built so far about the world's vertical.

    The camera cannot move — the whole picture depends on it not moving — so
    a man who faces a different way is a man built facing a different way.
    Four turns of ninety degrees give the four directions the screen reads as
    diagonals, which is as many as a figure this size can carry and enough
    for a line to visibly face the line it is fighting.
    """
    if not degrees:
        return
    # `matrix_basis`, not `matrix_world`. The world matrix is worked out by
    # the dependency graph and is stale until Blender decides to run it, so
    # reading it here lost the location and rotation of anything that had
    # been placed by setting them on the object — which is why a lance at any
    # direction but the first stood upright in front of the knight instead of
    # being couched, why a drawn bow lay across its archer as a plank, and
    # why every round shield on the sheet lay on the ground at its owner's
    # feet. The basis is composed from the object's own location, rotation
    # and scale, so it is never stale, and nothing here is parented to
    # anything, which is what makes the two the same thing when both are
    # right.
    turn = mathutils.Matrix.Rotation(math.radians(degrees), 4, 'Z')
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.matrix_world = turn @ obj.matrix_basis


def pitch(degrees):
    """Tips everything built so far forward onto its face.

    `spin` turns a figure about the vertical, which is how he faces a
    different way. This turns him about the axis across the picture, which is
    how he falls: he goes over the way he was facing, and because the turn
    happens before the spin, a man facing down the screen falls down the
    screen. The pivot is the world origin, which is the ground under his own
    feet, so he pivots on his boots rather than about his waist.
    """
    if not degrees:
        return
    # `matrix_basis` for the same reason it is used in `spin`.
    turn = mathutils.Matrix.Rotation(math.radians(-degrees), 4, 'X')
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.matrix_world = turn @ obj.matrix_basis


def palette_for_men():
    """The materials every figure is made of, in one place."""
    return (
        material('mail', srgb('#5a5852')),
        material('cloth', MARKER),
        material('timber', srgb('#4a3222')),
        material('skin', srgb('#b98f6a')),
    )


def device_material():
    """The realm's second tincture, for what is painted on the shield."""
    return shared('device', DEVICE)


def soldiers(mounted):
    """A body of men as the map shows one: ranks of figures under a standard.

    Ranks rather than a row, because a row of figures seen from this angle is
    a picket fence. Two ranks with the back one offset reads as a crowd at
    any size.
    """
    clear()
    mail, cloth, timber, skin = palette_for_men()
    across, deep = (3, 2) if mounted else (4, 2)
    pitch = 0.4 if mounted else 0.27
    for row in range(deep):
        for i in range(across):
            x = (i - (across - 1) / 2) * pitch + (0.5 * pitch if row else 0)
            y = -row * (0.5 if mounted else 0.3)
            man(f'm{row}-{i}', x, y, mail, cloth, timber, skin, mounted)
    banner('standard', 0, -deep * 0.32 - 0.22, 0, 1.05, timber, cloth)
    return 1.0 if not mounted else 1.25


def oneMan(mounted):
    """A single figure, for the battlefield, where there are hundreds."""
    clear()
    mail, cloth, timber, skin = palette_for_men()
    man('one', 0, 0, mail, cloth, timber, skin, mounted)
    return 0.62 if not mounted else 0.82


def fighter(weapon, mounted=False, shield=True, barded=False, pose='idle', facing=0, kit=0):
    """One soldier of a given kind.

    A battle used to be fought by one figure repeated: the same man with the
    same spear whether he was a Genoese crossbowman or a Scots pikeman. The
    simulation has always known which; this is the sheet catching up, and it
    costs one render each because the models are built from the same dozen
    boxes with a different thing in the hand.
    """
    clear()
    mail, cloth, timber, skin = palette_for_men()
    man('one', 0, 0, mail, cloth, timber, skin, mounted,
        shield=shield, weapon=weapon, barded=barded, pose=pose, kit=kit)
    # Direction 0 is the man as built, which the camera reads as facing up
    # and to the right; the rest follow clockwise round the screen in eighths.
    # Eight rather than four because four means a regiment wheeling turns in
    # right angles, and a line of battle spends most of its time at an angle
    # to the line it is fighting.
    spin((360 - facing * 45) % 360)
    tall = {'pike': 1.05, 'bow': 0.72}.get(weapon, 0.62)
    return tall if not mounted else 1.02


def falling(pose, facing, kit):
    """A man in the act of being killed.

    Every other pose on this sheet is rendered once per kind of soldier,
    because what a man is carrying is the whole of what tells a crossbowman
    from a pikeman. This one is not, and that is the point: the first things
    a man lets go of are his shield and his weapon, so a spearman going down
    and an archer going down are the same picture. It is also why a knight
    has no horse here. He is coming off it.

    Two frames — buckling, then nearly flat — and the third is the body
    itself, which `fallen` has drawn since the first commit.
    """
    clear()
    mail, cloth, timber, skin = palette_for_men()
    man('one', 0, 0, mail, cloth, timber, skin, pose=pose, kit=kit)
    pitch(30 if pose == 'fall-a' else 62)
    spin((360 - facing * 45) % 360)
    return 0.8


def general(mounted):
    """The man himself.

    A captain is a regiment; a general is a person, and on a map of a
    continent he is the only person drawn. So he gets what the others do not:
    a cloak off the shoulders, a crest on the helmet, his own standard
    planted beside him, and no spear, because what he is carrying is a sword
    and at this size a sword is not worth a box.
    """
    clear()
    mail, cloth, timber, skin = palette_for_men()
    man('gen', 0, 0, mail, cloth, timber, skin, mounted,
        shield=True, spear=False, cloak=True)
    base = 0.41 if mounted else 0.0
    # The crest, which is the only thing that distinguishes him in silhouette.
    cone('crest', 0, 0, base + 0.53, 0.05, 0.1, cloth, 4)
    # Well out to his left, not behind his head: planted close, the cloth and
    # the crest run into one magenta smudge and the man disappears inside his
    # own heraldry.
    banner('standard', -0.32, 0.04, 0, 0.72 + base, timber, cloth, width=0.2)
    return 0.72 if not mounted else 0.92


def fallen(variant):
    """A body, lying where it dropped.

    The dead used to be a dark mark a man. A mark says how much of a field
    has been fought over, which is most of what the eye wants, but it does
    not say what is lying there, and on ground drawn this closely it reads as
    a stain rather than as a man. This is a man: on his back, arms out, his
    surcoat still in his lord's colours and his shield where it fell.

    Two of them, turned differently, because a field strewn with the same
    body repeated is a pattern and nothing reads as a pattern less than the
    aftermath of a fight.
    """
    clear()
    mail, cloth, timber, skin = palette_for_men()
    leather = shared('leather', srgb('#45321f'))
    hose = shared('hose', srgb('#3b382c'))
    turn = 0.32 if variant else -0.26
    # Laid out along y, which the camera reads as lying across the picture,
    # and built out of the same joints he had standing up: a knee that is
    # still bent under him, an arm thrown out, a head fallen off to one side.
    # A body with the same bones as the men around it is the thing that makes
    # a field after a fight read as men rather than as marks.
    deep = 0.028
    for side, tag, splay in ((-1, 'l', 0.06 if variant else 0.11),
                             (1, 'r', 0.12 if variant else 0.05)):
        hip = (side * 0.042, -0.07, deep)
        knee = (side * (0.042 + splay), -0.21, deep)
        ankle = (side * (0.042 + splay * 0.4), -0.335, deep)
        limb(f'thigh-{tag}', hip, knee, 0.032, 0.025, hose)
        limb(f'shin-{tag}', knee, ankle, 0.024, 0.019, hose)
        limb(f'boot-{tag}', ankle, (ankle[0], ankle[1] - 0.038, deep + 0.012),
             0.025, 0.019, leather)
    trunk('pelvis', 0, -0.055, deep - 0.030, deep + 0.030, 0.056, 0.048, 0.050, 0.044, mail)
    # The trunk lies along y rather than standing up z, so it is built as a
    # limb between the hips and the shoulders instead of as a tapered post.
    limb('torso', (0, -0.055, deep), (0, 0.095, deep + 0.004), 0.050, 0.072, cloth, 8)
    for side, tag, out in ((-1, 'l', 0.055), (1, 'r', 0.04)):
        shoulder = (side * 0.066, 0.075, deep)
        elbow = (side * (0.066 + out), 0.015 if variant else 0.105, deep - 0.004)
        wrist = (side * (0.066 + out * 1.7), -0.055 if variant else 0.155, deep - 0.006)
        limb(f'upper-{tag}', shoulder, elbow, 0.026, 0.021, mail)
        limb(f'fore-{tag}', elbow, wrist, 0.021, 0.017, mail)
        ball(f'hand-{tag}', wrist, 0.020, 0.020, 0.018, skin, 3, 6)
    head_at = (0.02 if variant else -0.03, 0.165, deep + 0.012)
    ball('head', head_at, 0.046, 0.046, 0.040, skin)
    ball('helm', (head_at[0], head_at[1] + 0.006, head_at[2] + 0.016),
         0.050, 0.050, 0.036, mail, 3, 8)
    if variant:
        # The shield where it fell, with the same cross on it he was
        # carrying when he was standing up.
        taper('shield', -0.185, -0.045, deep - 0.01, deep + 0.012,
              0.052, 0.082, 0.052, 0.082, cloth)
        box('shield-pale', -0.185, -0.045, deep + 0.012, 0.020, 0.155, 0.006, device_material())
    else:
        limb('spear', (0.145, -0.25, deep - 0.006), (0.195, 0.27, deep - 0.006),
             0.013, 0.011, timber, 5)
    spin(math.degrees(turn) * 3)
    return 0.46


def engine(pose):
    """A throwing engine, and the two men who work it.

    The siege class has been in the game since the first commit and had no
    model, so a trebuchet was drawn as a swordsman: five kinds of engine
    turning up on the field as infantry. There are two silhouettes worth
    having and these are both of them. This is the older one — a frame, an
    axle and an arm — and it covers the ballista, the catapult and the
    trebuchet, which differ in how they are sprung and not in what they look
    like from four hundred metres.

    Unlike every other figure on the sheet this one comes with its crew in
    it. An engine is a machine and a gun team, never one or the other, and
    one stamp that is both is cheaper and truer than a machine with men
    arranged around it by the renderer.
    """
    clear()
    mail, cloth, timber, skin = palette_for_men()
    iron = material('iron', srgb('#55534d'))
    loosed = pose == 'fight'
    # The bed: two sleepers along y with a cross-piece at the back.
    box('sleeper-l', -0.17, 0, 0.02, 0.07, 0.68, 0.07, timber)
    box('sleeper-r', 0.17, 0, 0.02, 0.07, 0.68, 0.07, timber)
    box('cross-back', 0, -0.28, 0.05, 0.41, 0.08, 0.06, timber)
    box('cross-front', 0, 0.28, 0.05, 0.41, 0.08, 0.06, timber)
    # The uprights the arm swings between, braced back to the bed.
    box('post-l', -0.17, 0.02, 0.09, 0.08, 0.08, 0.46, timber)
    box('post-r', 0.17, 0.02, 0.09, 0.08, 0.08, 0.46, timber)
    for side, x in (('l', -0.17), ('r', 0.17)):
        brace = box(f'brace-{side}', 0, 0, 0, 0.05, 0.05, 0.42, timber)
        brace.rotation_euler = (math.radians(38), 0, 0)
        brace.location = (x, -0.14, 0.06)
    box('axle', 0, 0.02, 0.52, 0.44, 0.07, 0.07, iron)
    # The arm: cocked back down the bed, or thrown over the axle and still
    # swinging. One picture of each is the whole of what a loosing engine
    # needs, and the difference reads at twenty pixels.
    arm = box('arm', 0, 0, 0, 0.06, 0.06, 0.66, timber)
    arm.rotation_euler = (math.radians(-34 if loosed else 125), 0, 0)
    arm.location = (0, 0.02, 0.54)
    # The sling at the end of it, and the weight at the other.
    if loosed:
        box('sling', 0, 0.42, 0.78, 0.09, 0.11, 0.03, cloth)
        box('shot', 0, 0.5, 0.86, 0.09, 0.09, 0.09, iron)
    else:
        box('sling', 0, -0.44, 0.14, 0.09, 0.12, 0.03, cloth)
        box('shot', 0, -0.44, 0.08, 0.1, 0.1, 0.1, iron)
    box('weight', 0, 0.06, 0.2 if loosed else 0.62, 0.17, 0.15, 0.17, iron)
    # The crew. Out to the sides, because a man standing in front of the arm
    # is a man the arm is about to go through.
    man('crew-l', -0.38, -0.06, mail, cloth, timber, skin,
        shield=False, spear=False, weapon='none', pose='fight' if loosed else 'idle')
    man('crew-r', 0.38, 0.04, mail, cloth, timber, skin,
        shield=False, spear=False, weapon='none', pose='idle')
    return 1.0


def cannon(pose):
    """A gun on a timber bed, and the man who touches it off.

    The other siege silhouette, and the one the late game is fought with: a
    bombard or a culverin is a barrel lying in a cradle, which is nothing
    like a frame with an arm on it. A gun that has just fired says so with
    its own smoke, and that is the only light the sheet draws anywhere —
    everything else here is lit by the sun.
    """
    clear()
    mail, cloth, timber, skin = palette_for_men()
    iron = material('iron', srgb('#4b4a46'))
    bronze = material('bronze', srgb('#8f7038'))
    firing = pose == 'fight'
    # The cradle, raked up towards the muzzle.
    box('bed', 0, 0, 0.08, 0.3, 0.66, 0.1, timber)
    box('trail', 0, -0.36, 0.05, 0.16, 0.14, 0.09, timber)
    for side, x in (('l', -0.19), ('r', 0.19)):
        wheel = cone(f'wheel-{side}', 0, 0, 0, 0.14, 0.05, timber, 10, 0.9)
        wheel.rotation_euler = (math.radians(90), 0, 0)
        wheel.location = (x, 0.06, 0.14)
    # The barrel, with the reinforcing rings a cast gun was banded with.
    barrel = box('barrel', 0, 0, 0, 0.13, 0.62, 0.13, bronze)
    barrel.rotation_euler = (math.radians(-7), 0, 0)
    barrel.location = (0, 0.02, 0.23)
    for i, at in enumerate((-0.2, 0.0, 0.2)):
        ring = box(f'ring-{i}', 0, 0, 0, 0.15, 0.045, 0.15, iron)
        ring.rotation_euler = (math.radians(-7), 0, 0)
        ring.location = (0, 0.02 + at, 0.23 + at * 0.12)
    box('breech', 0, -0.3, 0.22, 0.15, 0.1, 0.15, iron)
    if firing:
        # The muzzle flash, and the smoke off it. Not the owner's colour:
        # powder smoke belonged to nobody.
        flame = material('flame', srgb('#ffdf9c'), emissive=True)
        smoke = material('smoke', srgb('#b9b4a8'))
        cone('flash', 0, 0.46, 0.25, 0.09, 0.26, flame, 6)
        box('smoke-a', 0, 0.56, 0.2, 0.19, 0.19, 0.18, smoke)
        box('smoke-b', 0.04, 0.74, 0.26, 0.14, 0.14, 0.14, smoke)
    # The gunner, standing off to the side of the breech where the recoil is
    # not, with the linstock he fired it with.
    man('gunner', -0.36, -0.2, mail, cloth, timber, skin,
        shield=False, spear=False, weapon='none', pose='fight' if firing else 'idle')
    box('linstock', -0.26, -0.14, 0.2, 0.025, 0.3, 0.025, timber)
    man('loader', 0.36, -0.12, mail, cloth, timber, skin,
        shield=False, spear=False, weapon='none', pose='idle')
    return 1.0


def agent():
    """A hooded man on foot: no mail, no banner, nothing to identify him."""
    clear()
    cloak = material('cloak', MARKER)
    dark = material('dark', srgb('#3b372f'))
    skin = material('skin', srgb('#b98f6a'))
    # Built on the same joints as a soldier so that he reads as the same
    # species standing in the same province, with everything that says
    # soldier taken off him: no mail, no shield, no colour but the cloak.
    for side, tag in ((-1, 'l'), (1, 'r')):
        hip = (side * 0.034, 0, HIP)
        knee = swing(hip, side * 5, THIGH)
        ankle = swing(knee, side * 5 - 6, SHIN)
        limb(f'thigh-{tag}', hip, knee, 0.030, 0.024, dark)
        limb(f'shin-{tag}', knee, ankle, 0.023, 0.018, dark)
        limb(f'boot-{tag}', (ankle[0], ankle[1] - 0.012, ankle[2]),
             (ankle[0], ankle[1] + 0.040, 0.012), 0.026, 0.019, dark)
    # The cloak: one shape from the shoulders to the shins, which is what a
    # man who does not want to be recognised looks like from any distance.
    trunk('cloak', 0, 0, KNEE + 0.02, SHOULDER + 0.01, 0.084, 0.064, 0.072, 0.050, cloak)
    limb('arm', (0.058, -0.004, SHOULDER - 0.01), (0.082, 0.052, SHOULDER - 0.21),
         0.028, 0.022, cloak)
    ball('face', (0, 0.012, SKULL - 0.01), 0.042, 0.040, 0.046, skin)
    cone('hood', 0, -0.004, SKULL - 0.055, 0.058, 0.115, dark, 7)
    limb('staff', (0.096, -0.012, 0.004), (0.112, 0.004, 0.62), 0.012, 0.010, dark, 5)
    return 0.62


def caravan():
    """A pack animal under its load, with the load in the owner's colours."""
    clear()
    beast = material('beast', srgb('#5b452c'))
    load = material('load', MARKER)
    # A mule on the same bones as the warhorse, shorter in the leg and
    # heavier in the barrel, with the load where a rider would be.
    back = 0.30
    belly = 0.205
    trunk('body', 0, -0.01, belly - 0.020, back, 0.082, 0.215, 0.076, 0.205, beast)
    limb('chest', (0, 0.195, belly + 0.02), (0, 0.228, back - 0.02), 0.070, 0.056, beast, 6)
    limb('croup', (0, -0.198, back - 0.01), (0, -0.244, back - 0.07), 0.068, 0.050, beast, 6)
    withers = (0, 0.205, back - 0.005)
    poll = (0, 0.272, back + 0.118)
    limb('neck', withers, poll, 0.050, 0.032, beast, 6)
    limb('head', poll, (0, 0.348, back + 0.064), 0.032, 0.022, beast, 6)
    limb('tail', (0, -0.242, back - 0.02), (0, -0.282, belly - 0.10), 0.018, 0.008, beast, 5)
    for i, (dx, dy, fore) in enumerate((
        (-0.056, 0.165, True), (0.056, 0.165, True),
        (-0.056, -0.158, False), (0.056, -0.158, False),
    )):
        top = (dx, dy, belly + 0.01)
        hock = (dx, dy + (0.010 if fore else -0.020), belly - 0.105)
        hoof = (dx, dy + (0.004 if fore else 0.010), 0.0)
        limb(f'upper-{i}', top, hock, 0.033, 0.021, beast, 5)
        limb(f'lower-{i}', hock, hoof, 0.020, 0.016, beast, 5)
    # The load, which is the part that belongs to whoever is trading.
    trunk('pack', 0, -0.01, back - 0.012, back + 0.098, 0.078, 0.124, 0.070, 0.110, load, 6)
    return 0.58


def hull(name, length, beam, depth, mat, bluff=False, stations=13):
    """A hull, lofted from a line of cross-sections.

    What was here was a box with two smaller boxes on it, and at the size the
    sea fight draws a ship that is a crate with a stick in it. A hull is the
    one shape everybody knows by heart — drawn to a point at both ends, wider
    amidships than anywhere else, with a deck line that sweeps up fore and
    aft — and none of those three things survive being a box.

    Five points to a section: the keel, two bilges and two gunwales. Enough
    for the bottom to be a V and the sides to stand up off it, which is the
    whole of a hull at this scale.
    """
    verts = []
    for i in range(stations):
        u = -1.0 + 2.0 * i / (stations - 1)
        reach = abs(u)
        if bluff:
            # A round ship is full in the ends and carries her beam a long
            # way forward: a merchantman was built to hold cargo.
            half = beam * (1.0 - 0.86 * reach ** 3.2) ** 0.5
        else:
            # A galley is drawn out to a point both ends.
            half = beam * (1.0 - reach ** 2.1)
        half = max(half, beam * 0.045)
        # The sheer, which is the line of the deck: lowest amidships.
        deck = depth * (1.0 + (0.52 if bluff else 0.40) * reach ** 1.7)
        # And the rocker, which lifts the keel out of the water at the ends.
        keel = depth * 0.46 * reach ** 2.4
        y = u * length / 2
        verts.extend([
            (0.0, y, keel),
            (-half * 0.92, y, keel + (deck - keel) * 0.42),
            (-half, y, deck),
            (half, y, deck),
            (half * 0.92, y, keel + (deck - keel) * 0.42),
        ])
    faces = []
    for i in range(stations - 1):
        a = i * 5
        b = (i + 1) * 5
        for j in range(4):
            faces.append((a + j, a + j + 1, b + j + 1, b + j))
        # The deck, closing the section across the top.
        faces.append((a + 3, a + 2, b + 2, b + 3))
    faces.append((0, 1, 2, 3, 4))
    last = (stations - 1) * 5
    faces.append((last + 4, last + 3, last + 2, last + 1, last))
    return mesh_from(name, verts, faces, mat)


def sail(name, width, drop, at, mat, belly=0.26, panels=5):
    """A square sail with the wind in it.

    A flat quad is a sheet of paper. Three or four panels curved away from
    the yard is a sail, and the curve is the only thing in the rig that says
    the ship is moving rather than moored.
    """
    verts = []
    for i in range(panels + 1):
        t = i / panels
        across = (t - 0.5) * 2
        x = across * width / 2
        # The whole cloth stands clear of the mast and bellies forward from
        # there. Hung on the mast's own line it bulged through it, and the
        # spar came out of the middle of the sail like a seam: two sails
        # where there is one.
        bow = belly * (0.35 + 0.65 * (1 - across * across))
        verts.append((x, at[1] + bow * 0.55, at[2]))
        verts.append((x, at[1] + bow, at[2] - drop))
    faces = []
    for i in range(panels):
        a = i * 2
        faces.append((a, a + 2, a + 3, a + 1))
    return mesh_from(name, verts, faces, mat)


def vessel(oared):
    """A galley with her oars out, or a round ship under sail."""
    clear()
    oak = material('oak', srgb('#6b4a28'))
    dark = material('wale', srgb('#4a3119'))
    cloth = material('cloth', MARKER)
    rope = shared('cord', srgb('#cfc4a8'))
    length = 1.5 if oared else 1.0
    beam = 0.115 if oared else 0.225
    depth = 0.17 if oared else 0.24

    hull(f'hull', length, beam, depth, oak, bluff=not oared)
    # The wale: one dark course along the sheer each side. It costs two
    # pieces and it is what gives a hull an edge instead of a gradient.
    for side in (-1, 1):
        limb(f'wale-{side}', (side * beam * 0.98, -length * 0.40, depth * 1.03),
             (side * beam * 0.98, length * 0.40, depth * 1.03), 0.016, 0.016, dark, 4)
    # Stem and sternpost, which are most of a ship's profile.
    limb('stem', (0, length * 0.47, depth * 0.9),
         (0, length * 0.52, depth * (2.1 if oared else 1.9)), 0.020, 0.013, oak, 5)
    limb('post', (0, -length * 0.47, depth * 0.9),
         (0, -length * 0.53, depth * (1.9 if oared else 2.2)), 0.020, 0.014, oak, 5)

    if oared:
        # The ram, low and forward, which is what the hull was built around.
        limb('ram', (0, length * 0.44, depth * 0.34),
             (0, length * 0.55, depth * 0.20), 0.034, 0.014, dark, 5)
        # Oars, out and back and down to the water, with blades on them. The
        # angle is the whole of it: level oars are a comb, oars raked aft are
        # a ship being pulled.
        for i in range(8):
            y = -length * 0.28 + i * length * 0.078
            for side in (-1, 1):
                loom = (side * beam * 0.95, y + length * 0.03, depth * 1.0)
                tip = (side * beam * 2.5, y - length * 0.16, depth * 0.12)
                limb(f'oar-{side}-{i}', loom, tip, 0.011, 0.008, oak, 4)
                limb(f'blade-{side}-{i}', tip,
                     (side * beam * 2.8, y - length * 0.21, -depth * 0.10),
                     0.020, 0.013, dark, 4)
        # A gangway down the middle, between the benches, and the benches.
        taper('gangway', 0, 0, depth * 1.02, depth * 1.12,
              beam * 0.28, length * 0.34, beam * 0.26, length * 0.34, oak)
        for i in range(6):
            y = -length * 0.26 + i * length * 0.10
            taper(f'bench-{i}', 0, y, depth * 1.0, depth * 1.06,
                  beam * 0.92, 0.022, beam * 0.92, 0.022, dark)
        # And the fighting deck aft, where the men who are not rowing stand.
        taper('aftdeck', 0, -length * 0.36, depth * 1.0, depth * 1.42,
              beam * 0.74, length * 0.085, beam * 0.52, length * 0.070, oak)
        limb('aftrail', (-beam * 0.54, -length * 0.36, depth * 1.44),
             (beam * 0.54, -length * 0.36, depth * 1.44), 0.012, 0.012, dark, 4)
    else:
        # Castles fore and aft, which is what a merchantman put up when it
        # had to fight, and what tells her from a galley at any distance.
        for tag, y, high in (('fore', length * 0.33, 0.44), ('aft', -length * 0.34, 0.56)):
            taper(f'{tag}castle', 0, y, depth * 1.08, depth * (1.08 + high),
                  beam * 0.78, length * 0.11, beam * 0.62, length * 0.09, oak)
            limb(f'{tag}rail', (-beam * 0.64, y, depth * (1.10 + high)),
                 (beam * 0.64, y, depth * (1.10 + high)), 0.013, 0.013, dark, 4)

    # The rig. A mast with a yard across it, two shrouds a side, and a sail
    # with the wind in it — in the owner's colours on a merchantman, plain on
    # a galley, because a war galley's sail came down before she fought.
    masthead = depth * (4.6 if oared else 4.2)
    limb('mast', (0, 0, depth * 0.95), (0, 0, masthead), 0.022, 0.014, oak, 6)
    yard_half = beam * (2.5 if oared else 1.85)
    yard_z = masthead * 0.82
    limb('yard', (-yard_half, 0.01, yard_z), (yard_half, 0.01, yard_z), 0.012, 0.012, oak, 4)
    for side in (-1, 1):
        for fore, at in (('f', length * 0.17), ('a', -length * 0.19)):
            limb(f'shroud-{side}{fore}', (0.004 * side, 0, masthead * 0.86),
                 (side * beam * 0.92, at, depth * 1.05), 0.004, 0.004, rope, 3)
    # In the owner's colours on both, because a fleet seen from a map of
    # Europe is four marks on the water and the sail is the only part of one
    # big enough to carry a colour at all.
    sail('sail', yard_half * 2 * 0.94, masthead * (0.42 if oared else 0.5),
         (0, 0.045, yard_z - 0.01), cloth,
         belly=beam * (1.1 if oared else 0.95))
    # Her colours at the masthead, which is how a fleet is read at all.
    banner('ensign', 0, -length * 0.50, depth * (1.9 if oared else 2.2),
           depth * 2.4, oak, cloth, width=0.22)
    # The frame has to follow the model. Returning the same radius for a
    # forty-metre galley and a short round ship drew the round ship at a
    # third of its size, because the sprite is framed on this number and the
    # game stamps every sprite as a square of the same side.
    return max(length, 1.0) * 0.78


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

def tweak(holder, name, value):
    """Sets a render setting if this Blender has one by that name.

    EEVEE's options move between releases — the ambient occlusion that was a
    checkbox in one version is a corner of the ray tracing panel in the next.
    The sheet has to keep building on whatever is installed, so anything that
    is a nicety rather than a requirement is set through here and skipped
    where it does not exist.
    """
    if holder is not None and hasattr(holder, name):
        setattr(holder, name, value)
        return True
    return False


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

    # Shadows and the short-range darkening in a corner. A figure is two
    # dozen boxes pushed into each other, and without either of them the
    # seams between them do not exist: an arm against a chest is the same
    # value as the chest, so the whole man flattens into a silhouette with
    # some colours on it. This is the single thing that makes him read as
    # having a front, a side and a gap under his arm.
    # Which of them this Blender actually had, so a sheet that comes out
    # flat is traceable to the version that built it rather than to the
    # models.
    report = []
    def note(name, ok):
        report.append(f'{name}={"set" if ok else "missing"}')
        return ok
    note('shadows', tweak(scene.eevee, 'use_shadows', True))
    note('raytracing', tweak(scene.eevee, 'use_raytracing', True))
    note('fast gi', tweak(scene.eevee, 'use_fast_gi', True))
    tweak(scene.eevee, 'fast_gi_resolution', '1')
    tweak(getattr(scene.eevee, 'ray_tracing_options', None), 'use_denoise', True)
    tweak(getattr(scene.eevee, 'ray_tracing_options', None), 'resolution_scale', '1')
    tweak(scene.eevee, 'shadow_ray_count', 4)
    tweak(scene.eevee, 'shadow_step_count', 8)
    tweak(scene.eevee, 'taa_render_samples', 48)
    print('  eevee: ' + ', '.join(report), flush=True)

    camera_data = bpy.data.cameras.new('camera')
    camera_data.type = 'ORTHO'
    camera = bpy.data.objects.new('camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    # Three lights, the way a figure is lit rather than the way a scene is.
    #
    # The key comes over the viewer's left shoulder, which is where the
    # ground's own shading puts the sun, so a man and the tile he stands on
    # agree about where the light is. It is warm, and it is slightly soft:
    # a hard sun on a stack of boxes gives every edge a razor, and once the
    # render is shrunk by four those razors are the only thing left.
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 1.9
    sun.data.angle = math.radians(7.0)
    sun.data.color = srgb('#fff1d6')
    sun.rotation_euler = (math.radians(55), 0, math.radians(-25))
    scene.collection.objects.link(sun)

    # The sky, from the other side and cool, so the shaded face of a man is
    # blue-grey rather than black. Two colours of light rather than one is
    # most of what separates a model from a diagram.
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 0.2
    fill.data.angle = math.radians(40.0)
    fill.data.color = srgb('#9ab6e0')
    fill.rotation_euler = (math.radians(118), 0, math.radians(152))
    scene.collection.objects.link(fill)

    # And a weak one up off the ground in front, which keeps a man's legs and
    # the underside of a horse from going to a single dead value. Warm,
    # because what it is standing in is a field.
    bounce = bpy.data.objects.new('bounce', bpy.data.lights.new('bounce', 'SUN'))
    bounce.data.energy = 0.1
    bounce.data.angle = math.radians(60.0)
    bounce.data.color = srgb('#c8bb92')
    bounce.rotation_euler = (math.radians(-28), 0, math.radians(35))
    scene.collection.objects.link(bounce)

    scene.world = bpy.data.worlds.new('world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.24, 0.28, 0.37, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.085
    return camera


def aim(camera, radius):
    """Points the camera at the model from the one angle the tiles allow."""
    distance = max(8.0, radius * 6)
    azimuth = math.radians(AZIMUTH)
    elevation = math.radians(ELEVATION)
    camera.location = (
        math.cos(elevation) * math.sin(azimuth) * distance,
        -math.cos(elevation) * math.cos(azimuth) * distance,
        math.sin(elevation) * distance,
    )
    direction = -mathutils.Vector(camera.location)
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def frame_model(camera):
    """Fits the frame to the model and says where the model's feet landed.

    Two things were wrong with framing every sprite on a radius the model
    reports. A frame that is the same for a galley and a man spends most of
    its pixels on air, which is resolution thrown away; and the thing never
    sits in the middle of it, so the game, which stamps a sprite by its
    frame, puts a town up and to the left of the place it is supposed to be
    standing. Fitting the frame to what is actually there fixes the first,
    and returning where the model's own origin fell in the frame fixes the
    second: the game stamps on that point instead and a town lands on its
    own coordinates.
    """
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    xs, ys = [], []
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            local = inverse @ (obj.matrix_world @ mathutils.Vector(corner))
            xs.append(local.x)
            ys.append(local.y)
    if not xs:
        return 0.5, 0.5, 1.0
    centre_x = (min(xs) + max(xs)) / 2
    centre_y = (min(ys) + max(ys)) / 2
    # A little room to spare: a frame that fits exactly clips the outermost
    # pixel of whatever leans out of it once the render is box-filtered down.
    extent = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.06
    camera.data.ortho_scale = extent
    camera.data.shift_x = centre_x / extent
    camera.data.shift_y = centre_y / extent

    origin = inverse @ mathutils.Vector((0.0, 0.0, 0.0))
    across = (origin.x - (centre_x - extent / 2)) / extent
    down = ((centre_y + extent / 2) - origin.y) / extent
    return across, down, extent


def render(camera, radius, path):
    aim(camera, radius)
    across, down, extent = frame_model(camera)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return across, down, extent


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


def trim(cell, size):
    """Cuts a rendered cell down to what is actually in it.

    Every render comes back as a square of the same side, and most of that
    square is air: a man occupies about a third of his, a tree less. Kept
    square, five hundred sprites are twenty megabytes of texture once the
    browser has decoded them, and nine tenths of the work drawing one is
    scaling transparent pixels.

    Returns where the content started, so the anchor — the point the model
    was standing on — can be moved with it.
    """
    left, top, right, bottom = size, size, -1, -1
    for y in range(size):
        row = y * size
        for x in range(size):
            if cell[(row + x) * 4 + 3]:
                if x < left:
                    left = x
                if x > right:
                    right = x
                if y < top:
                    top = y
                if y > bottom:
                    bottom = y
    if right < 0:
        return 0, 0, 1, 1, bytearray(4)
    width = right - left + 1
    height = bottom - top + 1
    out = bytearray(width * height * 4)
    for y in range(height):
        start = ((top + y) * size + left) * 4
        out[y * width * 4:(y + 1) * width * 4] = cell[start:start + width * 4]
    return left, top, width, height, out


def shelve(sizes, limit=2048):
    """Lays the pieces out in rows, tallest first.

    A shelf packer, which is the simplest thing that works and leaves little
    enough air that nothing more clever is worth the lines it would take.
    """
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    places = {}
    x = y = shelf = 0
    used = 0
    for i in order:
        width, height = sizes[i]
        if x + width > limit:
            x = 0
            y += shelf
            shelf = 0
        places[i] = (x, y)
        x += width
        shelf = max(shelf, height)
        used = max(used, x)
    return used, y + shelf, places


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


def siege(build, pose, facing):
    """One of the engines, turned to face the way a man would."""
    radius = build(pose)
    spin((360 - facing * 45) % 360)
    return radius


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
    wanted.append(('captain', lambda: general(False)))
    wanted.append(('general', lambda: general(True)))
    # Every kind of soldier, in two kits, eight directions and nine poses.
    # Eleven hundred and fifty-two renders, and the largest single thing on
    # the sheet: the price of a battle in which the men face the men they are
    # fighting, move their legs on the way there, are not all the same man,
    # and throw away their shields when they break.
    #
    # Seven and not six because of `pass`. A walk is four beats and the old
    # sheet had three pictures for it — the two strides and a stand between
    # them — which worked only while the legs were straight posts and nobody
    # could tell a stand from a passing leg. With a knee in them it reads as
    # what it is: two steps with a pause in the middle of each.
    kinds = (
        ('spearman', dict(weapon='spear')),
        ('swordsman', dict(weapon='sword')),
        ('pikeman', dict(weapon='pike')),
        ('archer', dict(weapon='bow', shield=False)),
        ('crossbowman', dict(weapon='crossbow', shield=False)),
        ('gunner', dict(weapon='gun', shield=False)),
        ('knight', dict(weapon='lance', mounted=True, barded=True)),
        ('lighthorse', dict(weapon='sword', mounted=True)),
    )
    for kind, options in kinds:
        for kit in range(2):
            for facing in range(8):
                for pose in ('idle', 'pass', 'brace', 'shout', 'step-a',
                             'step-b', 'fight', 'flee-a', 'flee-b'):
                    label = f'{kind}_{kit}_{facing}_{pose.replace("-", "")}'
                    wanted.append((
                        label,
                        lambda o=options, p=pose, f=facing, k=kit:
                            fighter(pose=p, facing=f, kit=k, **o),
                    ))
    # Going down: two frames, in both kits and all eight directions, and no
    # kinds at all. Thirty-two renders for the second between a man and a
    # body, where doing it per kind of soldier would have cost two hundred
    # and fifty-six for a difference nobody could see — he has dropped the
    # thing that would have told them apart.
    for kit in range(2):
        for facing in range(8):
            for pose in ('fall-a', 'fall-b'):
                wanted.append((
                    f'falling_{kit}_{facing}_{pose.replace("-", "")}',
                    lambda p=pose, f=facing, k=kit: falling(p, f, k),
                ))
    # The two siege silhouettes, in the same eight directions. No kits: a
    # machine is not wearing anything, so it is always kit nought, and the
    # only two things it does are wait and loose.
    for name, build in (('engine', engine), ('cannon', cannon)):
        for facing in range(8):
            for pose in ('idle', 'fight'):
                wanted.append((
                    f'{name}_0_{facing}_{pose}',
                    lambda b=build, p=pose, f=facing: siege(b, p, f),
                ))
    wanted.append(('galley', lambda: vessel(True)))
    wanted.append(('roundship', lambda: vessel(False)))
    wanted.append(('agent', lambda: agent()))
    wanted.append(('caravan', lambda: caravan()))
    wanted.append(('fallen', lambda: fallen(0)))
    wanted.append(('fallen2', lambda: fallen(1)))
    wanted.append(('tree', lambda: tree(True)))
    wanted.append(('scrub', lambda: tree(False)))

    # A way to look at one thing without waiting for eight hundred.
    #
    # The whole sheet is a long render, and most of what is being judged when
    # the models change is one figure: whether his hands read, whether the
    # shield is still a shield. REGNA_SPRITES=spearman_0_0_idle,knight_0_2_fight
    # builds those and writes a sheet of nothing else, which is for looking at
    # and not for committing.
    only = [n for n in os.environ.get('REGNA_SPRITES', '').split(',') if n]
    out_png, out_ts = OUT_PNG, OUT_TS
    if only:
        wanted = [item for item in wanted if item[0] in only]
        if not wanted:
            raise SystemExit(f'No sprite named in REGNA_SPRITES exists: {only}')
        # Never over the real sheet: a partial one would take the game's
        # whole wardrobe away until somebody noticed.
        out_png = os.path.join(ROOT, '.sprite-preview.png')
        out_ts = os.path.join(ROOT, '.sprite-preview.ts')

    pieces = []
    for name, build in wanted:
        radius = build()
        across, down, extent = render(camera, radius, scratch)
        width, height, raw = read_png_pixels(scratch)
        cell = shrink_and_quantise(width, height, raw, CELL)
        left, top, piece_w, piece_h, bits = trim(cell, CELL)
        pieces.append((
            name, piece_w, piece_h, bits,
            round(across * CELL - left, 1),
            round(down * CELL - top, 1),
            round(extent, 4),
        ))
        print(f'  {name}', flush=True)

    sheet_w, sheet_h, places = shelve([(p[1], p[2]) for p in pieces])
    sheet = bytearray(sheet_w * sheet_h * 4)
    index = []
    for i, (name, piece_w, piece_h, bits, ax, ay, world) in enumerate(pieces):
        x, y = places[i]
        for row in range(piece_h):
            start = ((y + row) * sheet_w + x) * 4
            sheet[start:start + piece_w * 4] = bits[row * piece_w * 4:(row + 1) * piece_w * 4]
        index.append((name, x, y, piece_w, piece_h, ax, ay, world))

    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    write_png(out_png, sheet_w, sheet_h, sheet)
    if os.path.exists(scratch):
        os.remove(scratch)

    entries = ',\n'.join(
        f"  {name}: {{ x: {x}, y: {y}, width: {w}, height: {h}, "
        f"anchorX: {ax}, anchorY: {ay}, world: {world} }}"
        for name, x, y, w, h, ax, ay, world in index
    )
    cell = CELL
    man = MAN_HEIGHT
    with open(out_ts, 'w') as handle:
        handle.write(f'''/**
 * Where each sprite sits on the sheet.
 *
 * The sheet is modelled and rendered rather than drawn: see
 * tools/build-sprites.py, which puts every piece in front of the one camera
 * angle the tiles allow and shrinks the result onto a short palette. Do not
 * edit by hand.
 *
 * Anything belonging to whoever owns a thing is rendered in magenta and
 * swapped for the owner's colour when the sprite is first asked for. That is
 * how these games coloured a hundred companies from one drawing, and it is
 * why a settlement here can be any of seventy-three. The magenta is a
 * surface rather than a light, so the green channel stays at nought while
 * red and blue carry how brightly that face was lit: the swap reads that
 * back and puts the realm's colour in at the light it was standing in.
 *
 * `anchorX` and `anchorY` are where the model's own origin — the middle of
 * the ground it stands on — fell in its frame. The map stamps a sprite by
 * that point rather than by the middle of the frame, which is what puts a
 * town on its own coordinates instead of up and to the left of them.
 *
 * Every sprite is cut down to what is actually in it, so `width` and
 * `height` differ from one to the next. `SPRITE_CELL` is the square they
 * were all rendered in: a caller asking for a sprite at a size means that
 * square, and what it gets back is the piece of it that was not air.
 *
 * `world` is how much of the model's world that square covered. It differs
 * from one sprite to the next because each is framed to fit what is in it,
 * and it is what a caller needs to draw two different sprites at the same
 * scale as each other — see `atManHeight`.
 */

export const SPRITE_MARKER = {{ r: 255, g: 0, b: 255 }} as const;

/**
 * And the second: what is painted on the shield.
 *
 * A realm has two colours on a shield, not one — the field and whatever is
 * laid over it — and a single marker gave every shield in Europe the same
 * flat rectangle in a different paint. This costs no extra renders, because
 * the division is in the model rather than in a variant of it.
 */
export const SPRITE_DEVICE = {{ r: 0, g: 255, b: 255 }} as const;

/** The square every sprite was rendered in, before it was cut down. */
export const SPRITE_CELL = {cell};

/**
 * How tall a man is, in the units the models are built in.
 *
 * The one number that makes the sprites comparable with each other. Every
 * sprite is framed to fit what is in it, which spends the pixels where they
 * are wanted and costs the one thing nobody noticed for a long time: the
 * cell stops meaning a fixed amount of world. A swordsman's cell covers two
 * thirds of a unit and a knight's covers nearly two, so drawing both cells
 * at the same number of pixels makes the knight the smaller man — which is
 * exactly what the field showed, cavalry riding past infantry that stood a
 * head taller than them.
 *
 * `world` on each sprite says how much it covers. Divide by this and the
 * answer is how many times too big that sprite is drawn at a given size,
 * which is what `atManHeight` undoes.
 */
export const SPRITE_MAN = {man};

/** Where the sheet is served from. */
export const SPRITE_SHEET = 'sprites.png';

export const SPRITES = {{
{entries},
}} as const;

export type SpriteName = keyof typeof SPRITES;
''')
    print(f'wrote {os.path.relpath(out_png, ROOT)} and {os.path.relpath(out_ts, ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
