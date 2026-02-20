---
name: japan simulated
slug: japan-simulated
date: '2026-02-20'
pinned: false
draft: true
video:
  hls: https://d17y8p6t5eu2ht.cloudfront.net/videos/japan-simulated/1771550729/master.m3u8
  thumbnail: https://d17y8p6t5eu2ht.cloudfront.net/images/thumbnails/japan-simulated_1771554215.webp
  spriteSheet: https://d17y8p6t5eu2ht.cloudfront.net/images/sprite-sheets/japan-simulated_1771554215_sprite_sheet.jpg
---

<!-- block -->

![]()

<!-- block -->

<!-- html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;overflow:hidden;background:#0a0a0f}
#container{width:100%;aspect-ratio:1;position:relative;border-radius:8px;overflow:hidden}
canvas{width:100%;height:100%;display:block;touch-action:none;position:absolute;inset:0}
#ui{
  position:absolute;
  bottom:0;
  left:0;
  right:0;
  padding:12px;
  display:flex;
  justify-content:flex-end;
  align-items:center;
  color:rgba(255,255,255,0.5);
  font:11px/1.4 system-ui,-apple-system,sans-serif;
  pointer-events:none
}
#loading{
  position:absolute;
  inset:0;
  border-radius:8px;
  display:flex;
  align-items:center;
  justify-content:center;
  color:rgba(255,255,255,0.6);
  font:14px system-ui;
  background:#0a0a0f
}
.spinner{
  width:24px;
  height:24px;
  border:2px solid rgba(255,255,255,0.2);
  border-top-color:rgba(255,255,255,0.6);
  border-radius:50%;
  animation:spin 0.8s linear infinite;
  margin-right:12px
}
@keyframes spin{to{transform:rotate(360deg)}}
#hint{opacity:0;transition:opacity 0.3s}
body:not(.loaded) #hint{display:none}
body.loaded #hint{opacity:1}
</style>
</head>
<body>

<div id="container">
  <canvas id="c"></canvas>
  <div id="loading">
    <div class="spinner"></div>
    Loading splat...
  </div>
  <div id="ui">
    <span id="hint">Move cursor to look, drag/touch to orbit, scroll/pinch to zoom</span>
  </div>
</div>

<script>
const SPLAT_PRESETS={
'IMG_6930.qsplat':{
viewMode:'foreground',
rot:[-0.05,-0.14],
distance:3.2,
target:[-0.22,-0.08,-1.28]
}
};

const VS=`#version 300 es
precision highp float;
uniform mat4 P,V;
uniform vec2 F,S;
in vec3 p,s;
in vec4 c,q;
in vec2 v;
out vec4 C;
out vec2 U;
mat3 qm(vec4 r){
float x=r.x,y=r.y,z=r.z,w=r.w;
return mat3(
1.-2.*(y*y+z*z),2.*(x*y-z*w),2.*(x*z+y*w),
2.*(x*y+z*w),1.-2.*(x*x+z*z),2.*(y*z-x*w),
2.*(x*z-y*w),2.*(y*z+x*w),1.-2.*(x*x+y*y)
);
}
void main(){
vec4 vp=V*vec4(p,1.0),cp=P*vp;
if(cp.w<=0.0001){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
mat3 R=qm(q),Sc=mat3(s.x,0.0,0.0,0.0,s.y,0.0,0.0,0.0,s.z);
mat3 c3=R*Sc*Sc*transpose(R);
mat3 vR=mat3(V);
float z=vp.z,z2=max(z*z,1e-6);
mat3 J=mat3(F.x/z,0.0,0.0,0.0,F.y/z,0.0,-F.x*vp.x/z2,-F.y*vp.y/z2,0.0);
mat3 T=J*vR;
mat3 c2=T*c3*transpose(T);
float a=c2[0][0]+0.2,b=c2[0][1],d=c2[1][1]+0.2;
float dt=a*d-b*b,tr=a+d;
float dc=sqrt(max(tr*tr*0.25-dt,0.0));
float l1=tr*0.5+dc,l2=tr*0.5-dc;
float r1=3.0*sqrt(max(l1,0.0)),r2=3.0*sqrt(max(l2,0.0));
float an=0.5*atan(2.0*b,a-d);
float ca=cos(an),sa=sin(an);
vec2 qp=v*vec2(r1,r2);
vec2 rp=vec2(ca*qp.x-sa*qp.y,sa*qp.x+ca*qp.y);
gl_Position=cp/cp.w+vec4(rp/S*2.0,0.0,0.0);
gl_Position.w=1.0;
C=c;U=v;
}`;

