"""Preserve authored head shape and head-to-body scale during conformation."""
import copy
import numpy as np
from .retarget import conform

ORIENTATION=np.array([[0,0,-1],[0,1,0],[1,0,0]],float)

def source_head_fit(mesh,skeleton,profile):
    """Uniform source head scale from ground-to-head-anchor body scale."""
    p=copy.deepcopy(profile);base=conform(mesh,skeleton,p)
    i=mesh['names'].index('Head');origin=mesh['bind'][i][:3,3]
    target=np.linalg.inv(skeleton[p['joint_map']['Head']]['inverse_bind'])
    source_ground=float(mesh['positions'][:,1].min())
    weights=np.where(mesh['joints']==i,mesh['weights'],0).sum(axis=1)
    ground=float(base['positions'][weights<.5,1].min())
    span=origin[1]-source_ground
    if span<=1e-6:raise ValueError('Head anchor must be above source ground')
    scale=(target[1,3]-ground)/span
    if not np.isfinite(scale) or scale<=0:raise ValueError('Invalid source proportion scale')
    affine=np.eye(4);affine[:3,:3]=ORIENTATION*scale
    affine[:3,3]=target[:3,3]-affine[:3,:3]@origin
    p['bone_corrections']['Head']=(np.linalg.inv(target)@affine@mesh['bind'][i]).tolist()
    p['fit_scales']['Head']={'length':float(scale),'width':float(scale)}
    p.update(fit_version=6,head_style='source',head_reference={'source_ground':source_ground,'fitted_body_ground':ground,'source_body_span':float(span)})
    return p
