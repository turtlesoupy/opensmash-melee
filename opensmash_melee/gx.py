"""HSD envelope polygons, ten-matrix GX batches, and tiled RGBA8 textures."""
import struct
import numpy as np

from .materials import LIT_TEXTURE_MODE, FIGHTER_MATERIAL_COLOR


def rgba8(image):
    pixels = np.asarray(image.convert('RGBA'))
    height, width = pixels.shape[:2]
    if width % 4 or height % 4 or max(width,height) > 1024:
        raise ValueError('GX RGBA8 needs dimensions divisible by 4, maximum 1024')
    out = bytearray()
    for y in range(0,height,4):
        for x in range(0,width,4):
            tile = pixels[y:y+4,x:x+4].reshape(16,4)
            out.extend(tile[:,[3,0]].tobytes())
            out.extend(tile[:,[1,2]].tobytes())
    return bytes(out)


def batches(mesh):
    # Opaque triangles may be reordered. Grow each batch through adjacent
    # envelope users; keep exact weights and never discard triangles.
    from collections import defaultdict
    tri_list = [tuple(int(i) for i in tri) for tri in mesh['triangles']]
    tri_env = [tuple(dict.fromkeys(mesh['envelopes'][i] for i in tri)) for tri in tri_list]
    users = defaultdict(set)
    for index,envs in enumerate(tri_env):
        for env in envs:
            users[env].add(index)
    remaining=set(range(len(tri_list)))
    while remaining:
        palette,triangles,candidates=[],[],set()
        chosen=min(remaining)
        while True:
            remaining.remove(chosen)
            triangles.append(tri_list[chosen])
            for env in tri_env[chosen]:
                if env not in palette:
                    palette.append(env)
                    candidates.update(users[env])
                users[env].discard(chosen)
            candidates.intersection_update(remaining)
            available=[]
            for index in candidates:
                added=sum(env not in palette for env in tri_env[index])
                if len(palette)+added<=10:
                    available.append((added,index))
            if len(triangles)>=21845:
                break
            if available:
                chosen=min(available)[1]
            elif len(palette)<=7 and remaining:
                chosen=min(remaining)
            else:
                break
        yield palette,triangles