const FS=`#version 300 es
precision highp float;
in vec4 C;
in vec2 U;
out vec4 O;
void main(){
float d=dot(U,U);
if(d>1.0)discard;
float a=exp(-d*3.0)*C.a;
if(a<0.003)discard;
O=vec4(C.rgb*a,a);
}`;

class SplatViewer{
constructor(canvas){
this.c=canvas;
this.loadingEl=document.getElementById('loading');
this.gl=canvas.getContext('webgl2',{antialias:false,alpha:false,premultipliedAlpha:true,powerPreference:'high-performance'});
if(!this.gl)throw new Error('WebGL2 not supported');
this.rot=[0.12,Math.PI];
this.distance=2;
this.zoomTarget=2;
this.minDistance=0.2;
this.maxDistance=400;
this.sceneRadius=1;
this.tgt=[0,0,0];
this.drag=false;
this.lm=[0,0];
this.pinch=0;
this.sortDirty=true;
this.lastSortAt=0;
this.sortInterval=90;
this.viewMode='scene';
this.fullTarget=[0,0,0];
this.fullDistance=2;
this.flipX180=true;
this.controlMode='guided';
this.guidedLimits={pitch:0.34,yaw:0.62,zoom:0.38};
this.guidedSnap=0.011;
this.rotateSpeed=0.0026;
this.zoomSpeed=0.0011;
this.zoomLerpPerMs=0.015;
this.snapHoldMs=170;
this.zoomSortInterval=170;
this.lastInteractionAt=0;
this.hasFinePointer=window.matchMedia('(pointer:fine)').matches;
this.hoverEnabled=this.hasFinePointer;
this.hoverActive=false;
this.hoverNorm=[0,0];
this.hoverStrength={pitch:0.7,yaw:0.7};
this.hoverLerpPerMs=0.012;
this.homeReady=false;
this.homeRot=[0,0];
this.homeDistance=2;
this.homeTarget=[0,0,0];
this.lastFrameAt=0;
this.renderBound=()=>this.render();
this.init();
}

init(){
const gl=this.gl;
this.prg=this.createProgram(VS,FS);
this.u={
P:gl.getUniformLocation(this.prg,'P'),
V:gl.getUniformLocation(this.prg,'V'),
F:gl.getUniformLocation(this.prg,'F'),
S:gl.getUniformLocation(this.prg,'S')
};
this.a={
p:gl.getAttribLocation(this.prg,'p'),
s:gl.getAttribLocation(this.prg,'s'),
c:gl.getAttribLocation(this.prg,'c'),
q:gl.getAttribLocation(this.prg,'q'),
v:gl.getAttribLocation(this.prg,'v')
};
gl.disable(gl.DEPTH_TEST);
gl.disable(gl.CULL_FACE);
gl.enable(gl.BLEND);
gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
this.events();
this.resize();
window.addEventListener('resize',()=>this.resize());
}

createProgram(vsSrc,fsSrc){
const gl=this.gl;
const compile=(type,src)=>{
const shader=gl.createShader(type);
gl.shaderSource(shader,src);
gl.compileShader(shader);
if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
const log=gl.getShaderInfoLog(shader)||'Unknown shader compile error';
gl.deleteShader(shader);
throw new Error(log);
}
return shader;
};
const vs=compile(gl.VERTEX_SHADER,vsSrc);
const fs=compile(gl.FRAGMENT_SHADER,fsSrc);
const program=gl.createProgram();
gl.attachShader(program,vs);
gl.attachShader(program,fs);
gl.linkProgram(program);
gl.deleteShader(vs);
gl.deleteShader(fs);
if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
const log=gl.getProgramInfoLog(program)||'Unknown program link error';
gl.deleteProgram(program);
throw new Error(log);
}
return program;
}

