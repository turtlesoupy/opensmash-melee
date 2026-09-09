import unittest
import numpy as np
from PIL import Image
from tools.validate_shape import render

class RendererTests(unittest.TestCase):
    def test_near_triangle_wins_regardless_of_submission_order(self):
        points=np.array([[-1,-1,0],[1,-1,0],[0,1,0],[-1,-1,1],[1,-1,1],[0,1,1]],float)
        texture=Image.new('RGB',(2,1));texture.putdata([(255,0,0),(0,0,255)])
        mesh=dict(positions=points,uv=np.array([[0,0]]*3+[[.75,0]]*3),image=texture)
        for tris in ([[0,1,2],[3,4,5]],[[3,4,5],[0,1,2]]):
            result=render(dict(mesh,triangles=np.array(tris)),[1,0,0],[0,1,0],3,[0,0],64)
            self.assertEqual(result.getpixel((32,32)),(0,0,255))
