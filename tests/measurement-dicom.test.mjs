import {test} from 'node:test';
import assert from 'node:assert/strict';
import dicomParser from 'dicom-parser';
import {createMeasurementDicom} from '../lib/measurement-dicom.ts';

test('measured X-ray is a separate valid RGB DICOM with source reference',async()=>{
 const source={studyUID:'1.2.826.0.1.3680043.10.54321.1',sopUID:'1.2.826.0.1.3680043.10.54321.2',sopClassUID:'1.2.840.10008.5.1.4.1.1.1',patientName:'TEST^PATIENT',patientId:'QA-1',studyDate:'20261117',studyTime:'100000',accessionNumber:'A1',studyDescription:'Scoliosis',birthDate:'19900101',patientSex:'F',instanceNumber:'1'};
 const blob=await createMeasurementDicom(source,2,1,new Uint8ClampedArray([255,0,0,255,0,255,0,255]));
 assert.equal(blob.type,'application/dicom');
 const bytes=new Uint8Array(await blob.arrayBuffer());
 assert.equal(new TextDecoder().decode(bytes.subarray(128,132)),'DICM');
 const ds=dicomParser.parseDicom(bytes);
 assert.equal(ds.string('x00080016'),'1.2.840.10008.5.1.4.1.1.7');
 assert.equal(ds.string('x0020000d'),source.studyUID);
 assert.equal(ds.string('x00100020'),source.patientId);
 assert.equal(ds.uint16('x00280010'),1);assert.equal(ds.uint16('x00280011'),2);
 assert.equal(ds.string('x00280004'),'RGB');
 const pixel=ds.elements.x7fe00010;assert.deepEqual([...bytes.subarray(pixel.dataOffset,pixel.dataOffset+6)],[255,0,0,0,255,0]);
 assert.equal(ds.string('x00280301'),'YES');
 const ref=ds.elements.x00082112;assert.ok(ref,'source image reference exists');
 assert.notEqual(ds.string('x00080018'),source.sopUID);
});