events(){
const c=this.c;
c.addEventListener('contextmenu',e=>e.preventDefault());
c.addEventListener('mouseenter',()=>{
if(!this.hoverEnabled)return;
this.hoverActive=true;
});
c.addEventListener('mouseleave',()=>{
this.hoverActive=false;
this.hoverNorm=[0,0];
});
c.addEventListener('mousedown',e=>{
this.drag=true;
this.lm=[e.clientX,e.clientY];
c.style.cursor='grabbing';
});
window.addEventListener('mouseup',()=>{
this.drag=false;
c.style.cursor='grab';
});
window.addEventListener('mousemove',e=>{
if(!this.drag)return;
this.lastInteractionAt=performance.now();
this.rot[0]-=(e.clientY-this.lm[1])*this.rotateSpeed;
this.rot[1]-=(e.clientX-this.lm[0])*this.rotateSpeed;
this.rot[0]=Math.max(-1.45,Math.min(1.45,this.rot[0]));
this.applyGuidedBounds();
this.lm=[e.clientX,e.clientY];
this.sortDirty=true;
});
c.addEventListener('mousemove',e=>{
if(!this.hoverEnabled||this.drag)return;
const r=this.c.getBoundingClientRect();
const nx=((e.clientX-r.left)/r.width)*2-1;
const ny=((e.clientY-r.top)/r.height)*2-1;
this.hoverNorm[0]=Math.max(-1,Math.min(1,nx));
this.hoverNorm[1]=Math.max(-1,Math.min(1,ny));
this.hoverActive=true;
this.lastInteractionAt=performance.now();
});
window.addEventListener('keydown',e=>{
if(e.key==='f'||e.key==='F'){
this.focusForegroundFromCurrentSort();
}else if(e.key==='r'||e.key==='R'){
this.resetView();
}else if(e.key==='u'||e.key==='U'){
this.toggleFlipX180();
}
});
c.addEventListener('wheel',e=>{
e.preventDefault();
this.lastInteractionAt=performance.now();
const dy=Math.max(-80,Math.min(80,e.deltaY));
this.zoomTarget*=Math.exp(dy*this.zoomSpeed);
this.zoomTarget=Math.max(this.minDistance,Math.min(this.maxDistance,this.zoomTarget));
this.applyGuidedBounds();
this.sortDirty=true;
},{passive:false});
c.addEventListener('touchstart',e=>{
if(e.touches.length===1){
this.drag=true;
this.lm=[e.touches[0].clientX,e.touches[0].clientY];
}else if(e.touches.length===2){
this.pinch=Math.hypot(
e.touches[1].clientX-e.touches[0].clientX,
e.touches[1].clientY-e.touches[0].clientY
);
}
},{passive:false});
c.addEventListener('touchmove',e=>{
e.preventDefault();
if(e.touches.length===1&&this.drag){
this.lastInteractionAt=performance.now();
this.rot[0]-=(e.touches[0].clientY-this.lm[1])*this.rotateSpeed;
this.rot[1]-=(e.touches[0].clientX-this.lm[0])*this.rotateSpeed;
this.rot[0]=Math.max(-1.45,Math.min(1.45,this.rot[0]));
this.applyGuidedBounds();
this.lm=[e.touches[0].clientX,e.touches[0].clientY];
this.sortDirty=true;
}else if(e.touches.length===2){
const d=Math.hypot(
e.touches[1].clientX-e.touches[0].clientX,
e.touches[1].clientY-e.touches[0].clientY
);
if(this.pinch>0){
this.lastInteractionAt=performance.now();
this.zoomTarget*=Math.exp((this.pinch-d)*0.0032);
this.zoomTarget=Math.max(this.minDistance,Math.min(this.maxDistance,this.zoomTarget));
this.applyGuidedBounds();
this.sortDirty=true;
}
this.pinch=d;
}
},{passive:false});
c.addEventListener('touchend',()=>{
this.drag=false;
this.pinch=0;
});
}

resize(){
const dpr=Math.min(window.devicePixelRatio||1,2);
this.c.width=Math.max(1,Math.floor(this.c.clientWidth*dpr));
this.c.height=Math.max(1,Math.floor(this.c.clientHeight*dpr));
this.gl.viewport(0,0,this.c.width,this.c.height);
}