def polygons(archive, mesh, skeleton):
    if len(mesh['positions']) > 65535:
        raise ValueError('GX INDEX16 vertex limit exceeded; simplify the source mesh')
    vertex_arrays = []
    for key in ('positions','normals','uv'):
        vertex_arrays.append(archive.append(np.asarray(mesh[key], dtype='>f4').tobytes(),32))
    desc = archive.alloc(5*24)
    # HSD_VtxDescList: attr/type/count/component enums, u8 frac, u16 stride, ptr.
    for i,(attr,kind,count,stride,ptr) in enumerate([
        (0,1,0,0,None), (9,3,1,12,vertex_arrays[0]),
        (10,3,0,12,vertex_arrays[1]), (13,3,1,8,vertex_arrays[2]), (255,0,0,0,None)]):
        p = desc+i*24
        archive.pack('4I',p,attr,kind,count,4)
        archive.pack('H',p+18,stride)
        archive.pointer(p+20,ptr)
    first, last, batch_count = None, None, 0
    for palette, tris in batches(mesh):
        table = archive.alloc((len(palette)+1)*4)
        for i,env in enumerate(palette):
            # HSD's single-weight fast path skips inverse binding on a
            # SKELETON_ROOT. Two equal entries force the general envelope path.
            if len(env) == 1:
                env = ((env[0][0],0.5),(env[0][0],0.5))
            envelope = archive.alloc((len(env)+1)*8)
            for k,(joint,weight) in enumerate(env):
                archive.pointer(envelope+k*8,skeleton[joint]['offset'])
                archive.pack('f',envelope+k*8+4,weight)
            archive.pointer(table+i*4,envelope)
        display = bytearray(struct.pack('>BH',0x90,len(tris)*3))
        for tri in tris:
            for vertex in tri:
                matrix = palette.index(mesh['envelopes'][vertex])*3
                display.extend(struct.pack('>BHHH',matrix,vertex,vertex,vertex))
        display.extend(b'\0'*(-len(display)%32))
        dl = archive.append(display,32)
        pobj = archive.alloc(24)
        archive.pointer(pobj+8,desc)
        archive.pack('HH',pobj+12,0x2000,len(display)//32)
        archive.pointer(pobj+16,dl)
        archive.pointer(pobj+20,table)
        if first is None:
            first = pobj
        if last is not None:
            archive.pointer(last+4,pobj)
        last = pobj
        batch_count += 1
    return first,batch_count


def material(archive, image):
    width,height = image.size
    pixels = archive.append(rgba8(image),32)
    im = archive.alloc(24)
    archive.pointer(im,pixels)
    archive.pack('HHI',im+4,width,height,6)  # GX_TF_RGBA8
    tex = archive.alloc(92)
    archive.pack('II',tex+8,0,4)  # GX_TEXMAP0, GX_TG_TEX0
    archive.pack('3f',tex+28,1,1,1)
    archive.pack('II',tex+52,1,1)  # repeat S/T
    archive.pack('BB',tex+60,1,1)
    archive.pack('IfI',tex+64,0x40010,1.0,1)  # diffuse modulate, linear
    archive.pointer(tex+76,im)
    mat = archive.alloc(20)
    archive.pack('IIIff',mat,FIGHTER_MATERIAL_COLOR,FIGHTER_MATERIAL_COLOR,0,1.0,0.0)
    mobj = archive.alloc(24)
    archive.pack('I',mobj+4,LIT_TEXTURE_MODE)  # lit diffuse + TEX0, matte finish
    archive.pointer(mobj+8,tex)
    archive.pointer(mobj+12,mat)
    return mobj


def replace_costume(archive, mesh, skeleton, profile):
    owner_index = profile['mesh_joint']
    if type(owner_index) is not int or not 0 <= owner_index < len(skeleton):
        raise ValueError('Invalid mesh_joint index')
    owner = skeleton[owner_index]
    # A root-space model avoids applying an animated owner transform twice.
    # Other owner modes need captured runtime matrices and are not guessed.
    if not owner['flags'] & 2:
        raise ValueError('mesh_joint must be an existing HSD SKELETON_ROOT model owner')
    if owner['dobj'] is None:
        raise ValueError('mesh_joint must already own a DObj (preserve fighter DObj indexing)')
    dobj_index = profile.get('mesh_dobj',0)
    selected = None
    visited = set()
    for j in skeleton:
        d, index = j['dobj'],0
        while d is not None:
            if d in visited:
                raise ValueError('Shared/cyclic DObj lists unsupported')
            visited.add(d)
            archive.check(d,16)
            if j['index'] == owner['index'] and index == dobj_index:
                selected = d
            # Keep every DObj and its material descriptor alive for fighter
            # material/visibility tables; suppress only its original geometry.
            archive.pointer(d+12,None)
            d = archive.ptr(d+4)
            index += 1
    if selected is None:
        raise ValueError('mesh_dobj does not exist on mesh_joint')
    if profile.get('browser_skinning'):
        from .browser_skin import polygons as browser_polygons
        pobj,count = browser_polygons(archive,mesh,skeleton)
    else:
        pobj,count = polygons(archive,mesh,skeleton)
    archive.pointer(selected+12,pobj)
    archive.pointer(selected+8,material(archive,mesh['image']))
    # Preserve all skeleton flags; enable normals for the custom model owner.
    archive.pack('I',owner['offset']+4,owner['flags'] | 0x80)
    return dict(vertices=len(mesh['positions']),triangles=len(mesh['triangles']),
                draw_batches=count,unique_envelopes=len(set(mesh['envelopes'])),
                preserved_joints=len(skeleton),preserved_dobjs=len(visited))
