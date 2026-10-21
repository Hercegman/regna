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


def man(name, x, y, mail, cloth, spear_mat, skin, mounted=False, shield=True,
        spear=True, cloak=False, weapon='spear', barded=False, pose='idle', kit=0):
    """One figure, built like a person rather than like a token.

    Legs apart, a torso in his lord's colours, two arms, a head with a helmet
    on it, a shield on the left arm and a spear in the right. It is a dozen
    boxes where it used to be four, and at the size the battlefield draws him
    that is the difference between a man and a domino: you can see which way
    he is facing, where his shield is, and whether he is on a horse.

    Everything is in units where a man is about six tenths tall, which is
    what the rest of the file is built in.
    """
    base = 0.0
    if mounted:
        # The horse: a barrel on four legs with a neck and a head, which is
        # all there is room for and all a horse needs to read as one.
        hide = spear_mat
        box(f'{name}-barrel', x, y, 0.22, 0.17, 0.44, 0.19, hide)
        if barded:
            # A trapper over the horse in his lord's colours, which is what
            # tells a knight from a man on a horse at any distance.
            box(f'{name}-bard', x, y, 0.16, 0.21, 0.42, 0.14, cloth)
            box(f'{name}-chamfron', x, y + 0.25, 0.46, 0.1, 0.13, 0.09, cloth)
        for i, (dx, dy) in enumerate(((-0.065, 0.16), (0.065, 0.16),
                                      (-0.065, -0.16), (0.065, -0.16))):
            box(f'{name}-hoof-{i}', x + dx, y + dy, 0, 0.05, 0.05, 0.23, hide)
        box(f'{name}-neck', x, y + 0.2, 0.34, 0.1, 0.12, 0.16, hide)
        box(f'{name}-head', x, y + 0.25, 0.46, 0.09, 0.16, 0.09, hide)
        box(f'{name}-tail', x, y - 0.23, 0.3, 0.05, 0.05, 0.12, hide)
        base = 0.41

    # Where the pose puts him. A man is the same dozen boxes in every one of
    # them; what moves is his legs, his arms and how far forward he is
    # leaning, which at the size a battle draws him is all there is room for
    # and all a walk needs to read as one.
    #
    # The two stepping poses are mirrors of each other, and the game plays
    # them as step, stand, other step, stand — which is a four-beat cycle out
    # of three pictures, and the cheapest honest walk there is.
    fleeing = pose.startswith('flee')
    falling = pose.startswith('fall')
    stride = {
        'step-a': 0.075, 'step-b': -0.075,
        'flee-a': 0.125, 'flee-b': -0.125,
        'fall-a': 0.06, 'fall-b': -0.03,
    }.get(pose, 0.0)
    lean = 0.09 if fleeing else 0.055 if pose == 'fight' else abs(stride) * 0.25
    crouch = 0.018 if pose == 'fight' else abs(stride) * 0.1
    if falling:
        # A man going down, in the one second between being hit and being a
        # body. The knee folds under him and he loses his height; which way
        # he goes over is not here at all, because pitching the whole figure
        # is `pitch`'s job and turning twelve boxes one at a time is not.
        lean = 0.0
        crouch = 0.055 if pose == 'fall-a' else 0.115
    if fleeing or falling:
        # A man running for the treeline has thrown away what he was
        # carrying. It is the one thing that reads as a rout rather than as
        # a march in the wrong direction — and a man being killed lets go of
        # the same things in the same order, which is why the body he turns
        # into has its spear lying beside it rather than in its hand.
        shield = False
        spear = False

    box(f'{name}-leg-l', x - 0.045, y + stride, base, 0.055, 0.08, 0.17 - crouch, mail)
    box(f'{name}-leg-r', x + 0.045, y - stride, base, 0.055, 0.08, 0.17 - crouch, mail)
    if kit:
        # The second man in every two: mail to the chest with a coloured
        # band over it rather than a surcoat of his lord's colours all the
        # way down. It is the strongest difference available at this size —
        # a block in which half the men are mostly grey and half are mostly
        # coloured stops being one man drawn a hundred and twenty times.
        box(f'{name}-torso', x, y + lean, base + 0.17 - crouch, 0.17, 0.11, 0.2, mail)
        box(f'{name}-band', x, y + lean, base + 0.25 - crouch, 0.178, 0.118, 0.07, cloth)
    else:
        box(f'{name}-torso', x, y + lean, base + 0.17 - crouch, 0.17, 0.11, 0.2, cloth)
    # Arms swing against the legs, which is the thing that makes a walk a
    # walk rather than a hop. In a rout they go up instead.
    swing = 0.0 if falling else 0.4 if fleeing else 0.8
    raised = 0.12 if falling else 0.1 if fleeing else 0.0
    # Thrown wide as he goes: a man who is falling is not holding his line.
    flail = 0.055 if falling else 0.0
    box(f'{name}-arm-l', x - 0.105 - flail, y - stride * swing, base + 0.2 + raised - crouch,
        0.05, 0.09, 0.16, mail)
    box(f'{name}-arm-r', x + 0.105 + flail, y + stride * swing + lean, base + 0.2 + raised - crouch,
        0.05, 0.09, 0.16, mail)
    if cloak:
        # Hung off the shoulders and down the back, which is the one thing
        # that says a man is somebody at this size.
        box(f'{name}-cloak', x, y - 0.062 + lean, base + 0.14, 0.165, 0.04, 0.24, cloth)
    box(f'{name}-neck', x, y + lean, base + 0.37 - crouch, 0.07, 0.07, 0.04, skin)
    box(f'{name}-head', x, y + lean, base + 0.41 - crouch, 0.1, 0.1, 0.09, skin)
    if kit:
        # A conical helm with a nasal rather than a flat-topped one, which is
        # a different silhouette and so tells one man from the next even
        # where the colour does not.
        cone(f'{name}-helm', x, y + lean, base + 0.46 - crouch, 0.068, 0.11, mail, 6)
        box(f'{name}-nasal', x, y + lean + 0.055, base + 0.44 - crouch, 0.022, 0.03, 0.07, mail)
    else:
        box(f'{name}-helm', x, y + lean, base + 0.47 - crouch, 0.115, 0.115, 0.06, mail)
    if shield:
        # Brought up and across in a fight, which is what a shield is for.
        up = 0.04 if pose == 'fight' else 0.0
        if kit:
            # A round shield, which is the other shape there was and reads as
            # a different thing at twenty pixels.
            disc = cone(f'{name}-shield', 0, 0, 0, 0.095, 0.03, cloth, 8, 0.92)
            disc.rotation_euler = (math.radians(90), 0, 0)
            disc.location = (x - 0.14, y - 0.01 + lean * 1.4, base + 0.27 + up - crouch)
        else:
            box(f'{name}-shield', x - 0.135, y - 0.01 + lean * 1.4, base + 0.19 + up - crouch,
                0.03, 0.13, 0.17, cloth)

    # What he is carrying, which is the whole of what tells one kind of
    # soldier from another in a silhouette this size.
    if not spear or weapon == 'none':
        pass
    elif weapon == 'spear':
        if pose == 'fight':
            # Levelled and thrust, which is what a spear line did and the one
            # thing that reads at this size as fighting rather than standing.
            thrust = box(f'{name}-spear', x + 0.13, y + 0.2, base + 0.3,
                         0.028, 0.6, 0.028, spear_mat)
            thrust.rotation_euler = (math.radians(6), 0, 0)
        else:
            box(f'{name}-spear', x + 0.14, y - 0.02 + lean, base + 0.08,
                0.028, 0.028, 0.52, spear_mat)
    elif weapon == 'pike':
        pike = box(f'{name}-pike', x + 0.14, y - 0.02 + lean, base + 0.04,
                   0.028, 0.028, 0.95, spear_mat)
        if pose == 'fight':
            # Brought down to the level: a pike hedge, not a forest.
            pike.rotation_euler = (math.radians(72), 0, 0)
            pike.location = (x + 0.14, y + 0.3, base + 0.34)
    elif weapon == 'sword':
        # Raised, because a sword held down is a stick against the leg.
        high = 0.1 if pose == 'fight' else 0.0
        box(f'{name}-arm-up', x + 0.11, y + lean, base + 0.3 + high - crouch, 0.05, 0.08, 0.14, mail)
        box(f'{name}-sword', x + 0.11, y - 0.01 + lean, base + 0.44 + high - crouch,
            0.035, 0.035, 0.26, mail)
        box(f'{name}-guard', x + 0.11, y - 0.01 + lean, base + 0.44 + high - crouch,
            0.12, 0.04, 0.03, mail)
    elif weapon == 'bow':
        # A stave taller than he is, held out from the body. No shield goes
        # with it, and that absence is half of what says archer. Drawn, the
        # stave comes across the body and the arm goes back to the ear.
        drawn = pose == 'fight'
        bow = box(f'{name}-bow', x + (0.02 if drawn else 0.17), y + (0.17 if drawn else -0.02),
                  base + 0.02, 0.022, 0.035, 0.58, spear_mat)
        bow.rotation_euler = (0, math.radians(-10), math.radians(80 if drawn else 0))
        box(f'{name}-string', x + (0.02 if drawn else 0.11), y + (0.08 if drawn else -0.02),
            base + 0.1, 0.012, 0.012, 0.42, skin)
        if drawn:
            box(f'{name}-arrow', x + 0.02, y + 0.06, base + 0.3, 0.018, 0.34, 0.018, spear_mat)
        box(f'{name}-quiver', x - 0.1, y - 0.08, base + 0.18, 0.06, 0.06, 0.2, spear_mat)
    elif weapon == 'crossbow':
        # Held level across the chest: a cross shape, which is exactly how
        # the thing was recognised. Brought up to the shoulder to shoot.
        aim = 0.06 if pose == 'fight' else 0.0
        box(f'{name}-stock', x + 0.06, y - 0.06 + lean + aim, base + 0.3 + aim - crouch,
            0.05, 0.3, 0.04, spear_mat)
        box(f'{name}-prod', x + 0.06, y - 0.17 + lean + aim, base + 0.3 + aim - crouch,
            0.3, 0.04, 0.04, spear_mat)
    elif weapon == 'gun':
        barrel = box(f'{name}-gun', x + 0.08, y - 0.1, base + 0.32, 0.04, 0.34, 0.04, mail)
        barrel.rotation_euler = (math.radians(-10), 0, 0)
        box(f'{name}-rest', x + 0.2, y - 0.04, base, 0.025, 0.025, 0.36, spear_mat)
    elif weapon == 'lance':
        down = pose == 'fight'
        lance = box(f'{name}-lance', x + 0.15, y + (0.14 if down else 0.06),
                    base + (0.2 if down else 0.24), 0.03, 0.78, 0.03, spear_mat)
        lance.rotation_euler = (math.radians(2 if down else -9), 0, 0)
        box(f'{name}-pennon', x + 0.15, y + (0.4 if down else 0.3),
            base + (0.24 if down else 0.3), 0.02, 0.14, 0.1, cloth)


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
    turn = mathutils.Matrix.Rotation(math.radians(degrees), 4, 'Z')
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.matrix_world = turn @ obj.matrix_world


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
    turn = mathutils.Matrix.Rotation(math.radians(-degrees), 4, 'X')
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.matrix_world = turn @ obj.matrix_world