async load(url){
const res=await fetch(url);
if(!res.ok)throw new Error('Failed to fetch splat: '+res.status);
let arr=new Uint8Array(await res.arrayBuffer());
if(arr[0]===0x1f&&arr[1]===0x8b){
if(typeof DecompressionStream==='undefined'){
throw new Error('Gzip splat requires DecompressionStream support');
}
const stream=new Blob([arr]).stream().pipeThrough(new DecompressionStream('gzip'));
arr=new Uint8Array(await new Response(stream).arrayBuffer());
}
const magic=String.fromCharCode(...arr.slice(0,4));
let parsed;
if(magic==='QSPL'){
const view=new DataView(arr.buffer,arr.byteOffset,arr.byteLength);
this.cnt=view.getUint32(4,true);
const payloadOffset=arr.byteOffset+32;
const payloadLength=Math.max(arr.byteLength-32,0);
if(payloadLength<this.cnt*20)throw new Error('QSPL payload is truncated');
parsed=this.parseQ(new Uint8Array(arr.buffer,payloadOffset,payloadLength),this.cnt);
}else{
this.cnt=Math.floor(arr.byteLength/32);
parsed=this.parseS(arr,this.cnt);
}
if(!this.cnt)throw new Error('No splats found');
this.splats=parsed;
if(this.flipX180)this.applyFlipX180ToSplats();
this.center();
this.applyPresetForUrl(url);
this.prepareSortData();
this.setup();
const cam=this.cameraState();
this.sortAndUpload(cam.eye,cam.forward,true);
if(!this.homeReady){
this.focusForegroundFromCurrentSort(true);
const cam2=this.cameraState();
this.sortAndUpload(cam2.eye,cam2.forward,true);
}
this.setHomeFromCurrent();
this.loadingEl.style.display='none';
document.body.classList.add('loaded');
this.c.style.cursor='grab';
}

parseS(d,n){
const r={p:new Float32Array(n*3),s:new Float32Array(n*3),c:new Float32Array(n*4),q:new Float32Array(n*4)};
for(let i=0;i<n;i++){
const b=i*32,v=new DataView(d.buffer,d.byteOffset+b,32);
r.p[i*3]=v.getFloat32(0,true);
r.p[i*3+1]=v.getFloat32(4,true);
r.p[i*3+2]=v.getFloat32(8,true);
r.s[i*3]=Math.exp(v.getFloat32(12,true));
r.s[i*3+1]=Math.exp(v.getFloat32(16,true));
r.s[i*3+2]=Math.exp(v.getFloat32(20,true));
r.c[i*4]=d[b+24]/255;
r.c[i*4+1]=d[b+25]/255;
r.c[i*4+2]=d[b+26]/255;
r.c[i*4+3]=d[b+27]/255;
const w=(d[b+28]-128)/128,x=(d[b+29]-128)/128,y=(d[b+30]-128)/128,z=(d[b+31]-128)/128;
const l=Math.sqrt(w*w+x*x+y*y+z*z)||1;
r.q[i*4]=x/l;
r.q[i*4+1]=y/l;
r.q[i*4+2]=z/l;
r.q[i*4+3]=w/l;
}
return r;
}

parseQ(d,n){
const r={p:new Float32Array(n*3),s:new Float32Array(n*3),c:new Float32Array(n*4),q:new Float32Array(n*4)};
const sMin=-12,sMax=0;
for(let i=0;i<n;i++){
const b=i*20,v=new DataView(d.buffer,d.byteOffset+b,20);
r.p[i*3]=this.f16(v.getUint16(0,true));
r.p[i*3+1]=this.f16(v.getUint16(2,true));
r.p[i*3+2]=this.f16(v.getUint16(4,true));
r.s[i*3]=Math.exp((d[b+6]/255)*(sMax-sMin)+sMin);
r.s[i*3+1]=Math.exp((d[b+7]/255)*(sMax-sMin)+sMin);
r.s[i*3+2]=Math.exp((d[b+8]/255)*(sMax-sMin)+sMin);
r.c[i*4]=d[b+9]/255;
r.c[i*4+1]=d[b+10]/255;
r.c[i*4+2]=d[b+11]/255;
r.c[i*4+3]=d[b+12]/255;
const w=(d[b+13]-128)/128,x=(d[b+14]-128)/128,y=(d[b+15]-128)/128,z=(d[b+16]-128)/128;
const l=Math.sqrt(w*w+x*x+y*y+z*z)||1;
r.q[i*4]=x/l;
r.q[i*4+1]=y/l;
r.q[i*4+2]=z/l;
r.q[i*4+3]=w/l;
}
return r;
}

f16(h){
const s=(h&0x8000)>>15,e=(h&0x7C00)>>10,f=h&0x03FF;
if(e===0)return(s?-1:1)*Math.pow(2,-14)*(f/1024);
if(e===0x1F)return f?NaN:(s?-Infinity:Infinity);
return(s?-1:1)*Math.pow(2,e-15)*(1+f/1024);
}

