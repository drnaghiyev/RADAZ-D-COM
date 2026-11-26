import type {Frame,Style} from '@/lib/vr/scene';
import {orientationFaces,orientationText} from '@/lib/vr/output';

/** Keep the labels in the popup document even when the volume canvas is replaced. */
export function VrOrientation({camera,style}:{camera:Frame;style:Style}){
  const text=orientationText(camera,style);
  return <div className="vr-orientation">
    <span className="vr-dir-top">{text.top}</span>
    <span className="vr-dir-bottom">{text.bottom}</span>
    <span className="vr-dir-left">{text.left}</span>
    <span className="vr-dir-right">{text.right}</span>
    <span className="vr-windowing">{text.windowing}</span>
    <svg viewBox="0 0 94 94" role="img" aria-label="DICOM LPS">
      {orientationFaces(camera,23,47,47).map(face=><g key={face.key} transform={`matrix(${face.matrix.join(' ')})`}>
        <rect x="-23" y="-23" width="46" height="46" fill={face.color} stroke="#bbc8c9"/>
        <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize="31" fontWeight="bold">{face.key}</text>
      </g>)}
    </svg>
  </div>;
}
