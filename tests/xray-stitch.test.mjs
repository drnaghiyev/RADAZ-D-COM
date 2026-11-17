import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyCrop,sanitizeCrop,stitchLayout} from '../lib/xray-stitch.ts';

test('cropping and dragging change only derived projection bounds',()=>{
 const top={width:200,height:400,pixels:new Uint8Array(80000)},bottom={width:200,height:400,pixels:new Uint8Array(80000)};
 const options={crops:[emptyCrop(),emptyCrop()],offsetX:0,offsetY:360,lowerScale:1,brightness:[0,0],contrast:[1,1],feather:true};
 const initial=stitchLayout([top,bottom],options);
 assert.deepEqual([initial.width,initial.height],[200,760]);
 const crop=sanitizeCrop({left:20,right:10,top:25,bottom:30},bottom);
 const moved=stitchLayout([top,bottom],{...options,offsetX:15,offsetY:340,crops:[emptyCrop(),crop]});
 assert.equal(moved.rects[1].x,35);assert.equal(moved.rects[1].y,365);
 assert.equal(moved.rects[1].width,170);assert.equal(moved.rects[1].height,345);
 assert.equal(moved.width,205);assert.equal(moved.height,710);
 assert.deepEqual(options.crops[1],emptyCrop(),'source crop settings are not mutated');
});

test('crop edges cannot erase the entire radiograph',()=>{
 const image={width:100,height:80,pixels:new Uint8Array(8000)};
 const crop=sanitizeCrop({left:95,right:95,top:75,bottom:75},image);
 assert.ok(image.width-crop.left-crop.right>=16);
 assert.ok(image.height-crop.top-crop.bottom>=16);
});