prepareSortData(){
this.order=new Uint32Array(this.cnt);
for(let i=0;i<this.cnt;i++)this.order[i]=i;
this.depth=new Float32Array(this.cnt);
this.depthBin=new Uint32Array(this.cnt);
this.draw={
p:new Float32Array(this.cnt*3),
s:new Float32Array(this.cnt*3),
c:new Float32Array(this.cnt*4),
q:new Float32Array(this.cnt*4)
};
this.binCount=this.cnt>500000?4096:this.cnt>180000?2048:1024;
this.binOffsets=new Uint32Array(this.binCount);
this.sortInterval=this.cnt>500000?200:this.cnt>180000?140:90;
}

setup(){
const gl=this.gl;
if(this.vao)gl.deleteVertexArray(this.vao);
this.vao=gl.createVertexArray();
gl.bindVertexArray(this.vao);

const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
this.quadBuffer=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,this.quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
gl.enableVertexAttribArray(this.a.v);
gl.vertexAttribPointer(this.a.v,2,gl.FLOAT,false,0,0);

const mk=(attr,size,data)=>{
const buffer=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(attr);
gl.vertexAttribPointer(attr,size,gl.FLOAT,false,0,0);
gl.vertexAttribDivisor(attr,1);
return buffer;
};

this.buffers={
p:mk(this.a.p,3,this.draw.p),
s:mk(this.a.s,3,this.draw.s),
c:mk(this.a.c,4,this.draw.c),
q:mk(this.a.q,4,this.draw.q)
};

gl.bindVertexArray(null);
}

center(){
const p=this.splats.p;
let mx=Infinity,Mx=-Infinity,my=Infinity,My=-Infinity,mz=Infinity,Mz=-Infinity;
for(let i=0;i<p.length;i+=3){
mx=Math.min(mx,p[i]);Mx=Math.max(Mx,p[i]);
my=Math.min(my,p[i+1]);My=Math.max(My,p[i+1]);
mz=Math.min(mz,p[i+2]);Mz=Math.max(Mz,p[i+2]);
}
this.tgt=[(mx+Mx)*0.5,(my+My)*0.5,(mz+Mz)*0.5];
const span=Math.max(Mx-mx,My-my,Mz-mz);
this.sceneRadius=Math.max(span*0.5,0.02);
this.distance=Math.max(this.sceneRadius*2.4,0.2);
this.zoomTarget=this.distance;
this.minDistance=Math.max(this.sceneRadius*0.05,0.05);
this.maxDistance=Math.max(this.sceneRadius*12,8);
this.fullTarget=[this.tgt[0],this.tgt[1],this.tgt[2]];
this.fullDistance=this.distance;
this.viewMode='scene';
this.sortDirty=true;
}

presetFromUrl(url){
for(const key of Object.keys(SPLAT_PRESETS)){
if(url.includes(key))return SPLAT_PRESETS[key];
}
return null;
}

applyPresetForUrl(url){
const preset=this.presetFromUrl(url);
if(!preset)return false;
if(Array.isArray(preset.rot)&&preset.rot.length===2){
this.rot=[preset.rot[0],preset.rot[1]];
}
if(Array.isArray(preset.target)&&preset.target.length===3){
this.tgt=[preset.target[0],preset.target[1],preset.target[2]];
}
if(Number.isFinite(preset.distance)){
this.distance=Math.max(this.minDistance,Math.min(this.maxDistance,preset.distance));
this.zoomTarget=this.distance;
}
if(preset.viewMode)this.viewMode=preset.viewMode;
this.setHomeFromCurrent();
this.sortDirty=true;
return true;
}

setHomeFromCurrent(){
this.homeRot=[this.rot[0],this.rot[1]];
this.homeDistance=this.zoomTarget;
this.homeTarget=[this.tgt[0],this.tgt[1],this.tgt[2]];
this.homeReady=true;
}

wrapAngle(a){
let v=a;
while(v>Math.PI)v-=Math.PI*2;
while(v<-Math.PI)v+=Math.PI*2;
return v;
}

softClamp(v,limit){
const av=Math.abs(v);
if(av<=limit)return v;
const over=av-limit;
const tail=(1-Math.exp(-over/(limit*0.85+1e-6)))*limit*0.35;
return Math.sign(v)*(limit+tail);
}

