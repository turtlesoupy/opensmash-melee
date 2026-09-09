"""Inspect reference Mario GX positions in bind space (geometry diagnostic)."""
from pathlib import Path
import sys
from functools import lru_cache
import struct
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints


@lru_cache(maxsize=8)
def inspect(path):
    a=Archive.read(path);s=joints(a,'PlyMario5K_Share_joint')
    by_offset={j['offset']:j for j in s}
    head={23}
    for j in s:
        if j['parent'] in head:head.add(j['index'])
    points=[];head_points=[]
    d=s[0]['dobj']
    while d is not None:
        p=a.ptr(d+12)
        while p is not None:
            flags,n=a.unpack('HH',p+12)
            if flags&0x3000!=0x2000:raise ValueError('Expected envelope polygons')
            attrs=[];v=a.ptr(p+8)
            while a.unpack('I',v)[0]!=255:
                attr,typ,cnt,fmt,frac,_,stride,_=a.unpack('4IBBHI',v)
                attrs.append((attr,typ,cnt,fmt,frac,stride,a.ptr(v+20)));v+=24
            table=a.ptr(p+20);palette=[]
            for k in range(10):
                env=a.ptr(table+k*4)
                if env is None:break
                weights=[]
                while a.ptr(env) is not None:
                    weights.append((by_offset[a.ptr(env)],a.unpack('f',env+4)[0]));env+=8
                palette.append(weights)
            dl=a.ptr(p+16);cursor=dl;end=dl+n*32
            while cursor<end:
                op=a.unpack('B',cursor)[0];cursor+=1
                if op==0:continue
                if op&0xf8 not in (0x80,0x90,0x98,0xa0):raise ValueError('Unsupported GX command '+hex(op))
                count=a.unpack('H',cursor)[0];cursor+=2
                for _ in range(count):
                    pn=None;position=None
                    for attr,typ,cnt,fmt,frac,stride,array in attrs:
                        if typ==1 and attr<=8:
                            index=a.unpack('B',cursor)[0];cursor+=1
                            if attr==0:pn=index//3
                            continue
                        if typ not in (2,3):raise ValueError('Unsupported direct attribute')
                        index=a.unpack('B' if typ==2 else 'H',cursor)[0];cursor+=1 if typ==2 else 2
                        if attr==9:
                            if cnt!=1 or fmt!=3:raise ValueError('Expected signed16 XYZ reference positions')
                            position=np.array(a.unpack('3h',array+index*stride),dtype=float)/(2**frac)
                    env=palette[pn]
                    if len(env)==1:
                        joint,_=env[0]
                        position=(np.linalg.inv(joint['inverse_bind'])@np.r_[position,1])[:3]
                    points.append(position)
                    if sum(w for j,w in env if j['index'] in head)>.5:head_points.append(position)
            p=a.ptr(p+4)
        d=a.ptr(d+4)
    return np.array(points),np.array(head_points)


if __name__=='__main__':
    for label,pts in zip(('all','head'),inspect(sys.argv[1])):
        print(label,'min',pts.min(axis=0),'max',pts.max(axis=0),'size',np.ptp(pts,axis=0))