def palette_for_men():
    """The materials every figure is made of, in one place."""
    return (
        material('mail', srgb('#5a5852')),
        material('cloth', MARKER, emissive=True),
        material('timber', srgb('#4a3222')),
        material('skin', srgb('#b98f6a')),
    )


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
    return tall if not mounted else 0.9


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
    turn = 0.32 if variant else -0.26
    # Laid out along y, which the camera reads as lying across the picture.
    box('legs-l', -0.05, -0.2, 0, 0.055, 0.2, 0.055, mail)
    box('legs-r', 0.05, -0.22, 0, 0.055, 0.2, 0.055, mail)
    box('torso', 0, 0.02, 0, 0.17, 0.24, 0.07, cloth)
    box('arm-l', -0.13, 0.04, 0, 0.07, 0.16, 0.05, mail)
    box('arm-r', 0.13, 0.0, 0, 0.07, 0.16, 0.05, mail)
    box('head', 0, 0.2, 0, 0.1, 0.1, 0.08, skin)
    box('helm', 0, 0.22, 0.05, 0.11, 0.11, 0.05, mail)
    if variant:
        box('shield', -0.24, -0.04, 0, 0.14, 0.17, 0.03, cloth)
    else:
        box('spear', 0.2, -0.02, 0, 0.5, 0.028, 0.028, timber)
    spin(math.degrees(turn) * 3)
    return 0.42


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
    cloak = material('cloak', MARKER, emissive=True)
    dark = material('dark', srgb('#3b372f'))
    skin = material('skin', srgb('#b98f6a'))
    box('leg-l', -0.04, 0, 0, 0.05, 0.07, 0.14, dark)
    box('leg-r', 0.04, 0, 0, 0.05, 0.07, 0.14, dark)
    box('cloak', 0, 0, 0.14, 0.2, 0.13, 0.26, cloak)
    box('arm', 0.1, 0, 0.17, 0.05, 0.08, 0.16, cloak)
    box('face', 0, 0.01, 0.4, 0.08, 0.07, 0.07, skin)
    cone('hood', 0, 0, 0.38, 0.1, 0.16, dark, 6)
    box('staff', 0.13, -0.02, 0, 0.026, 0.026, 0.62, dark)
    return 0.52


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
        return 0.5, 0.5
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
    return across, down