applyGuidedBounds(){
if(this.controlMode!=='guided'||!this.homeReady)return;
const pitch=this.softClamp(this.rot[0]-this.homeRot[0],this.guidedLimits.pitch);
const yaw=this.softClamp(this.wrapAngle(this.rot[1]-this.homeRot[1]),this.guidedLimits.yaw);
const zoomNorm=this.softClamp(this.zoomTarget/this.homeDistance-1,this.guidedLimits.zoom);
this.rot[0]=this.homeRot[0]+pitch;
this.rot[1]=this.homeRot[1]+yaw;
this.zoomTarget=this.homeDistance*(1+zoomNorm);
this.zoomTarget=Math.max(this.minDistance,Math.min(this.maxDistance,this.zoomTarget));
}

applyHoverOrbit(dt){
if(!this.hoverEnabled||!this.hoverActive)return;
if(this.controlMode!=='guided'||!this.homeReady)return;
if(this.drag||this.pinch>0)return;
const targetPitch=this.homeRot[0]-this.hoverNorm[1]*this.guidedLimits.pitch*this.hoverStrength.pitch;
const targetYaw=this.homeRot[1]-this.hoverNorm[0]*this.guidedLimits.yaw*this.hoverStrength.yaw;
const blend=1-Math.exp(-this.hoverLerpPerMs*dt);
const prevRot0=this.rot[0],prevRot1=this.rot[1];
this.rot[0]+=(targetPitch-this.rot[0])*blend;
this.rot[1]+=this.wrapAngle(targetYaw-this.rot[1])*blend;
this.applyGuidedBounds();
if(Math.abs(prevRot0-this.rot[0])+Math.abs(prevRot1-this.rot[1])>0.00008){
this.sortDirty=true;
}
}

applyGuidedSnap(dt,now){
if(this.controlMode!=='guided'||!this.homeReady)return;
if(this.drag||this.pinch>0)return;
if(this.hoverEnabled&&this.hoverActive)return;
if(now-this.lastInteractionAt<this.snapHoldMs)return;
const snap=1-Math.exp(-this.guidedSnap*dt);
const prevRot0=this.rot[0],prevRot1=this.rot[1],prevDist=this.zoomTarget;
this.rot[0]+=(this.homeRot[0]-this.rot[0])*snap;
this.rot[1]+=this.wrapAngle(this.homeRot[1]-this.rot[1])*snap;
this.zoomTarget+=(this.homeDistance-this.zoomTarget)*snap;
if(Math.abs(prevRot0-this.rot[0])+Math.abs(prevRot1-this.rot[1])+Math.abs(prevDist-this.zoomTarget)>0.00025){
this.sortDirty=true;
}
}

applyFlipX180ToSplats(){
if(!this.splats)return;
const p=this.splats.p;
const q=this.splats.q;
for(let i=0;i<this.cnt;i++){
const i3=i*3,i4=i*4;
p[i3+1]=-p[i3+1];
p[i3+2]=-p[i3+2];
const x=q[i4],y=q[i4+1],z=q[i4+2],w=q[i4+3];
q[i4]=w;
q[i4+1]=-z;
q[i4+2]=y;
q[i4+3]=-x;
}
}

toggleFlipX180(){
if(!this.splats)return;
this.applyFlipX180ToSplats();
this.flipX180=!this.flipX180;
this.tgt=[this.tgt[0],-this.tgt[1],-this.tgt[2]];
this.fullTarget=[this.fullTarget[0],-this.fullTarget[1],-this.fullTarget[2]];
if(this.homeReady){
this.homeTarget=[this.homeTarget[0],-this.homeTarget[1],-this.homeTarget[2]];
}
this.sortDirty=true;
const cam=this.cameraState();
this.sortAndUpload(cam.eye,cam.forward,true);
}

