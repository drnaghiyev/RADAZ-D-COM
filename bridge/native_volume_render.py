"""Native VTK GPU preview, fed by the same calibrated volume and preset curves."""
import json
from pathlib import Path
import time
import numpy as np
import vtkmodules.vtkRenderingOpenGL2  # noqa: register platform OpenGL implementation
import vtkmodules.vtkRenderingVolumeOpenGL2  # noqa
import vtkmodules.vtkInteractionStyle  # noqa
from vtkmodules.util.numpy_support import numpy_to_vtk
from vtkmodules.vtkCommonDataModel import vtkImageData
from vtkmodules.vtkCommonMath import vtkMatrix3x3
from vtkmodules.vtkCommonDataModel import vtkPlane, vtkPlaneCollection
from vtkmodules.vtkRenderingCore import vtkColorTransferFunction, vtkVolumeProperty, vtkVolume, vtkRenderer, vtkLight
from vtkmodules.vtkCommonDataModel import vtkPiecewiseFunction
from vtkmodules.vtkRenderingVolumeOpenGL2 import vtkOpenGLGPUVolumeRayCastMapper

PRESETS=json.loads(Path(__file__).with_name('native-volume-presets.json').read_text(encoding='utf-8'))['presets']


class NativeVolumeScene:
    def __init__(self, window, data):
        self.window=window
        self.data=data.validate()
        self.values=np.ascontiguousarray(data.values)
        self.image=vtkImageData()
        self.image.SetDimensions(*reversed(self.values.shape))
        self.image.SetSpacing(*data.spacing)
        self.image.SetOrigin(*data.origin)
        matrix=vtkMatrix3x3()
        for row in range(3):
            for col in range(3): matrix.SetElement(row,col,float(data.direction[row,col]))
        self.image.SetDirectionMatrix(matrix)
        self.scalars=numpy_to_vtk(self.values.ravel(),deep=False)
        self.image.GetPointData().SetScalars(self.scalars)
        self.mapper=vtkOpenGLGPUVolumeRayCastMapper()
        self.mapper.SetInputData(self.image)
        self.mapper.SetAutoAdjustSampleDistances(False)
        self.mapper.SetUseJittering(True)
        self.mapper.SetMaxMemoryFraction(.65)
        self.property=vtkVolumeProperty()
        self.property.SetInterpolationTypeToLinear()
        self.actor=vtkVolume()
        self.actor.SetMapper(self.mapper)
        self.actor.SetProperty(self.property)
        self.renderer=vtkRenderer()
        self.renderer.SetBackground(0,0,0)
        self.renderer.AddVolume(self.actor)
        light=vtkLight();light.SetLightTypeToHeadlight();light.SetIntensity(1)
        self.renderer.AddLight(light)
        window.AddRenderer(self.renderer)
        self.renderer.GetActiveCamera().ParallelProjectionOn()
        self.preset='mr' if data.modality=='MR' else 'bone'
        self.opacity=1
        self.shift=0
        self.width=1
        self.interacting=False
        self.quality='balanced'
        self.apply_transfer()
        self.set_quality(False)
        self.view('anterior')

    def apply_transfer(self):
        definition=next(p for p in PRESETS if p['key']==self.preset)
        color=vtkColorTransferFunction(); opacity=vtkPiecewiseFunction();gradient=vtkPiecewiseFunction()
        # MR is signal intensity, never HU. Fit the shared MR curve to its range.
        lower,upper=self.scalars.GetRange()
        def scalar(n):
            value=(lower+(n+1024)/4095*(upper-lower)) if self.data.modality=='MR' else n
            return value*self.width+self.shift
        for point in definition['color']: color.AddRGBPoint(scalar(point[0]),*point[1:])
        for point in definition['scalar']: opacity.AddPoint(scalar(point[0]),min(1,max(0,point[1]*self.opacity)))
        for point in definition['gradient']: gradient.AddPoint(*point)
        self.property.SetColor(color);self.property.SetScalarOpacity(opacity)
        self.property.SetScalarOpacityUnitDistance(float(definition.get('lighting',{}).get('opacityDistance',1)))
        self.property.SetGradientOpacity(gradient)
        self.property.SetDisableGradientOpacity(not definition['lighting'].get('gradient',False))
        self.property.SetShade(definition['shade'])
        material=definition['lighting']
        self.property.SetAmbient(material['ambient']);self.property.SetDiffuse(material['diffuse'])
        self.property.SetSpecular(material['specular']);self.property.SetSpecularPower(material['specularPower'])
        {'composite':self.mapper.SetBlendModeToComposite,'maximum':self.mapper.SetBlendModeToMaximumIntensity,'minimum':self.mapper.SetBlendModeToMinimumIntensity}[definition['blend']]()

    def set_quality(self, interacting):
        self.interacting=interacting
        step={'performance':1.5,'balanced':.8,'high':.5}[self.quality]
        self.mapper.SetSampleDistance(min(self.data.spacing)*(max(2,step*3) if interacting else step))
        self.mapper.SetImageSampleDistance(2.5 if interacting else 1)

    def set_crop(self, fractions):
        """Six index-aligned world-space planes; correct for oblique LPS geometry."""
        planes=vtkPlaneCollection()
        dimensions=list(reversed(self.values.shape))
        for axis in range(3):
            lower,upper=fractions[axis*2:axis*2+2]
            if not 0<=lower<=upper<=1: raise ValueError('Invalid crop')
            for fraction,sign in ((lower,1),(upper,-1)):
                index=np.zeros(3);index[axis]=fraction*(dimensions[axis]-1)
                origin=np.asarray(self.data.origin)+self.data.direction@(index*np.asarray(self.data.spacing))
                plane=vtkPlane();plane.SetNormal(*(self.data.direction[:,axis]*sign));plane.SetOrigin(*origin);planes.AddItem(plane)
        self.mapper.SetClippingPlanes(planes)

    def view(self, plane):
        center=np.asarray(self.data.origin)+self.data.direction@(np.asarray(self.data.spacing)*(np.asarray(list(reversed(self.values.shape)))-1)/2)
        # DICOM LPS: anterior is -Y; superior is +Z.
        normal,up={'anterior':([0,-1,0],[0,0,1]),'posterior':([0,1,0],[0,0,1]),'axial':([0,0,1],[0,-1,0]),'sagittal':([1,0,0],[0,0,1]),'coronal':([0,-1,0],[0,0,1])}[plane]
        camera=self.renderer.GetActiveCamera();camera.SetFocalPoint(*center);camera.SetPosition(*(center+np.asarray(normal)*500));camera.SetViewUp(*up)
        self.renderer.ResetCamera();self.renderer.ResetCameraClippingRange()

    def benchmark(self, rotations=12):
        start=time.perf_counter();self.window.Render();first=time.perf_counter()-start
        timings=[];self.set_quality(True)
        for _ in range(rotations):
            self.renderer.GetActiveCamera().Azimuth(360/rotations)
            start=time.perf_counter();self.window.Render();timings.append(time.perf_counter()-start)
        self.set_quality(False);start=time.perf_counter();self.window.Render();still=time.perf_counter()-start
        return {'warmRenderSeconds':round(first,4),'interactiveMedianMs':round(float(np.median(timings))*1000,2),
                'interactiveMaxMs':round(max(timings)*1000,2),'stillFrameMs':round(still*1000,2),'dimensions':list(reversed(self.values.shape)),
                'allSlicesUsed':True,'quality':self.quality,'mapper':self.mapper.GetClassName()}

    def close(self):
        self.renderer.RemoveVolume(self.actor)
        self.window.RemoveRenderer(self.renderer)
        self.mapper.ReleaseGraphicsResources(self.window)
        self.mapper.RemoveAllInputs()
        self.image.GetPointData().Initialize()
        self.scalars=None
        self.values=None
        self.data=None
