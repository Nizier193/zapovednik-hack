const data = window.WEATHER_DATA;
const get = id => document.getElementById(id);
const dayMs = 86400000;
const colors = { ink:'#f1f6e8', muted:'#acc0b0', line:'#32493d', accent:'#bced91', warm:'#f2cb92' };
const metrics = {
  t_air: ['Температура воздуха','°C','Сдвигаются ли сроки весеннего прогрева?', 'Сравнить весенние температуры по годам одной станции и сопоставить даты устойчивого потепления с наблюдениями за распусканием листьев.'],
  rh: ['Относительная влажность','%','Когда воздух наиболее сухой?', 'Сравнить периоды низкой влажности на одной станции и проверить, совпадают ли они с тёплыми днями.'],
  wind_speed: ['Скорость ветра','м/с','Где ветер сильнее при одинаковой погоде?', 'За 2025 год сравнить скорость на поляне и в поле по совпадающим валидным дням.'],
  wind_gust: ['Порывы ветра','м/с','Связаны ли сильные порывы с повреждениями деревьев?', 'Сопоставить даты сильных порывов с полевыми записями о ветровалах и проверить последовательность событий.'],
  wind_dir: ['Направление ветра','°','Меняется ли направление ветра по сезонам?', 'Сравнить распределения исходных направлений за зиму и лето на одной станции.'],
  soil_05: ['Температура почвы · 5 см','°C','Как быстро прогревается верхний слой?', 'Сопоставить даты весеннего прогрева почвы на 5, 10 и 20 см по одинаковым валидным дням.'],
  soil_10: ['Температура почвы · 10 см','°C','Насколько глубина сглаживает колебания?', 'Сравнить суточный размах температуры на 5 и 10 см в одни и те же дни.'],
  soil_20: ['Температура почвы · 20 см','°C','Запаздывает ли прогрев на глубине?', 'Сравнить ход температуры на 5 и 20 см за весну, выбрав одинаковые валидные дни.'],
  pressure_hpa: ['Атмосферное давление','гПа','Связаны ли перепады давления с порывами?', 'Сравнить дни резкого изменения давления с сильными порывами на той же станции. Использовать дни с достаточным покрытием обоих показателей.']
};
const state = { station:'ame60', metric:'t_air', from:0, to:0, step:'day', focus:null };
const ui = {
  station:get('station'), metric:get('metric'), start:get('date-start'), end:get('date-end'),
  left:get('range-start'), right:get('range-end'), chart:get('chart'), overview:get('overview'),
  selection:get('selection'), tooltip:get('tooltip'), trend:get('trend-toggle'), observations:get('observations')
};
const format = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const shortDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'});
const longDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const monthDate = new Intl.DateTimeFormat('ru-RU',{month:'short',year:'numeric',timeZone:'UTC'});
const average = values => values.reduce((a,b) => a+b,0) / values.length;
const source = () => data[state.station];
const at = i => new Date(Date.parse(source().start) + i*dayMs);
const indexOf = date => Math.round((Date.parse(date)-Date.parse(source().start))/dayMs);
const iso = i => at(i).toISOString().slice(0,10);
const unit = () => metrics[state.metric][1];
const direction = () => state.metric === 'wind_dir';
const gust = () => state.metric === 'wind_gust';
const valueText = value => value === null || !Number.isFinite(value) ? '—' : `${format.format(value)} ${unit()}`;
const signed = value => `${value > 0 ? '+' : ''}${format.format(value)}`;
let points = [], viewport = null, regression = null;

function setWindow(from,to) {
  const end = source().size-1;
  state.from = Math.max(0,Math.min(end,from));
  state.to = Math.min(end,Math.max(state.from,to));
  state.focus = null;
  update();
}

function setStation(station) {
  state.station = station;
  ui.station.value = station;
  const keys = Object.keys(source().series);
  if (!keys.includes(state.metric)) state.metric = 't_air';
  ui.metric.replaceChildren(...keys.map(key => new Option(metrics[key][0],key)));
  ui.metric.value = state.metric;
  for (const input of [ui.left,ui.right]) { input.min = 0; input.max = source().size-1; }
  for (const input of [ui.start,ui.end]) { input.min = source().start; input.max = iso(source().size-1); }
  get('archive-start').textContent = longDate.format(at(0));
  get('archive-end').textContent = longDate.format(at(source().size-1));
  state.step = 'day';
  const year = at(source().size-1).getUTCFullYear();
  setWindow(indexOf(`${year}-04-01`),indexOf(`${year}-07-31`));
}

