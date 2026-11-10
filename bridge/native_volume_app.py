"""Optional local PySide6/VTK 3D preview. Existing web editor remains authoritative."""
import argparse
import json
from pathlib import Path
import sys
import threading
import time

from PySide6.QtCore import QObject, Signal, QTimer, Qt
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox, QSlider, QToolBar, QDockWidget, QProgressBar, QMessageBox
from vtkmodules.qt.QVTKRenderWindowInteractor import QVTKRenderWindowInteractor
from vtkmodules.vtkInteractionStyle import vtkInteractorStyleTrackballCamera
from native_volume_data import archive_paths, load_dicom, load_handoff, synthetic_volume
from native_volume_render import NativeVolumeScene, PRESETS


class Signals(QObject):
    loaded=Signal(object)
    failed=Signal(str)
    progress=Signal(int,int)


class VolumeWindow(QMainWindow):
    def __init__(self,args):
        super().__init__()
        self.args=args;self.scene=None;self.closed=False;self.mode='rotate';self.drag=None;self.started=time.perf_counter()
        self.setWindowTitle('RADAZ · Native 3D — lokal sınaq')
        self.resize(1280,850)
        self.setStyleSheet('QMainWindow,QWidget {background:#0b1720;color:#dbeaf2;} QToolBar {spacing:7px;padding:6px;border-bottom:1px solid #304b5b;} QToolButton,QComboBox {padding:7px;background:#183242;border:1px solid #3a5968;border-radius:4px;} QToolButton:checked {background:#286382;} QDockWidget {font-size:14px;}')
        container=QWidget();layout=QVBoxLayout(container);layout.setContentsMargins(0,0,0,0)
        self.vtk=QVTKRenderWindowInteractor(container)
        layout.addWidget(self.vtk);self.setCentralWidget(container)
        self.status=self.statusBar();self.progress=QProgressBar();self.progress.setMaximumWidth(300);self.status.addPermanentWidget(self.progress)
        self.status.showMessage('Seriya hazırlanır…')
        self.signals=Signals();self.signals.loaded.connect(self.loaded);self.signals.failed.connect(self.failed);self.signals.progress.connect(self.update_progress)
        self.toolbar=QToolBar('3D');self.toolbar.setMovable(True);self.addToolBar(self.toolbar)
        self.presets=QComboBox();self.presets.setMinimumWidth(125)
        for definition in PRESETS: self.presets.addItem(definition['title'],definition['key'])
        self.presets.currentIndexChanged.connect(self.change_preset);self.toolbar.addWidget(self.presets)
        self.quality=QComboBox()
        for text,key in [('Sürətli','performance'),('Balans','balanced'),('Yüksək','high')]:self.quality.addItem(text,key)
        self.quality.setCurrentIndex(1);self.quality.currentIndexChanged.connect(self.change_quality);self.toolbar.addWidget(self.quality)
        self.tool_actions={}
        for name,label,shortcut in [('rotate','↻ Fırlat','R'),('pan','✥ Pan','P'),('zoom','⊕ Zoom','Z'),('window','◐ WW/WL','W')]:
            action=QAction(label,self);action.setCheckable(True);action.setChecked(name=='rotate');action.setShortcut(shortcut)
            action.triggered.connect(lambda checked,n=name:self.set_mode(n));self.toolbar.addAction(action);self.tool_actions[name]=action
        self.toolbar.addSeparator()
        for name,label in [('axial','Axial'),('coronal','Coronal'),('sagittal','Sagittal'),('anterior','Sıfırla')]:
            action=QAction(label,self);action.triggered.connect(lambda checked,n=name:self.view(n));self.toolbar.addAction(action)
        self.rotate_action=QAction('360°',self);self.rotate_action.setCheckable(True);self.rotate_action.toggled.connect(self.auto_rotate);self.toolbar.addAction(self.rotate_action)
        self.rotation=QTimer(self);self.rotation.setInterval(50);self.rotation.timeout.connect(self.rotate_step)
        self.settle=QTimer(self);self.settle.setSingleShot(True);self.settle.setInterval(180);self.settle.timeout.connect(self.still)
        self.make_crop_panel()
        self.toolbar.addAction(self.crop_dock.toggleViewAction())
        close=QAction('Bağla',self);close.setShortcut('Escape');close.triggered.connect(self.close);self.toolbar.addAction(close)
        self.toolbar.setEnabled(False)
        QTimer.singleShot(0,lambda:threading.Thread(target=self.load,daemon=True).start())

    def load(self):
        try:
            if self.args.handoff:data=load_handoff(self.args.handoff)
            elif self.args.synthetic:data=synthetic_volume(self.args.size,self.args.slices)
            else:data=load_dicom(archive_paths(self.args.archive_root,self.args.series),self.signals.progress.emit)
            self.signals.loaded.emit(data)
        except Exception as error:self.signals.failed.emit(str(error))

    def loaded(self,data):
        if self.closed:return
        try:
            self.scene=NativeVolumeScene(self.vtk.GetRenderWindow(),data)
            self.style=vtkInteractorStyleTrackballCamera();self.style.SetDefaultRenderer(self.scene.renderer)
            self.vtk.SetInteractorStyle(self.style)
            self.style.AddObserver('LeftButtonPressEvent',self.press)
            self.style.AddObserver('LeftButtonReleaseEvent',self.release)
            self.style.AddObserver('MouseMoveEvent',self.move)
            self.style.AddObserver('StartInteractionEvent',lambda *_:self.interacting())
            self.style.AddObserver('EndInteractionEvent',lambda *_:self.settle.start())
            self.vtk.Initialize()
            target=self.args.preset or self.scene.preset
            self.presets.setCurrentIndex(max(0,self.presets.findData(target)))
            self.change_preset();self.toolbar.setEnabled(True);self.progress.hide()
            self.status.showMessage(f'{data.values.shape[2]} × {data.values.shape[1]} × {data.values.shape[0]} · bütün kəsiklər · native VTK · sol düymə: seçilmiş alət; orta: pan; sağ: zoom')
            self.vtk.GetRenderWindow().Render()
            self.ready_seconds=time.perf_counter()-self.started
            print('RADAZ_NATIVE_READY',flush=True)
            if self.args.smoke_output:
                QTimer.singleShot(250,self.smoke)
        except Exception as error:self.failed(str(error))

    def update_progress(self,value,total):self.progress.setRange(0,total);self.progress.setValue(value)
    def failed(self,error):
        print('RADAZ_NATIVE_ERROR:'+('memory' if error.startswith('native_memory:') else 'invalid-source'),flush=True)
        print('RADAZ_NATIVE_ERROR: '+error,file=sys.stderr,flush=True)
        self.progress.hide();self.status.showMessage(error)
        if self.args.smoke_output:
            Path(self.args.smoke_output).write_text(json.dumps({'error':error}),encoding='utf-8');self.close()
        else:QMessageBox.warning(self,'RADAZ Native 3D',error+'\nMövcud Viewer və Smart Volume işləməyə davam edir.')
    def change_preset(self):
        if self.scene:self.scene.preset=self.presets.currentData();self.scene.apply_transfer();self.vtk.GetRenderWindow().Render()
    def change_quality(self):
        if self.scene:self.scene.quality=self.quality.currentData();self.scene.set_quality(False);self.vtk.GetRenderWindow().Render()
    def set_mode(self,mode):
        self.mode=mode
        for name,action in self.tool_actions.items():action.setChecked(name==mode)
        self.vtk.setCursor({'rotate':Qt.CursorShape.OpenHandCursor,'pan':Qt.CursorShape.SizeAllCursor,'zoom':Qt.CursorShape.SizeVerCursor,'window':Qt.CursorShape.CrossCursor}[mode])
    def press(self,*_):
        if not self.scene:return
        x,y=self.vtk.GetRenderWindow().GetInteractor().GetEventPosition();self.style.FindPokedRenderer(x,y);self.interacting()
        if self.mode=='window':self.drag=(x,y,self.scene.shift,self.scene.width)
        else:{'rotate':self.style.StartRotate,'pan':self.style.StartPan,'zoom':self.style.StartDolly}[self.mode]()
    def release(self,*_):
        self.drag=None;self.style.StopState();self.settle.start()
    def move(self,*_):
        if self.drag:
            x,y=self.vtk.GetRenderWindow().GetInteractor().GetEventPosition();ox,oy,shift,width=self.drag
            self.scene.shift=shift+(y-oy)*2;self.scene.width=max(.1,min(5,width+(x-ox)/200));self.scene.apply_transfer();self.vtk.GetRenderWindow().Render()
        else:self.style.OnMouseMove()
    def interacting(self):
        if self.scene:self.settle.stop();self.scene.set_quality(True)
    def still(self):
        if self.scene and not self.rotation.isActive():self.scene.set_quality(False);self.vtk.GetRenderWindow().Render()
    def view(self,plane):
        if self.scene:self.scene.view(plane);self.vtk.GetRenderWindow().Render()
    def auto_rotate(self,enabled):
        if enabled:self.interacting();self.rotation.start()
        else:self.rotation.stop();self.still()
    def rotate_step(self):
        if self.scene:self.scene.renderer.GetActiveCamera().Azimuth(1.5);self.vtk.GetRenderWindow().Render()
    def make_crop_panel(self):
        self.crop_dock=QDockWidget('Kəsim / şəffaflıq',self);self.crop_dock.setAllowedAreas(Qt.DockWidgetArea.LeftDockWidgetArea|Qt.DockWidgetArea.RightDockWidgetArea)
        content=QWidget();layout=QVBoxLayout(content);self.crop_sliders=[]
        layout.addWidget(QLabel('Mənbə piksel məlumatı dəyişdirilmir.'))
        for axis in ('Sagittal','Coronal','Axial'):
            layout.addWidget(QLabel(axis))
            for label,initial in [('Min',0),('Max',1000)]:
                row=QHBoxLayout();row.addWidget(QLabel(label));slider=QSlider(Qt.Orientation.Horizontal);slider.setRange(0,1000);slider.setValue(initial);row.addWidget(slider);layout.addLayout(row);self.crop_sliders.append(slider)
                slider.valueChanged.connect(self.crop_changed)
        layout.addWidget(QLabel('Şəffaflıq'))
        opacity=QSlider(Qt.Orientation.Horizontal);opacity.setRange(0,150);opacity.setValue(100);opacity.valueChanged.connect(self.opacity_changed);layout.addWidget(opacity)
        reset=QAction('Kəsimi sıfırla',self);reset.triggered.connect(self.reset_crop);self.toolbar.addAction(reset)
        layout.addStretch();self.crop_dock.setWidget(content);self.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea,self.crop_dock);self.crop_dock.hide()
    def reset_crop(self):
        for n,slider in enumerate(self.crop_sliders):slider.setValue(1000 if n%2 else 0)
    def crop_changed(self):
        if not self.scene:return
        values=[slider.value()/1000 for slider in self.crop_sliders]
        for axis in range(3):values[axis*2:axis*2+2]=sorted(values[axis*2:axis*2+2])
        self.scene.set_crop(values);self.interacting();self.vtk.GetRenderWindow().Render();self.settle.start()
    def opacity_changed(self,value):
        if self.scene:self.scene.opacity=value/100;self.scene.apply_transfer();self.vtk.GetRenderWindow().Render()
    def smoke(self):
        output=self.scene.benchmark();self.scene.set_crop([.1,.9,0,1,0,1]);self.view('sagittal');self.view('anterior')
        if self.args.synthetic:
            from vtkmodules.vtkRenderingCore import vtkWindowToImageFilter
            from vtkmodules.vtkIOImage import vtkPNGWriter
            capture=vtkWindowToImageFilter();capture.SetInput(self.vtk.GetRenderWindow());capture.ReadFrontBufferOff();capture.Update()
            writer=vtkPNGWriter();writer.SetFileName(str(Path(self.args.smoke_output).with_suffix('.png')));writer.SetInputConnection(capture.GetOutputPort());writer.Write()
        output['cropAndOrientationSmoke']=True;output['qtWindowCreated']=True;output['loadToReadySeconds']=round(self.ready_seconds,3)
        Path(self.args.smoke_output).write_text(json.dumps(output,indent=2),encoding='utf-8');self.close()
    def closeEvent(self,event):
        self.closed=True;self.rotation.stop();self.settle.stop()
        if self.scene:self.scene.close();self.scene=None
        self.vtk.Finalize();super().closeEvent(event)


def main():
    parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--handoff');group.add_argument('--archive-root');group.add_argument('--synthetic',action='store_true')
    parser.add_argument('--series');parser.add_argument('--preset',choices=[p['key'] for p in PRESETS]);parser.add_argument('--size',type=int,default=128);parser.add_argument('--slices',type=int)
    parser.add_argument('--smoke-output');args=parser.parse_args()
    if args.archive_root and not args.series:parser.error('--series is required with --archive-root')
    app=QApplication(sys.argv[:1]);window=VolumeWindow(args)
    if args.smoke_output:window.show()
    else:window.showMaximized()
    return app.exec()

if __name__=='__main__':sys.exit(main())