focusForegroundFromCurrentSort(isAuto){
if(!this.splats||!this.order||!this.order.length)return;
const take=Math.max(256,Math.min(this.cnt,Math.floor(this.cnt*0.28)));
const start=this.cnt-take;
const p=this.splats.p,s=this.splats.s,c=this.splats.c;
let wSum=0,cx=0,cy=0,cz=0;
let mx=Infinity,Mx=-Infinity,my=Infinity,My=-Infinity,mz=Infinity,Mz=-Infinity;
for(let i=start;i<this.cnt;i++){
const idx=this.order[i];
const i3=idx*3,i4=idx*4;
const alpha=Math.max(c[i4+3],0.02);
const scale=Math.max(s[i3]+s[i3+1]+s[i3+2],0.01);
const w=alpha*Math.min(scale,0.08);
const x=p[i3],y=p[i3+1],z=p[i3+2];
cx+=x*w;cy+=y*w;cz+=z*w;wSum+=w;
mx=Math.min(mx,x);Mx=Math.max(Mx,x);
my=Math.min(my,y);My=Math.max(My,y);
mz=Math.min(mz,z);Mz=Math.max(Mz,z);
}
if(wSum<=0||!Number.isFinite(wSum))return;
const nextTarget=[cx/wSum,cy/wSum,cz/wSum];
const blend=isAuto?0.65:0.9;
this.tgt=[
this.tgt[0]+(nextTarget[0]-this.tgt[0])*blend,
this.tgt[1]+(nextTarget[1]-this.tgt[1])*blend,
this.tgt[2]+(nextTarget[2]-this.tgt[2])*blend
];
const fgSpan=Math.max(Mx-mx,My-my,Mz-mz);
const fgRadius=Math.max(fgSpan*0.45,this.sceneRadius*0.15);
const nextDistance=Math.max(this.minDistance,Math.min(this.maxDistance,fgRadius*2.3));
this.zoomTarget=this.zoomTarget+(nextDistance-this.zoomTarget)*(isAuto?0.6:0.9);
this.distance=this.zoomTarget;
this.viewMode='foreground';
if(!isAuto)this.setHomeFromCurrent();
this.sortDirty=true;
}

resetView(){
if(this.homeReady){
this.rot=[this.homeRot[0],this.homeRot[1]];
this.tgt=[this.homeTarget[0],this.homeTarget[1],this.homeTarget[2]];
this.zoomTarget=this.homeDistance;
this.distance=this.homeDistance;
this.viewMode='foreground';
}else{
this.tgt=[this.fullTarget[0],this.fullTarget[1],this.fullTarget[2]];
this.distance=this.fullDistance;
this.zoomTarget=this.distance;
this.viewMode='scene';
}
this.sortDirty=true;
}

cameraState(){
const cp=Math.cos(this.rot[0]),sp=Math.sin(this.rot[0]);
const cy=Math.cos(this.rot[1]),sy=Math.sin(this.rot[1]);
const eye=[
this.tgt[0]+sy*cp*this.distance,
this.tgt[1]+sp*this.distance,
this.tgt[2]+cy*cp*this.distance
];
const forward=this.norm([this.tgt[0]-eye[0],this.tgt[1]-eye[1],this.tgt[2]-eye[2]]);
const z=[-forward[0],-forward[1],-forward[2]];
let x=this.norm(this.cross([0,1,0],z));
if(!Number.isFinite(x[0]))x=[1,0,0];
const y=this.cross(z,x);
return{eye,forward,x,y,z};
}

sortAndUpload(eye,forward,force){
if(!this.splats)return;
if(!force&&!this.sortDirty)return;
const t0=performance.now();
const p=this.splats.p;
let minD=Infinity,maxD=-Infinity;
for(let i=0,j=0;i<this.cnt;i++,j+=3){
const dx=p[j]-eye[0],dy=p[j+1]-eye[1],dz=p[j+2]-eye[2];
const d=dx*forward[0]+dy*forward[1]+dz*forward[2];
this.depth[i]=d;
if(d<minD)minD=d;
if(d>maxD)maxD=d;
}
if(maxD>minD){
this.binOffsets.fill(0);
const scale=(this.binCount-1)/(maxD-minD);
for(let i=0;i<this.cnt;i++){
let b=((this.depth[i]-minD)*scale)|0;
if(b<0)b=0;
if(b>=this.binCount)b=this.binCount-1;
this.depthBin[i]=b;
this.binOffsets[b]++;
}
let offset=0;
for(let b=this.binCount-1;b>=0;b--){
const c=this.binOffsets[b];
this.binOffsets[b]=offset;
offset+=c;
}
for(let i=0;i<this.cnt;i++){
const b=this.depthBin[i];
this.order[this.binOffsets[b]++]=i;
}
}
this.reorderDrawArrays();
this.uploadDrawArrays();
this.lastSortAt=performance.now();
this.sortDirty=false;
}