function circle(values) {
  const rad = Math.PI/180;
  const east = average(values.map(v=>Math.sin(v*rad)));
  const north = average(values.map(v=>Math.cos(v*rad)));
  return Math.hypot(east,north) < .1 ? null : (Math.atan2(east,north)/rad+360)%360;
}

function makePoints(rows) {
  if (state.step === 'day') return rows.map(([v,low,high,count],n) => {
    const i = state.from+n;
    return { i, start:i, end:i, v, low, high, count, capacity:state.station==='ame60' ? 96 : 24, label:longDate.format(at(i)) };
  });
  const groups = new Map();
  rows.forEach((row,n) => {
    const i = state.from+n;
    const month = iso(i).slice(0,7);
    if (!groups.has(month)) groups.set(month,{ start:i,items:[] });
    groups.get(month).items.push(row);
  });
  return Array.from(groups.values(), ({start,items}) => {
    const beginning = at(start);
    const days = new Date(Date.UTC(beginning.getUTCFullYear(),beginning.getUTCMonth()+1,0)).getUTCDate();
    const partial = beginning.getUTCDate() !== 1 || items.length !== days;
    const good = items.filter(row=>row[0] !== null);
    let streak = 0, longest = 0;
    for (const row of items) { streak = row[0] === null ? streak+1 : 0; longest = Math.max(longest,streak); }
    const usable = !partial && good.length > 0 && days-good.length <= 10 && longest < 5;
    const values = good.map(row=>row[0]);
    const v = usable ? (direction() ? circle(values) : gust() ? Math.max(...values) : average(values)) : null;
    const end = start+items.length-1;
    return {i:(start+end)/2,start,end,v, low:usable&&!direction()?Math.min(...good.map(r=>r[1])):null,
      high:usable&&!direction()?Math.max(...good.map(r=>r[2])):null, count:good.length,capacity:partial?items.length:days,
      label:monthDate.format(beginning), partial};
  });
}

function fit(series) {
  const valid = series.filter(p=>p.v !== null);
  if (direction() || valid.length < 3) return null;
  const center = average(valid.map(p=>p.i));
  const level = average(valid.map(p=>p.v));
  const spread = valid.reduce((s,p)=>s+(p.i-center)**2,0);
  if (!spread) return null;
  const slope = valid.reduce((s,p)=>s+(p.i-center)*(p.v-level),0)/spread;
  return { slope, n:valid.length, first:valid[0].i, last:valid.at(-1).i, value:i=>level+slope*(i-center) };
}

function description(point) {
  if (point.partial) return 'Часть месяца';
  if (point.v !== null) return 'В расчёте';
  if (direction() && point.count >= (state.step==='month' ? point.capacity-10 : state.station==='ame60' ? 72 : 18)) return 'Оценка недоступна';
  return 'Недостаточно данных';
}

