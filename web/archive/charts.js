const ink = '#f1f6e8';
const muted = '#acc0b0';
const line = '#3e5549';
const format = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});

function measureCanvas(canvas) {
  const {width, height} = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return {ctx, width, height};
}

function axisScale(series, unit) {
  const all = series.filter(item => item.unit === unit).flatMap(item => item.points.map(p => p.y)).filter(Number.isFinite);
  if (unit === '%') return {lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100]};
  if (unit === '°') return {lo: 0, hi: 360, ticks: [0, 90, 180, 270, 360]};
  let lo = all.length ? Infinity : 0, hi = all.length ? -Infinity : 1;
  for (const value of all) { lo = Math.min(lo,value); hi = Math.max(hi,value); }
  if (series.some(item => item.bar)) { lo = Math.min(lo,0); hi = Math.max(hi,0); }
  const raw = Math.max((hi - lo) / 4, .02);
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = [1,2,2.5,5,10].find(n => n * base >= raw) * base;
  lo = Math.floor(lo / step) * step;
  hi = Math.max(lo + step, Math.ceil(hi / step) * step);
  return {lo,hi,ticks:Array.from({length:Math.round((hi-lo)/step)+1},(_,i)=>lo+i*step)};
}

export function paintLines(canvas, series, options = {}) {
  const {ctx,width,height} = measureCanvas(canvas);
  const active = series.filter(item => !item.hidden);
  if (!width || !height || !active.length) return null;
  const units = [...new Set(active.map(item => item.unit))];
  const dual = units.length === 2;
  const normalized = units.length > 2;
  const scales = new Map(units.map(unit => [unit,axisScale(active,unit)]));
  const left=46,right=dual?47:13,top=20,bottom=26;
  const pw=Math.max(1,width-left-right),ph=height-top-bottom;
  const ticks=active[0].points;
  const first=options.first ?? ticks[0]?.x ?? 0;
  const last=options.last ?? ticks.at(-1)?.x ?? first+1;
  const x=value=>left+(last===first?.5:(value-first)/(last-first))*pw;
  const y=(value,scale)=>top+(1-(value-scale.lo)/(scale.hi-scale.lo))*ph;
  const main=normalized?{lo:0,hi:100,ticks:[0,25,50,75,100]}:scales.get(units[0]);
  ctx.font = '12px Inter, Segoe UI, sans-serif';ctx.fillStyle=muted;ctx.textBaseline='middle';ctx.textAlign='right';
  ctx.strokeStyle=line;ctx.lineWidth=1;
  for(const tick of main.ticks){
    const yy=y(tick,main);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right,yy);ctx.stroke();ctx.fillText(format.format(tick),left-7,yy);
  }
  ctx.textAlign='left';ctx.fillText(normalized?'Шкала 0–100':units[0],left,8);
  if (dual) {
    ctx.textAlign='right';ctx.fillText(units[1],width-right,8);ctx.textAlign='left';
    const scale=scales.get(units[1]);for(const tick of scale.ticks)ctx.fillText(format.format(tick),width-right+5,y(tick,scale));
  }
  ctx.textAlign='center';
  let prev=-Infinity;
  const count=Math.min(width<540?5:8,ticks.length);
  for(let i=0;i<count;i++){
    const p=ticks[Math.round(i*(ticks.length-1)/Math.max(1,count-1))];
    const half=ctx.measureText(p.label).width/2;
    const center=Math.min(width-right-half,Math.max(left+half,x(p.x)));
    if(center-half<prev+6)continue;
    ctx.fillText(p.label,center,height-10);prev=center+half;
  }
  ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
  for(const item of active){
    const scale=scales.get(item.unit);
    ctx.strokeStyle=item.color;ctx.fillStyle=item.color;ctx.lineWidth=item.dash?.length?1.35:2;ctx.setLineDash(item.dash||[]);
    if(item.bar){
      const bar=Math.min(22,Math.max(2,pw/Math.max(item.points.length,1)*.48));
      for(const p of item.points)if(Number.isFinite(p.y))ctx.fillRect(x(p.x)-bar/2,Math.min(y(0,scale),y(p.y,scale)),bar,Math.abs(y(p.y,scale)-y(0,scale)));
      continue;
    }
    ctx.beginPath();let connected=false;
    item.points.forEach((p,i)=>{
      if(!Number.isFinite(p.y)){connected=false;return;}
      const xx=x(p.x), yy=y(p.y,scale);
      if(item.unit==='°')ctx.fillRect(xx-1.6,yy-1.6,3.2,3.2);
      else if(connected)ctx.lineTo(xx,yy);
      else {ctx.moveTo(xx,yy);if(!Number.isFinite(item.points[i+1]?.y))ctx.fillRect(xx-1.5,yy-1.5,3,3);}
      connected=item.unit!=='°';
    });ctx.stroke();
  }
  ctx.setLineDash([]);
  if(options.focus!=null){
    ctx.strokeStyle=muted;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(options.focus),top);ctx.lineTo(x(options.focus),height-bottom);ctx.stroke();
  }
  if(!active.some(item=>item.points.some(p=>Number.isFinite(p.y)))){
    ctx.font='15px Inter, Segoe UI, sans-serif';ctx.fillStyle=ink;ctx.fillText('За выбранный период нет пригодных значений',left+pw/2,height/2);
  }
  ctx.restore();
  return {ticks,left,right,x,normalized};
}

export function paintRose(canvas, result) {
  const {ctx,width,height}=measureCanvas(canvas);
  if(!width || !height)return;
  const x=width/2,y=height/2, radius=Math.min(width,height)*.40;
  const colors=['#568573','#82ae88','#84dccb','#bced91'];
  const max=Math.max(5,Math.ceil(Math.max(...result.sectors.map((_,s)=>result.counts.reduce((sum,band)=>sum+band[s],0)/Math.max(1,result.n)*100))/5)*5);
  ctx.font='12px Inter';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.strokeStyle=line;ctx.fillStyle=muted;
  for(let i=1;i<=4;i++){ctx.beginPath();ctx.arc(x,y,radius*i/4,0,2*Math.PI);ctx.stroke();ctx.fillText(format.format(max*i/4)+'%',x+radius*i/4-2,y-10);}
  result.sectors.forEach((label,s)=>{
    const angle=s*Math.PI/4-Math.PI/2;
    ctx.fillStyle=muted;ctx.fillText(label,x+(radius+14)*Math.cos(angle),y+(radius+13)*Math.sin(angle));
    let base=0;
    result.counts.forEach((band,j)=>{
      const len=result.n?band[s]/result.n*100/max*radius:0;
      if(!len)return;
      ctx.beginPath();ctx.arc(x,y,base+len,angle-.33,angle+.33);
      if(base>0)ctx.arc(x,y,base,angle+.33,angle-.33,true);else ctx.lineTo(x,y);
      ctx.closePath();ctx.fillStyle=colors[j];ctx.fill();base+=len;
    });
  });
}

export function paintOverview(canvas, points, color='#bced91') {
  const {ctx,width,height}=measureCanvas(canvas);
  const values=points.filter(p=>p.y!==null).map(p=>p.y);
  if(!values.length)return;
  const min=Math.min(...values),max=Math.max(...values);
  ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();let open=false;
  points.forEach((p,i)=>{
    if(p.y===null){open=false;return;}
    const x=7+i/Math.max(1,points.length-1)*(width-14);
    const y=height-5-(p.y-min)/(max-min||1)*(height-10);
    if(open)ctx.lineTo(x,y);else ctx.moveTo(x,y);open=true;
  });
  ctx.stroke();
}