def render(camera, radius, path):
    aim(camera, radius)
    anchor = frame_model(camera)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return anchor


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
    # Every kind of soldier, in two kits, eight directions and six poses.
    # Seven hundred and sixty-eight renders, and the largest single thing on
    # the sheet: the price of a battle in which the men face the men they are
    # fighting, move their legs on the way there, are not all the same man,
    # and throw away their shields when they break.
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
                for pose in ('idle', 'step-a', 'step-b', 'fight', 'flee-a', 'flee-b'):
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

    pieces = []
    for name, build in wanted:
        radius = build()
        across, down = render(camera, radius, scratch)
        width, height, raw = read_png_pixels(scratch)
        cell = shrink_and_quantise(width, height, raw, CELL)
        left, top, piece_w, piece_h, bits = trim(cell, CELL)
        pieces.append((
            name, piece_w, piece_h, bits,
            round(across * CELL - left, 1),
            round(down * CELL - top, 1),
        ))
        print(f'  {name}', flush=True)

    sheet_w, sheet_h, places = shelve([(p[1], p[2]) for p in pieces])
    sheet = bytearray(sheet_w * sheet_h * 4)
    index = []
    for i, (name, piece_w, piece_h, bits, ax, ay) in enumerate(pieces):
        x, y = places[i]
        for row in range(piece_h):
            start = ((y + row) * sheet_w + x) * 4
            sheet[start:start + piece_w * 4] = bits[row * piece_w * 4:(row + 1) * piece_w * 4]
        index.append((name, x, y, piece_w, piece_h, ax, ay))

    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    write_png(OUT_PNG, sheet_w, sheet_h, sheet)
    if os.path.exists(scratch):
        os.remove(scratch)

    entries = ',\n'.join(
        f"  {name}: {{ x: {x}, y: {y}, width: {w}, height: {h}, "
        f"anchorX: {ax}, anchorY: {ay} }}"
        for name, x, y, w, h, ax, ay in index
    )
    cell = CELL
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
 */

export const SPRITE_MARKER = {{ r: 255, g: 0, b: 255 }} as const;

/** The square every sprite was rendered in, before it was cut down. */
export const SPRITE_CELL = {cell};

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