function showNumbers(rows) {
  const usable = rows.filter(p=>p[0] !== null);
  const mean = usable.length && !direction() ? average(usable.map(p=>p[0])) : null;
  const top = usable.length && !direction() ? Math.max(...usable.map(p=>p[2])) : null;
  const bottom = usable.length && !direction() ? Math.min(...usable.map(p=>p[1])) : null;
  const dominant = usable.length && direction() ? circle(usable.map(p=>p[0])) : null;
  const cards = [
    [direction()?'Среднее направление':gust()?'Средний дневной пик':'Среднее за период',valueText(direction()?dominant:mean),direction()?'Круговое среднее по дням':'По валидным суткам'],
    [direction()?'Точек на графике':'Минимум и максимум',direction()?`${points.filter(p=>p.v!==null).length}`:top===null?'—':`${format.format(bottom)} … ${valueText(top)}`,direction()?'Для выбранного масштаба':'Среди наблюдений валидных дней'],
    ['Валидные дни',`${usable.length} / ${rows.length}`,`${Math.round(usable.length/rows.length*100)}% дней с оценкой`]
  ];
  get('stats').innerHTML = cards.map(([label,value,note])=>`<article class="stat"><p class="eyebrow">${label}</p><strong>${value}</strong><span>${note}</span></article>`).join('');
  const missing = points.filter(p=>p.v===null&&!p.partial);
  const validPoints = points.filter(p=>p.v!==null);
  if (missing.length) {
    get('finding-title').textContent = 'В ряду есть пропуски';
    const april = state.station==='kr1' && state.metric==='pressure_hpa' && state.step==='month' && missing.find(p=>iso(p.start)==='2024-04-01');
    get('finding-note').textContent = april ? `В апреле 2024 года валидное давление есть только за ${april.count} из ${april.capacity} дней. Месячное значение исключено.` : `Точек без расчёта: ${missing.length}. Первый разрыв — ${missing[0].label}. Под графиком можно проверить покрытие каждого периода.`;
  } else if (validPoints.length && !direction()) {
    const max = validPoints.reduce((best,p)=>p.v>best.v?p:best);
    get('finding-title').textContent = `Наибольшее значение · ${valueText(max.v)}`;
    get('finding-note').textContent = `${max.label}. Максимум среди точек графика за выбранный период.`;
  } else {
    get('finding-title').textContent = validPoints.length?'Направление меняется по кругу':'Точек для расчёта нет';
    get('finding-note').textContent = validPoints.length?'Север соответствует одновременно 0° и 360°. Каждая точка показана отдельно.':'Расширьте интервал или переключите график на дни.';
  }
  get('hypothesis-title').textContent = metrics[state.metric][2];
  get('hypothesis-note').textContent = metrics[state.metric][3];
  get('trend-value').textContent = regression ? `${signed(regression.slope*30)} ${unit()} за 30 дней` : '—';
  get('trend-note').textContent = regression ? `Линейная оценка по ${regression.n} точкам. Сезонные изменения входят в наклон.` : direction()?'Для направления используют круговую статистику.':'Для оценки нужны три валидные точки или больше.';
  ui.trend.disabled = !regression;
}

function updateTable() {
  if (!ui.observations.open) return;
  get('records').innerHTML = points.map(p=>`<tr><td>${p.label}</td><td>${valueText(p.v)}</td><td>${p.count} / ${p.capacity} ${state.step==='month'?'дн.':state.station==='ame60'?'сроков':'ч'}</td><td>${description(p)}</td></tr>`).join('');
}