reorderDrawArrays(){
const op=this.splats.p,os=this.splats.s,oc=this.splats.c,oq=this.splats.q;
const dp=this.draw.p,ds=this.draw.s,dc=this.draw.c,dq=this.draw.q;
for(let i=0;i<this.cnt;i++){
const src=this.order[i];
const s3=src*3,d3=i*3,s4=src*4,d4=i*4;
dp[d3]=op[s3];
dp[d3+1]=op[s3+1];
dp[d3+2]=op[s3+2];
ds[d3]=os[s3];
ds[d3+1]=os[s3+1];
ds[d3+2]=os[s3+2];
dc[d4]=oc[s4];
dc[d4+1]=oc[s4+1];
dc[d4+2]=oc[s4+2];
dc[d4+3]=oc[s4+3];
dq[d4]=oq[s4];
dq[d4+1]=oq[s4+1];
dq[d4+2]=oq[s4+2];
dq[d4+3]=oq[s4+3];
}
}

uploadDrawArrays(){
const gl=this.gl;
gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers.p);
gl.bufferSubData(gl.ARRAY_BUFFER,0,this.draw.p);
gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers.s);
gl.bufferSubData(gl.ARRAY_BUFFER,0,this.draw.s);
gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers.c);
gl.bufferSubData(gl.ARRAY_BUFFER,0,this.draw.c);
gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers.q);
gl.bufferSubData(gl.ARRAY_BUFFER,0,this.draw.q);
}

dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
norm(v){
const l=Math.hypot(v[0],v[1],v[2])||1;
return[v[0]/l,v[1]/l,v[2]/l];
}

render(){
const gl=this.gl;
gl.clearColor(0.039,0.039,0.059,1);
gl.clear(gl.COLOR_BUFFER_BIT);
if(!this.splats){
requestAnimationFrame(this.renderBound);
return;
}

const now=performance.now();
const dt=this.lastFrameAt?Math.min(48,now-this.lastFrameAt):16;
this.lastFrameAt=now;
this.applyHoverOrbit(dt);
this.applyGuidedSnap(dt,now);
const zoomBlend=1-Math.exp(-this.zoomLerpPerMs*dt);
const prevDistance=this.distance;
this.distance+= (this.zoomTarget-this.distance)*zoomBlend;
if(Math.abs(this.distance-prevDistance)>0.001)this.sortDirty=true;
const cam=this.cameraState();
const zooming=Math.abs(this.zoomTarget-this.distance)>0.01||now-this.lastInteractionAt<140;
const sortWait=zooming?Math.max(this.sortInterval,this.zoomSortInterval):this.sortInterval;
if(this.sortDirty&&(now-this.lastSortAt>sortWait)){
this.sortAndUpload(cam.eye,cam.forward,false);
}

const ar=this.c.width/this.c.height;
const fov=Math.PI/3;
const ft=1/Math.tan(fov/2);
const near=Math.max(this.sceneRadius*0.01,0.01);
const far=Math.max(this.sceneRadius*20+this.distance*2,near+10);
const nf=1/(near-far);
const P=new Float32Array([
ft/ar,0,0,0,
0,ft,0,0,
0,0,(far+near)*nf,-1,
0,0,2*far*near*nf,0
]);
const V=new Float32Array([
cam.x[0],cam.y[0],cam.z[0],0,
cam.x[1],cam.y[1],cam.z[1],0,
cam.x[2],cam.y[2],cam.z[2],0,
-this.dot(cam.x,cam.eye),-this.dot(cam.y,cam.eye),-this.dot(cam.z,cam.eye),1
]);
const F=[
this.c.width*0.5*(ft/ar),
this.c.height*0.5*ft
];

gl.useProgram(this.prg);
gl.uniformMatrix4fv(this.u.P,false,P);
gl.uniformMatrix4fv(this.u.V,false,V);
gl.uniform2fv(this.u.F,F);
gl.uniform2fv(this.u.S,[this.c.width,this.c.height]);

gl.bindVertexArray(this.vao);
gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,this.cnt);

requestAnimationFrame(this.renderBound);
}
}

const viewer=new SplatViewer(document.getElementById('c'));
viewer.load('https://d17y8p6t5eu2ht.cloudfront.net/splats/japan-simulated/IMG_6930.qsplat')
.then(()=>viewer.render())
.catch(err=>{
document.getElementById('loading').innerHTML='Failed to load splat';
document.getElementById('info').textContent=String(err&&err.message?err.message:err);
});
</script>

</body>
</html>
<!-- /html -->
