import * as tools from '@cornerstonejs/tools';
import { getEnabledElement } from '@cornerstonejs/core';
import { measurementState, measurementTheme } from './measurement-theme';
const hoverEvents=new WeakMap<HTMLElement,{event:unknown;uid?:string}>();
const leaveListeners=new WeakSet<HTMLElement>();

/** Keep Cornerstone hit testing/geometry; apply one theme to every annotation state. */
export function themedMeasurement(Base: any) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...args);
      // Screen-pixel hit targets stay easy to catch regardless of image zoom.
      const near = this.isPointNearTool.bind(this);
      this.isPointNearTool = (element:any, annotation:any, point:any, proximity:number, ...rest:any[]) => {
        if (Base.toolName === tools.EllipticalROITool.toolName) {
          const viewport = getEnabledElement(element)?.viewport;
          if (!viewport) return false;
          const [bottom, top, left, right] = annotation.data.handles.points.map((p:any) => viewport.worldToCanvas(p));
          const rx = Math.hypot(right[0]-left[0], right[1]-left[1])/2;
          const ry = Math.hypot(top[0]-bottom[0], top[1]-bottom[1])/2;
          if (rx > 0 && ry > 0) {
            const dx = point[0]-(left[0]+right[0])/2, dy = point[1]-(left[1]+right[1])/2;
            const u = (dx*(right[0]-left[0])+dy*(right[1]-left[1]))/(2*rx*rx);
            const v = (dx*(top[0]-bottom[0])+dy*(top[1]-bottom[1]))/(2*ry*ry);
            if (u*u+v*v <= 1) return true;
          }
        }
        return near(element, annotation, point, Math.max(proximity, 12), ...rest);
      };
      const handle = this.getHandleNearImagePoint.bind(this);
      this.getHandleNearImagePoint = (element:any, annotation:any, point:any, proximity:number) =>
        handle(element, annotation, point, Math.max(proximity, 14));
      const move=this.mouseMoveCallback.bind(this);
      this.mouseMoveCallback=(event:any,annotations:any[])=>{
        let redraw=move(event,annotations);
        const element=event.detail.element as HTMLDivElement;
        if(!leaveListeners.has(element)){
          leaveListeners.add(element);
          element.addEventListener('pointerleave',()=>{
            for(const Tool of [tools.LengthTool,tools.AngleTool,tools.CobbAngleTool,tools.EllipticalROITool]){
              for(const annotation of tools.annotation.state.getAnnotations(Tool.toolName,element)||[])annotation.highlighted=false;
            }
            hoverEvents.delete(element);tools.utilities.triggerAnnotationRender(element);
          });
        }
        let hover=hoverEvents.get(element);
        if(hover?.event!==event){hover={event};hoverEvents.set(element,hover);}
        for(const annotation of annotations||[])if(annotation.highlighted){
          if(!hover!.uid)hover!.uid=annotation.annotationUID;
          else if(hover!.uid!==annotation.annotationUID){annotation.highlighted=false;redraw=true;}
        }
        return redraw;
      };
      const baseStyle = this.getAnnotationStyle.bind(this);
      this.getAnnotationStyle = (context: any) => {
        const annotation = context.annotation;
        const drawing = !!this.editData?.newAnnotation && this.editData.annotation === annotation;
        const state = measurementState(drawing, tools.annotation.selection.isAnnotationSelected(annotation.annotationUID), !!annotation.highlighted);
        const style = measurementTheme[state];
        return { ...baseStyle(context), color: style.color, lineWidth: style.width, lineDash: style.dash, shadow: true };
      };
      if (Base.toolName !== tools.LengthTool.toolName) return;
      const render = this.renderAnnotation.bind(this);
      this.renderAnnotation = (enabled: any, svg: any) => {
        const result = render(enabled, svg);
        const annotations = this.filterInteractableAnnotationsForElement(enabled.viewport.element,
          tools.annotation.state.getAnnotations(Base.toolName, enabled.viewport.element) || []);
        for (const annotation of annotations) {
          const uid = annotation.annotationUID;
          if (!uid || !tools.annotation.visibility.isAnnotationVisible(uid)) continue;
          const style = this.getAnnotationStyle({ annotation, styleSpecifier: { annotationUID: uid, toolName: Base.toolName, viewportId: enabled.viewport.id, toolGroupId: this.toolGroupId } });
          annotation.data.handles.points.forEach((point: number[], index: number) => {
            const [x, y] = enabled.viewport.worldToCanvas(point), r = measurementTheme.markerRadius;
            for (const sign of [-1, 1]) {
              const a: [number, number] = [x-r, y-sign*r], b: [number, number] = [x+r, y+sign*r];
              tools.drawing.drawLine(svg, uid, `end-halo-${index}-${sign}`, a, b, { color: measurementTheme.halo, lineWidth: style.lineWidth + 2 });
              tools.drawing.drawLine(svg, uid, `end-x-${index}-${sign}`, a, b, { color: style.color, lineWidth: style.lineWidth }, `${uid}-endpoint-${index}`);
            }
          });
        }
        return result;
      };
    }
  };
}

export function installMeasurementTheme() {
  const theme = measurementTheme;
  const styles = tools.annotation.config.style.getDefaultToolStyles();
  tools.annotation.config.style.setDefaultToolStyles({ ...styles, global: { ...styles.global,
    color: theme.normal.color, colorHighlighted: theme.hover.color, colorSelected: theme.selected.color,
    lineWidth: String(theme.normal.width), lineWidthHighlighted: String(theme.hover.width), lineWidthSelected: String(theme.selected.width),
    textBoxColor: theme.normal.color, textBoxColorHighlighted: theme.hover.color, textBoxColorSelected: theme.selected.color,
    textBoxBackground: '#071018df', textBoxFontSize: '17px', shadow: true,
  } });
}