function update() {
  ui.left.value=state.from;
  ui.right.value=state.to;
  ui.left.setAttribute('aria-valuetext',longDate.format(at(state.from)));
  ui.right.setAttribute('aria-valuetext',longDate.format(at(state.to)));
  ui.start.value=iso(state.from);
  ui.end.value=iso(state.to);
  const [label,symbol] = metrics[state.metric];
  get('chart-title').textContent = label;
  get('chart-unit').textContent = `${symbol} · ${state.step==='day'?'Суточный ряд':'Месячный ряд'}`;
  document.querySelectorAll('[data-step]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.step===state.step));
  const rows = source().series[state.metric].slice(state.from,state.to+1);
  points = makePoints(rows);
  regression = fit(points);
  showNumbers(rows);
  updateTable();
  drawPlot();
  drawOverview();
}

function context(canvas) {
  const {width,height} = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width*ratio);
  canvas.height = Math.round(height*ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return {ctx,width,height};
}

function scaleY(values) {
  if (direction()) return {low:0,high:360,step:90};
  if (state.metric==='rh') return {low:0,high:100,step:25};
  const min = Math.min(...values), max = Math.max(...values);
  const rough = Math.max((max-min)/4,.1);
  const power = 10**Math.floor(Math.log10(rough));
  const step = [1,2,2.5,5,10].find(k=>k*power>=rough)*power;
  const low = gust() ? 0 : Math.floor(min/step)*step-(min===max?step:0);
  return {low,high:Math.max(low+step,Math.ceil(max/step)*step),step};
}

function drawPlot() {
  const {ctx,width,height} = context(ui.chart);
  const pad = { left:43,right:12,top:16,bottom:30 };
  const plotWidth = Math.max(1,width-pad.left-pad.right);
  const plotHeight = height-pad.top-pad.bottom;
  const x = i => pad.left + (i-state.from+.5)/(state.to-state.from+1)*plotWidth;
  const showBand = state.metric==='t_air' && state.step==='day';
  const showTrend = !!regression && ui.trend.checked;
  const showGap = points.some(p=>p.v===null);
  get('legend').innerHTML = `<span><i></i>${direction()?'Среднее направление':gust()?'Максимальный порыв':'Среднее'}</span>${showBand?'<span><i class="band"></i>Мин.–макс. за сутки</span>':''}${showTrend?'<span><i class="dash"></i>Тренд</span>':''}${showGap?'<span><i class="quality"></i>Разрывы ряда</span>':''}`;
  const valid = points.filter(p=>p.v!==null);
  const values = valid.flatMap(p=>showBand?[p.low,p.high]:[p.v]);
  if (showTrend) values.push(regression.value(regression.first),regression.value(regression.last));
  const {low,high,step} = scaleY(values.length?values:[0,1]);
  const y = value => pad.top+(1-(value-low)/(high-low))*plotHeight;
  viewport = {ctx,width,height,x,y,pad,plotWidth};
  ctx.save();
  ctx.font = '12px Aptos, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let n=0,tick=low; tick<=high+step/1000 && n<10; n++,tick=low+n*step) {
    ctx.strokeStyle = colors.line;
    ctx.beginPath(); ctx.moveTo(pad.left,y(tick)); ctx.lineTo(width-pad.right,y(tick)); ctx.stroke();
    ctx.fillStyle = colors.muted;
    const label = direction()?['С','В','Ю','З','С'][n]:format.format(tick);
    ctx.fillText(label,pad.left-8,y(tick));
  }
  ctx.textAlign = 'center';
  const tickCount = Math.min(width<500?4:6,state.to-state.from+1);
  for(let n=0;n<tickCount;n++) {
    const i = state.from+Math.round((state.to-state.from)*n/Math.max(1,tickCount-1));
    ctx.fillText(shortDate.format(at(i)), Math.max(pad.left+14,Math.min(width-24,x(i))), height-11);
  }
  ctx.beginPath(); ctx.rect(pad.left,pad.top,plotWidth,plotHeight); ctx.clip();
  ctx.fillStyle='#f2cb9216';
  points.filter(p=>p.v===null).forEach(p=>ctx.fillRect(x(p.start-.5),pad.top,x(p.end+.5)-x(p.start-.5),plotHeight));
  const spans = [];
  let span=[];
  for (const p of points) {
    if (p.v!==null) span.push(p);
    else if (span.length) { spans.push(span); span=[]; }
  }
  if (span.length) spans.push(span);
  for (const run of spans) {
    if (showBand) {
      ctx.beginPath(); ctx.moveTo(x(run[0].i),y(run[0].high));
      run.forEach(p=>ctx.lineTo(x(p.i),y(p.high)));
      [...run].reverse().forEach(p=>ctx.lineTo(x(p.i),y(p.low)));
      ctx.closePath(); ctx.fillStyle='#90b87d42';ctx.fill();
    }
    ctx.strokeStyle=colors.accent; ctx.fillStyle=colors.accent; ctx.lineWidth=2;
    if (gust()) {
      const bar = Math.min(11,Math.max(1,plotWidth/points.length*.6));
      run.forEach(p=>ctx.fillRect(x(p.i)-bar/2,y(p.v),bar,y(0)-y(p.v)));
    } else if (direction() || run.length===1) {
      run.forEach(p=>{ctx.beginPath();ctx.arc(x(p.i),y(p.v),2.4,0,Math.PI*2);ctx.fill();});
    } else {
      ctx.beginPath(); ctx.moveTo(x(run[0].i),y(run[0].v));
      run.slice(1).forEach(p=>ctx.lineTo(x(p.i),y(p.v))); ctx.stroke();
    }
  }
  if (showTrend) {
    ctx.setLineDash([6,5]); ctx.strokeStyle=colors.warm; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(x(regression.first),y(regression.value(regression.first)));
    ctx.lineTo(x(regression.last),y(regression.value(regression.last))); ctx.stroke(); ctx.setLineDash([]);
  }
  if (!valid.length) {
    ctx.fillStyle=colors.muted; ctx.font='16px Aptos, Segoe UI, sans-serif';
    ctx.fillText('За выбранный период расчёты недоступны',pad.left+plotWidth/2,height/2);
  }
  ctx.restore();
  drawFocus();
}

function drawFocus() {
  const p = points[state.focus];
  ui.tooltip.hidden = !p;
  if (!p) return;
  const {ctx,x,y,width,pad,height} = viewport;
  const xx = x(p.i);
  ctx.strokeStyle='#91b39a'; ctx.lineWidth=1; ctx.beginPath();
  ctx.moveTo(xx,pad.top); ctx.lineTo(xx,height-pad.bottom);ctx.stroke();
  if (p.v!==null) {ctx.beginPath();ctx.arc(xx,y(p.v),4,0,Math.PI*2);ctx.fillStyle=colors.accent;ctx.fill();}
  ui.tooltip.textContent = `${p.label}\n${p.v===null?description(p):valueText(p.v)}\nПокрытие ${p.count} / ${p.capacity}`;
  ui.tooltip.style.left = `${Math.max(4,Math.min(width-ui.tooltip.offsetWidth-5,xx+10))}px`;
}

function drawOverview() {
  const {ctx,width,height} = context(ui.overview);
  const series = source().series[state.metric];
  const values = series.map(p=>p[0]).filter(v=>v!==null);
  if (values.length) {
    const min = Math.min(...values), max = Math.max(...values);
    ctx.strokeStyle='#82a891'; ctx.fillStyle='#82a891';ctx.lineWidth=1;
    ctx.beginPath();
    let connected=false;
    series.forEach(([v],i)=>{
      if(v===null){connected=false;return;}
      const x = i/(series.length-1)*width;
      const y = height-6-(v-min)/(max-min || 1)*(height-12);
      if (direction()) ctx.fillRect(x,y,1,1);
      else if(connected) ctx.lineTo(x,y);
      else ctx.moveTo(x,y);
      connected=true;
    });
    ctx.stroke();
  }
  const track = ui.selection.parentElement.clientWidth-14;
  const left = 7+state.from/(source().size-1)*track;
  const right = 7+state.to/(source().size-1)*track;
  ui.selection.style.left=`${left}px`;
  ui.selection.style.right=`${track+14-right}px`;
}

ui.station.addEventListener('change',()=>setStation(ui.station.value));
ui.metric.addEventListener('change',()=>{state.metric=ui.metric.value;state.focus=null;update();});
ui.start.addEventListener('change',()=>{const i=indexOf(ui.start.value);if(Number.isFinite(i))setWindow(i,Math.max(i,state.to));else ui.start.value=iso(state.from);});
ui.end.addEventListener('change',()=>{const i=indexOf(ui.end.value);if(Number.isFinite(i))setWindow(Math.min(i,state.from),i);else ui.end.value=iso(state.to);});
ui.left.addEventListener('input',()=>setWindow(Math.min(+ui.left.value,state.to),state.to));
ui.right.addEventListener('input',()=>setWindow(state.from,Math.max(state.from,+ui.right.value)));
ui.trend.addEventListener('change',drawPlot);
ui.observations.addEventListener('toggle',updateTable);
document.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>{state.step=button.dataset.step;state.focus=null;update();}));
document.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{
  const days = button.dataset.window;
  if (days==='all') setWindow(0,source().size-1);
  else { const end=Math.max(state.to,+days-1);setWindow(end-+days+1,end); }
}));
get('pressure-example').addEventListener('click',()=>{
  state.metric='pressure_hpa'; setStation('kr1');
  state.step='month'; setWindow(indexOf('2024-01-01'),indexOf('2024-12-31'));
});
ui.chart.addEventListener('pointermove',event=>{
  const x=event.clientX-ui.chart.getBoundingClientRect().left;
  state.focus = points.reduce((nearest,p,i)=>Math.abs(viewport.x(p.i)-x)<Math.abs(viewport.x(points[nearest].i)-x)?i:nearest,0);
  drawPlot();
});
ui.chart.addEventListener('pointerleave',()=>{state.focus=null;drawPlot();});
ui.chart.addEventListener('keydown',event=>{
  if (!['ArrowLeft','ArrowRight','Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key==='Escape') state.focus=null;
  else state.focus=Math.max(0,Math.min(points.length-1,(state.focus??0)+(event.key==='ArrowLeft'?-1:1)));
  drawPlot();
  if (state.focus!==null) ui.chart.setAttribute('aria-label',ui.tooltip.textContent.replaceAll('\n',', '));
});
new ResizeObserver(()=>{drawPlot();drawOverview();}).observe(get('plot'));
setStation('ame60');
