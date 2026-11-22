import {paintLines, paintOverview, paintRose} from './charts.js';

const $ = id => document.getElementById(id);
const dayMs = 86400000;
const storageKey = 'zapovednik-meteo-workspaces-v1';
const format = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const shortDay = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'});
const shortMonth = new Intl.DateTimeFormat('ru-RU',{month:'short',year:'2-digit',timeZone:'UTC'});
const colors = ['#bced91','#84dccb','#9cc5f3','#ffd18d','#d3b9ee','#d0e785','#8fc9a4','#f1ba89','#efa8a7'];
const lineNames = ['Среднее','Медиана','Минимум','Максимум'];
const patterns = [[],[7,5],[2,4],[6,3,2,3]];
const chartTypes = {series:'Временной ряд',soil:'Температура почвы на трёх глубинах',wind:'Скорость ветра и порывы',rose:'Роза ветров',
  hours:'Средний суточный ход',season:'Годовой ход',anomaly:'Отклонения от среднего',trend:'Тренд по календарному месяцу',
  compare:'Поляна и поле',coverage:'Календарь покрытия'};
const defaultLines = () => ({t_air:[0,3],rh:[0]});
const id = () => crypto.randomUUID();
const iso = time => new Date(time).toISOString().slice(0,10);
const stamp = value => Date.parse(value.replace(' ','T')+(value.includes(' ')?'Z':''));
const escape = value => String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const option = (value, name, selected) => `<option value="${escape(value)}"${value===selected?' selected':''}>${escape(name)}</option>`;
const makeCard = type => ({id:id(),type,name:chartTypes[type],override:null,hidden:[]});
const definitions = [
  {name:'Архив АМЕ-60',station:'ame60',first:'2016-01-01',last:'2016-04-30',step:'day',parameters:['t_air','rh'],types:['series']},
  {name:'Поляна и поле, 2025',station:'kr1',first:'2025-01-01',last:'2025-12-31',step:'month',parameters:['t_air'],types:['compare','series']},
  {name:'Давление Кр1, 2024',station:'kr1',first:'2024-01-01',last:'2024-12-31',step:'month',parameters:['pressure_hpa'],types:['series','coverage']},
];
function makeDashboard(definition) {
  const {name,types,...filter}=definition;
  return {id:id(),name,filter,latest:false,layout:'overlay',lines:defaultLines(),cards:types.map(makeCard)};
}

let catalog=null, workspaces=definitions.map(makeDashboard), current=workspaces[0].id;
let section='dashboards', renderId=0, knownDraft=null, currentCharts=[], overview=[], brush=null, drag=null, timelineDebounce=null;
try {
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(saved?.version===1&&saved.workspaces?.length){workspaces=saved.workspaces;current=workspaces.some(d=>d.id===saved.current)?saved.current:workspaces[0].id;}
} catch { /* The built-in views remain available. */ }
const active = () => workspaces.find(d=>d.id===current);
const shared = () => active().filter;
const allowed = station => Object.keys(catalog.parameters).filter(key=>station==='ame60'?key!=='pressure_hpa':!key.startsWith('soil_'));
const meta = key => catalog.parameters[key];
const color = key => colors[Object.keys(catalog.parameters).indexOf(key)];
const names = key => [meta(key)[0],meta(key)[1]];

function persist() {
  try { localStorage.setItem(storageKey,JSON.stringify({version:1,current,workspaces})); } catch { /* File-based settings are still available. */ }
}

function announce(message='', error=false) {
  const node=$('notice');node.textContent=message;node.hidden=!message;node.classList.toggle('error',error);
}

async function request(route, options) {
  const result=await fetch('/api/weather/'+route,options);
  if(!result.ok){
    const payload=await result.json().catch(()=>({detail:'Запрос не выполнен.'}));
    throw new Error(typeof payload.detail==='string'?payload.detail:'Проверьте поля запроса.');
  }
  return result;
}

async function getJson(route, args) {
  const query=args?'?'+new URLSearchParams(args):'';
  return (await request(route+query)).json();
}

function saveBlob(blob, name) {
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function table(headers, rows) {
  return `<div class="table-scroll"><table><thead><tr>${headers.map(x=>`<th scope="col">${escape(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function showDialog(title, body) {
  $('dialog-body').innerHTML=`<div class="heading"><h2>${escape(title)}</h2><form method="dialog"><button>Закрыть</button></form></div>${body}`;
  if(!$('dialog').open)$('dialog').showModal();
}

function htmlStations(selected, empty=false) {
  return (empty?option('','Определить по имени',selected):'')+Object.entries(catalog.stations).map(([key,value])=>option(key,value[0],selected)).join('');
}

function htmlParameters(station, selected) {
  return allowed(station).map(key=>option(key,`${meta(key)[0]}, ${meta(key)[1]}`,selected)).join('');
}

function renderControls() {
  const d=active(),f=d.filter,b=catalog.bounds[f.station];
  $('dashboard').innerHTML=workspaces.map(item=>option(item.id,item.name,current)).join('');
  $('station').innerHTML=htmlStations(f.station);
  $('first').value=f.first;$('last').value=f.last;$('step').value=f.step;$('latest').checked=d.latest;
  $('last').disabled=d.latest;
  $('bounds').textContent=b?`Наблюдения ${b.first} — ${b.last}`:'Архив этой точки ещё пуст';
  $('parameters').innerHTML=allowed(f.station).map(key=>`<button data-parameter="${key}" style="--series:${color(key)}" aria-pressed="${f.parameters.includes(key)}">${escape(meta(key)[0])}<span>${escape(meta(key)[1])}</span></button>`).join('');
  $('lines').innerHTML=f.parameters.map(key=>{
    const list=key==='wind_dir'?['Круговое среднее']:lineNames;
    return `<div style="--series:${color(key)}"><b>${escape(meta(key)[0])}</b>${list.map((name,i)=>`<button data-line="${i}" data-for="${key}" aria-pressed="${(d.lines[key]||[0]).includes(i)}">${name}</button>`).join('')}</div>`;
  }).join('');
  document.querySelectorAll('[data-layout]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.layout===d.layout));
  $('import-station').innerHTML=htmlStations('',true);
  $('import-key-label').hidden=catalog.importMode!=='operator';
}

function filterCard(card) {
  const result={...shared(),...card.override};
  if(card.override?.latest){const latest=catalog.bounds[result.station]?.last;if(latest&&latest>=result.first)result.last=latest;}
  if(card.type==='compare')return {...result,station:'kr1',parameters:['t_air'],step:'month'};
  if(card.type==='soil')return {...result,station:'ame60',parameters:['soil_05','soil_10','soil_20']};
  if(card.type==='wind')return {...result,parameters:['wind_speed','wind_gust']};
  if(card.type==='rose')return {...result,parameters:['wind_speed','wind_dir']};
  return result;
}

function buildTimeline() {
  const f=shared(), first=stamp(f.first),last=stamp(f.last),b=catalog.bounds[f.station];
  const lower=Math.min(first,stamp(b?.first||f.first)),upper=Math.max(last,stamp(b?.last||f.last));
  const span=Math.min(upper-lower,Math.max(365*dayMs,(last-first)*3));
  const start=Math.max(lower,Math.min(upper-span,(first+last-span)/2));
  brush={start:stamp(iso(start)),end:stamp(iso(start+span))};
  updateTimeline();
}

function updateTimeline() {
  const f=shared(),span=Math.max(1,(brush.end-brush.start)/dayMs);
  for (const [key,value] of [['range-first',f.first],['range-last',f.last]]){
    const input=$(key);input.min=0;input.max=span;input.value=(stamp(value)-brush.start)/dayMs;input.setAttribute('aria-valuetext',value);
  }
  const inset=fraction=>`calc(${100*fraction}% + ${7-14*fraction}px)`;
  $('window').style.left=inset((stamp(f.first)-brush.start)/dayMs/span);
  $('window').style.right=inset((brush.end-stamp(f.last))/dayMs/span);
  $('timeline-labels').innerHTML=`<span>${iso(brush.start)}</span><span>${iso(brush.end)}</span>`;
}

const graphMeta=(name,unit,color_,points,extra={})=>({name,unit,color:color_,points,...extra});

function pointsFor(rows,index=0,step='day') {
  return rows.map(row=>{
    const x=(stamp(row.start)+stamp(row.end))/2;
    const label=(step==='month'?shortMonth:shortDay).format(new Date(x));
    return {x,label,y:row.v[index],row};
  });
}

async function readChart(card, f) {
  const key=f.parameters[0]||'t_air';
  const query={station:f.station,parameter:key,first:f.first,last:f.last};
  if(card.type==='rose'){
    const result=await getJson('rose',query);
    return {rose:result,note:result.reason||`${format.format(result.n)} пригодных пар. Штиль ${format.format(100*result.calm/result.n)}%. Корзины, м/с: ${result.bins.join(', ')}.`};
  }
  if(card.type==='compare'){
    const result=await getJson('compare',{first:f.first,last:f.last});
    const byMonth=key=>result.months.map(row=>({x:stamp(row.month),label:shortMonth.format(new Date(row.month)),y:row[key],row:{start:row.month,status:row.status,coverage:row.n,capacity:row.capacity}}));
    const byHour=rows=>rows.map(row=>({x:row.hour,label:`${row.hour}:00`,y:row.value,row:{coverage:row.n}}));
    return {groups:[
      {title:'Месячная температура',lines:[graphMeta('Кр1, поляна','°C',colors[0],byMonth('kr1')),graphMeta('Кр2, поле','°C',colors[1],byMonth('kr2'))]},
      {title:'Разность Кр1 − Кр2',lines:[graphMeta('Разность','°C',colors[3],byMonth('delta'),{bar:true})]},
      {title:'Средний суточный ход',lines:[graphMeta('Кр1, поляна','°C',colors[0],byHour(result.hoursKr1)),graphMeta('Кр2, поле','°C',colors[1],byHour(result.hoursKr2))]},
    ],note:`Совпавших пригодных пар «дата и час»: ${format.format(result.hourPairs)}. Разность по месяцу считается только при полном пересечении по правилам покрытия.`,comparison:result.months};
  }
  if(card.type==='hours'){
    const {profile}=await getJson('hours',query);
    const p=profile.map(row=>({x:row.hour,label:`${row.hour}:00`,y:row.value,row:{coverage:row.n}}));
    return {groups:[{lines:[graphMeta(meta(key)[0],meta(key)[1],color(key),p)]}],note:'У каждого пригодного дня одинаковый вес внутри одного часа. Объём выборки доступен в подсказке.'};
  }
  if(['season','anomaly','trend'].includes(card.type)){
    const base=catalog.bounds[f.station]||{first:f.first,last:f.last};
    const refFrom=card.baseFrom||base.first,refTo=card.baseTo||base.last;
    const result=await getJson('reference',{...query,base_from:refFrom,base_to:refTo,month:card.month||1});
    const u=meta(key)[1],c=color(key);
    if(card.type==='season'){
      const p=result.seasonal.map(r=>({x:r.month,label:new Intl.DateTimeFormat('ru',{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2020,r.month-1,1))),y:r.value,row:{years:r.years}}));
      return {groups:[{lines:[graphMeta('Среднее за выбранный период',u,c,p)]}],note:`База ${refFrom} — ${refTo}. Годы каждой точки указаны в подсказке.`};
    }
    if(card.type==='anomaly'){
      const p=result.monthly.map(row=>({x:stamp(row.start),label:shortMonth.format(new Date(row.start)),y:row.delta,row:{...row,start:row.start}}));
      return {groups:[{lines:[graphMeta('Отклонение',u,colors[3],p,{bar:true})]}],note:`База ${refFrom} — ${refTo}. Сравниваются одинаковые календарные месяцы одной точки.`};
    }
    const p=result.trend.map(row=>({x:row.year,label:String(row.year),y:row.value}));
    const lines=[graphMeta('Месячные средние',u,c,p)];
    if(result.fit){
      const fit=result.fit;lines.push(graphMeta('Линейная оценка',u,colors[3],p.map(point=>({...point,y:point.x>=fit.first&&point.x<=fit.last?fit.offset+point.x*fit.slope:null})),{dash:[8,5]}));
    }
    return {groups:[{lines}],note:result.fit?`Наклон ${format.format(result.fit.slope)} ${u}/год по ${result.n} годам. Месяц ${card.month||1}.`:`Для тренда нужны пять пригодных лет одного месяца. В выборке ${result.n}.`};
  }
  if(card.type==='coverage'){
    const month=f.first.slice(0,7);
    const result=await loadCoverage(f.station,key,month);
    return {calendar:result,station:f.station,key,note:'Календарь показывает первый месяц выбранного периода. Для любого другого месяца откройте раздел «Качество».'};
  }
  const responses=await Promise.all(f.parameters.map(parameter=>getJson('series',{...query,parameter,step:f.step})));
  const lines=[];
  f.parameters.forEach((param,i)=>{
    const [name,unit]=names(param);
    const configured=card.type==='wind'&&param==='wind_gust'?[3]:card.type==='series'?(active().lines[param]||[0]):[0];
    for(const j of configured){
      if((param==='wind_dir'||f.step==='term')&&j!==0)continue;
      lines.push(graphMeta(`${name} / ${param==='wind_dir'?'круговое среднее':f.step==='term'?'измерение':lineNames[j].toLowerCase()}`,
        unit,color(param),pointsFor(responses[i].rows,j,f.step),{dash:patterns[j],bar:card.type==='wind'&&param==='wind_gust',parameter:param}));
    }
  });
  const groups=active().layout==='split'&&card.type==='series'?f.parameters.map(key=>({title:meta(key)[0],lines:lines.filter(line=>line.parameter===key)})).filter(group=>group.lines.length):[{lines}];
  const notes=[];
  if(responses.some(item=>item.reduced))notes.push('График упрощён. Крайние значения среднего и разрывы сохранены. Выгрузка содержит полную выборку.');
  if(f.step==='month')notes.push('Частичные и неполные месяцы отмечены в таблице.');
  const main=responses[0]?.rows||[];
  const usable=main.filter(row=>row.v[0]!==null).length;
  if(main.length)notes.push(`Пригодных точек первого показателя на графике: ${usable} из ${main.length}.`);
  return {groups,note:notes.join(' '),table:responses.flatMap((item,i)=>item.rows.map(row=>({...row,key:f.parameters[i]})))};
}

async function loadCoverage(station,key,month) {
  const first=month+'-01';
  const next=new Date(stamp(first));next.setUTCMonth(next.getUTCMonth()+1);
  const last=iso(+next-dayMs);
  return (await getJson('series',{station,parameter:key,first,last,step:'day'})).rows;
}

function renderCalendar(parent, rows, station, parameter) {
  const capacity=catalog.stations[station][2],threshold=catalog.stations[station][1];
  const offset=rows.length?(new Date(rows[0].start).getUTCDay()+6)%7:0;
  parent.innerHTML=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(name=>`<span>${name}</span>`).join('')+'<span></span>'.repeat(offset)+rows.map(row=>`<button class="${row.coverage>=threshold?'good':row.stationCoverage===0?'no-record':''}" data-open-day="${row.start}" data-station="${station}" data-key="${parameter}" title="${escape(row.status)}"><strong>${Number(row.start.slice(-2))}</strong>${row.coverage} / ${capacity}</button>`).join('');
}

function buildPlot(parent, group, card, filter) {
  if(!group.lines.length){parent.insertAdjacentHTML('beforeend','<p class="empty">Выберите линии для отображения.</p>');return;}
  const wrapper=document.createElement('div');wrapper.className='chart-wrap';
  const legend=document.createElement('div');legend.className='legend';
  if(group.title){const title=document.createElement('h3');title.textContent=group.title;parent.append(title);}
  const canvas=document.createElement('canvas');canvas.tabIndex=0;canvas.className=group.title?'small':'';
  canvas.setAttribute('aria-label',group.title||card.name);
  const tip=document.createElement('div');tip.className='chart-tip';tip.hidden=true;
  const state={canvas,lines:group.lines,focus:null,frame:null};
  group.lines.forEach((item,i)=>{
    const button=document.createElement('button');button.textContent=item.name;
    button.style.setProperty('--series',item.color);
    item.hidden=card.hidden.includes(item.name);
    button.setAttribute('aria-pressed',String(!item.hidden));
    button.addEventListener('click',()=>{item.hidden=!item.hidden;button.setAttribute('aria-pressed',String(!item.hidden));card.hidden=item.hidden?[...card.hidden,item.name]:card.hidden.filter(name=>name!==item.name);persist();repaint();});
    legend.append(button);
  });
  wrapper.append(canvas,tip);parent.append(legend,wrapper);
  const repaint=()=>{state.frame=paintLines(canvas,state.lines,{focus:state.focus});};
  currentCharts.push({canvas,paint:repaint});
  function showPoint(index) {
    const anchor=state.frame?.ticks[index];
    if(!anchor)return;
    state.focus=anchor.x;tip.hidden=false;
    tip.textContent=[anchor.row?.start||anchor.label,...state.lines.filter(item=>!item.hidden).map(item=>{
      const point=item.points.find(p=>p.x===anchor.x);
      const sample=point?.row?.years?.length?` / ${point.row.years.join(', ')}`:point?.row?.coverage!=null?` / ${point.row.coverage} наблюдений или периодов`:'';
      return `${item.name}: ${point?.y==null?'нет значения':`${format.format(point.y)} ${item.unit}`}${sample}`;
    })].join('\n');
    repaint();
  }
  canvas.addEventListener('pointermove',event=>{
    const points=state.frame?.ticks;
    if(!points?.length)return;
    const mouse=event.clientX-canvas.getBoundingClientRect().left;
    const i=points.reduce((best,p,index)=>Math.abs(state.frame.x(p.x)-mouse)<Math.abs(state.frame.x(points[best].x)-mouse)?index:best,0);
    showPoint(i);
  });
  canvas.addEventListener('pointerleave',()=>{state.focus=null;tip.hidden=true;repaint();});
  canvas.addEventListener('keydown',event=>{
    const points=state.frame?.ticks;
    if(!points?.length)return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();const i=points.findIndex(p=>p.x===state.focus);
      showPoint(Math.min(points.length-1,Math.max(0,i+(event.key==='ArrowLeft'?-1:1))));
    }
    if(event.key==='Enter')openPoint();
  });
  function openPoint(){
    const point=state.frame?.ticks.find(p=>p.x===state.focus);
    if(point?.row?.start)showDetail(filter.station,state.lines[0].parameter||filter.parameters[0],point.row.start.slice(0,10),point.row.end?.slice(0,10));
  }
  canvas.addEventListener('click',openPoint);
  repaint();
}

function readTable(parent, filter) {
  const section=document.createElement('details');section.innerHTML='<summary>Таблица графика</summary><label>Параметр <select></select></label><div data-rows></div><div class="controls compact"><button data-page="previous">Назад</button><button data-page="next">Дальше</button><span class="muted"></span></div>';
  const chooser=section.querySelector('select');
  chooser.innerHTML=filter.parameters.map(key=>option(key,meta(key)[0])).join('');
  const size=40;let page=0, requestId=0;
  async function draw(){
    const offset=page*size, parameter=chooser.value;
    const running=++requestId;
    const body=section.querySelector('[data-rows]');
    body.textContent='Загружаем таблицу…';
    try {
      const {rows,total}=await getJson('table',{station:filter.station,parameter,first:filter.first,last:filter.last,step:filter.step,offset,limit:size});
      if(running!==requestId)return;
      body.innerHTML=table(['Период','Среднее','Медиана','Минимум','Максимум','Покрытие','Статус'],rows.map(row=>[
        `<button data-open-day="${row.start.slice(0,10)}" data-end="${row.end.slice(0,10)}" data-station="${filter.station}" data-key="${parameter}">${escape(row.start)}</button>`,
        ...row.v.map(value=>value===null?'—':escape(format.format(value))),`${row.coverage} / ${row.capacity}`,escape(row.status)
      ]));
      section.querySelector('span').textContent=total?`${offset+1}–${offset+rows.length} из ${total}`:'Нет строк';
      section.querySelector('[data-page=previous]').disabled=page===0;
      section.querySelector('[data-page=next]').disabled=offset+size>=total;
    } catch(error){if(running===requestId)body.textContent=error.message;}
  }
  section.querySelector('[data-page=previous]').onclick=()=>{page--;draw();};
  section.querySelector('[data-page=next]').onclick=()=>{page++;draw();};
  chooser.onchange=()=>{page=0;draw();};
  section.ontoggle=()=>{if(section.open)draw();};
  parent.append(section);
}

async function renderCards() {
  const epoch=++renderId;const d=active();currentCharts=[];
  $('cards').innerHTML=d.cards.map((card,index)=>`<article class="panel card" data-card="${card.id}"><div class="heading"><div><h2>${escape(card.name)}</h2><p class="muted">${escape(catalog.stations[filterCard(card).station][0])} / ${filterCard(card).first} — ${filterCard(card).last}${card.override?' / <span class="custom">Свои фильтры</span>':''}</p></div><div class="card-actions"><button data-card-action="edit">Настроить</button><button data-card-action="copy">Копия</button><button data-card-action="up" ${index?'':'disabled'}>Вверх</button><button data-card-action="down" ${index<d.cards.length-1?'':'disabled'}>Вниз</button><button data-card-action="export">Excel</button><button data-card-action="delete">Удалить</button></div></div><div class="card-body"><p class="empty">Загружаем данные…</p></div></article>`).join('') || '<div class="panel empty">Добавьте график для выбранного периода.</div>';
  await Promise.all(d.cards.map(async card=>{
    const node=$('cards').querySelector(`[data-card="${card.id}"] .card-body`);
    const f=filterCard(card);
    if(!f.parameters.length){node.textContent='Выберите параметры в фильтре.';return;}
    try {
      const graph=await readChart(card,f);
      if(epoch!==renderId)return;
      node.innerHTML='';
      if(graph.note){const info=document.createElement('p');info.className='description';info.textContent=graph.note;node.append(info);}
      if(graph.rose){
        if(graph.rose.n){const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Роза ветров');node.append(canvas);const paint=()=>paintRose(canvas,graph.rose);currentCharts.push({canvas,paint});paint();}
        node.insertAdjacentHTML('beforeend',table(['Направление',...graph.rose.bins],graph.rose.sectors.map((name,i)=>[escape(name),...graph.rose.counts.map(band=>String(band[i]))])));
      }
      if(graph.calendar){const cal=document.createElement('div');cal.className='calendar';node.append(cal);renderCalendar(cal,graph.calendar,graph.station,graph.key);}
      if(graph.groups)graph.groups.forEach(group=>buildPlot(node,group,card,f));
      if(graph.table?.length)readTable(node,f);
      if(graph.comparison)node.insertAdjacentHTML('beforeend',table(['Месяц','Кр1, °C','Кр2, °C','Кр1 − Кр2, °C','Общие дни','Статус'],graph.comparison.map(row=>[row.month,...[row.kr1,row.kr2,row.delta].map(n=>n===null?'—':escape(format.format(n))),`${row.n} / ${row.capacity}`,escape(row.status)])));
    } catch(error) {
      if(epoch===renderId){node.innerHTML=`<p class="empty status-bad">${escape(error.message)}</p><button data-card-action="retry">Повторить</button>`;}
    }
  }));
}

async function renderOverview() {
  const f=shared();const key=f.parameters[0]||'t_air';
  const token=brush;
  try {
    const result=await getJson('series',{station:f.station,parameter:key,first:iso(brush.start),last:iso(brush.end),step:'day',limit:950});
    if(token!==brush)return;
    overview=pointsFor(result.rows);
    paintOverview($('overview'),overview,color(key));
  } catch { overview=[];paintOverview($('overview'),overview); }
}

function refresh() {
  persist();renderControls();buildTimeline();renderCards();renderOverview();
}

function moveSection(next) {
  section=next;
  for(const button of $('nav').querySelectorAll('button')){
    const visible=button.dataset.section===next;
    button.setAttribute('aria-pressed',String(visible));$(button.dataset.section).hidden=!visible;
  }
  if(!catalog)return;
  if(next==='dashboards')refresh();
  if(next==='quality'){
    $('quality-station').innerHTML=htmlStations(shared().station);
    $('quality-parameter').innerHTML=htmlParameters(shared().station,shared().parameters[0]);
    $('quality-month').value=shared().first.slice(0,7);showQuality();
  }
  if(next==='import')renderCatalog();
}

async function loadCatalog(silent=false) {
  try {
    const before=catalog?.version;
    catalog=await getJson('catalog');
    $('version').textContent=`Архив ${catalog.version} / ${catalog.files.length} файлов`;
    for(const item of workspaces)if(item.latest){const last=catalog.bounds[item.filter.station]?.last;if(last&&last>=item.filter.first)item.filter.last=last;}
    if(before!==catalog.version || !silent){renderControls();moveSection(section);}
    if(!catalog.files.length&&!silent)announce('Архив пуст. Чтобы начать, загрузите CSV или ZIP в разделе «Данные и импорт».');
  } catch(error){announce(error.message,true);}
}

async function showQuality() {
  const station=$('quality-station').value,parameter=$('quality-parameter').value,month=$('quality-month').value;
  if(!month)return;
  $('quality-summary').textContent='Проверяем покрытие…';
  try {
    const data=await loadCoverage(station,parameter,month),threshold=catalog.stations[station][1];
    const valid=data.filter(row=>row.coverage>=threshold).length, stationDays=data.filter(row=>row.stationCoverage>=threshold).length;
    $('quality-summary').textContent=`Пригодные дни параметра: ${valid} из ${data.length}. Покрытие станции: ${stationDays} из ${data.length}.`;
    renderCalendar($('quality-calendar'),data,station,parameter);
    $('quality-table').innerHTML=table(['Дата','Покрытие параметра','Покрытие станции','Причины исключений'],data.filter(row=>row.status!=='В расчёте'||Object.keys(row.flags||{}).length).map(row=>[
      `<button data-open-day="${row.start}" data-station="${station}" data-key="${parameter}">${row.start}</button>`,
      `${row.coverage} / ${row.capacity}`,`${row.stationCoverage} / ${row.capacity}`,
      escape(Object.entries(row.flags||{}).map(([reason,count])=>`${reason} (${count})`).join(', ')||row.status)
    ]));
  } catch(error){$('quality-summary').textContent=error.message;}
}

async function showDetail(station,key,day,last=day) {
  last=last||day;
  showDialog('Исходные наблюдения',`<p class="muted">${escape(catalog.time)}</p><label>День<input type="date" id="drill-date" min="${day}" max="${last}" value="${day}"></label> <button id="drill-export">Скачать исходные строки в Excel</button><div id="drill-result">Загружаем данные…</div>`);
  const dateInput=$('drill-date');
  const get=async()=>{
    const selected=dateInput.value;
    try {
      const data=await getJson('day',{station,parameter:key,day:selected});
      if(!$('drill-result')||dateInput.value!==selected)return;
      const s=data.summary;
      $('drill-result').innerHTML=`<p class="description">${escape(meta(key)[0])}. Пригодных наблюдений ${s.n}, покрытие ${s.coverage} / ${s.capacity}. Среднее ${s.v[0]==null?'—':escape(format.format(s.v[0]))}. ${escape(s.status)}.</p>`+
        table(['Исходный срок','Значение','Статус','Флаг','Файл','Строка'],data.raw.map(row=>[escape(row.time),escape(row.original??'—'),escape(row.status),escape(row.flag),escape(row.file),escape(row.line)]));
    }catch(error){if($('drill-result'))$('drill-result').textContent=error.message;}
  };
  dateInput.onchange=get;
  $('drill-export').onclick=()=>exportExcel([{station,parameters:[key],first:dateInput.value,last:dateInput.value,step:'term',name:'Исходные наблюдения'}]);
  await get();
}

function renderCatalog() {
  $('catalog-files').innerHTML=catalog.files.length?table(['Файл','Точка','Строк','Импорт','SHA-256'],catalog.files.map(file=>[
    escape(file.name),escape(catalog.stations[file.station][0]),format.format(file.row_count),escape(file.imported.slice(0,16).replace('T',' ')),`<span title="${escape(file.digest)}">${escape(file.digest.slice(0,14))}</span>`
  ])):'<p class="muted">Файлы ещё не загружены.</p>';
}

function editCard(card) {
  const f=filterCard(card),base=catalog.bounds[f.station]||f;
  showDialog('Настройки графика',`<form id="card-form"><div class="fields"><label>Название<input id="card-name" value="${escape(card.name)}" maxlength="100" required></label><label>Тип<select id="card-type">${Object.entries(chartTypes).map(([key,label])=>option(key,label,card.type)).join('')}</select></label><label class="check"><input type="checkbox" id="card-own" ${card.override?'checked':''}>Свои фильтры</label><label class="check"><input type="checkbox" id="card-latest" ${card.override?.latest?'checked':''}>По последнюю дату</label></div>
    <div class="fields" id="card-filter"><label>Локация<select id="card-station">${htmlStations(f.station)}</select></label><label>С<input type="date" id="card-first" value="${f.first}"></label><label>До<input type="date" id="card-last" value="${f.last}"></label><label>Уровень<select id="card-step">${['term','day','decade','month'].map((x,i)=>option(x,['Сроки','Дни','Декады','Месяцы'][i],f.step)).join('')}</select></label>
    <label>Параметры<select id="card-parameter" multiple size="5">${allowed(f.station).map(key=>`<option value="${key}" ${f.parameters.includes(key)?'selected':''}>${escape(meta(key)[0])}</option>`).join('')}</select></label></div>
    <div class="fields" id="card-base"><label>База с<input type="date" id="base-from" value="${card.baseFrom||base.first||f.first}"></label><label>База до<input type="date" id="base-to" value="${card.baseTo||base.last||f.last}"></label><label>Месяц тренда<input type="number" id="trend-month" min="1" max="12" value="${card.month||1}"></label></div><button class="primary">Сохранить график</button></form>`);
  const toggle=()=>{$('card-filter').hidden=!$('card-own').checked;$('card-latest').disabled=!$('card-own').checked;$('card-base').hidden=!['season','anomaly','trend'].includes($('card-type').value);};
  $('card-own').onchange=toggle;$('card-type').onchange=toggle;
  $('card-station').onchange=()=>{$('card-parameter').innerHTML=htmlParameters($('card-station').value,'t_air');};
  $('card-form').onsubmit=event=>{
    event.preventDefault();
    const parameters=[...$('card-parameter').selectedOptions].map(x=>x.value);
    if($('card-own').checked&&(!$('card-first').value||!$('card-last').value||$('card-first').value>$('card-last').value||!parameters.length))return;
    card.name=$('card-name').value.trim()||chartTypes[$('card-type').value];card.type=$('card-type').value;
    card.override=$('card-own').checked?{station:$('card-station').value,first:$('card-first').value,last:$('card-last').value,step:$('card-step').value,parameters,latest:$('card-latest').checked}:null;
    card.baseFrom=$('base-from').value;card.baseTo=$('base-to').value;card.month=Number($('trend-month').value)||1;
    $('dialog').close();refresh();
  };
  toggle();
}

async function exportExcel(filters) {
  try{
    announce('Формируем книгу Excel…');
    const response=await request('xlsx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cards:filters})});
    saveBlob(await response.blob(),'метеоархив.xlsx');announce('Книга Excel готова.');
  }catch(error){announce(error.message,true);}
}

function configureExport(cards) {
  if(!cards.length){announce('Добавьте график для выгрузки.',true);return;}
  const filters=cards.map(card=>{
    const f=filterCard(card), bounds=catalog.bounds[f.station];
    const coverageDay=card.type==='coverage'?f.first.slice(0,7)+'-01':null;
    const next=coverageDay?new Date(`${coverageDay}T00:00:00Z`):null;
    if(next)next.setUTCMonth(next.getUTCMonth()+1);
    return {...f,name:card.name,kind:card.type,base_from:card.baseFrom||bounds?.first||f.first,
      base_to:card.baseTo||bounds?.last||f.last,month:card.month||1,
      ...(coverageDay?{first:coverageDay,last:iso(+next-dayMs),step:'day'}:{})};
  }).filter(f=>f.parameters.length);
  if(!filters.length){announce('Выберите показатели для выгрузки.',true);return;}
  showDialog('Сверка и экспорт в Excel',`<p class="description">Сверьте точку, период и показатели. Для нескольких карточек сохранены их фильтры.</p>
    ${table(['Карточка','Точка','Период','Параметры','Уровень'],filters.map(f=>[escape(f.name),escape(catalog.stations[f.station][0]),`${f.first} — ${f.last}`,escape(f.parameters.map(k=>meta(k)[0]).join(', ')),escape(f.step)]))}
    <form id="export-form"><div class="fields"><label>Локация<select id="export-station">${option('','По карточкам','')}${htmlStations('')}</select></label><label>Начало<input type="date" id="export-first"></label><label>Конец<input type="date" id="export-last"></label><label>Уровень<select id="export-step">${option('','По карточкам','')}${['term','day','decade','month'].map((v,i)=>option(v,['Сроки','Дни','Декады','Месяцы'][i])).join('')}</select></label><label>Параметр<select id="export-param">${option('','По карточкам','')}${Object.entries(catalog.parameters).map(([k,v])=>option(k,v[0])).join('')}</select></label></div><label class="check"><input type="checkbox" id="export-valid">Только пригодные значения</label><button class="primary">Скачать XLSX</button></form>`);
  $('export-form').onsubmit=event=>{
    event.preventDefault();
    const requested = filters.map(f=>({...f,station:$('export-station').value||f.station,first:$('export-first').value||f.first,last:$('export-last').value||f.last,
      step:$('export-step').value||f.step,kind:$('export-step').value?'series':f.kind,
      parameters:$('export-param').value?[$('export-param').value]:f.parameters,valid_only:$('export-valid').checked}));
    $('dialog').close();exportExcel(requested);
  };
}

function exportImage() {
  if(!currentCharts.length){announce('Откройте график перед выгрузкой.',true);return;}
  const output=document.createElement('canvas');output.width=1440;
  const images=currentCharts.map(item=>item.canvas);
  const heights=images.map(canvas=>Math.round(1350*canvas.height/canvas.width));
  output.height=125+heights.reduce((sum,height)=>sum+height+24,0);
  const ctx=output.getContext('2d');ctx.fillStyle='#101e19';ctx.fillRect(0,0,output.width,output.height);
  ctx.fillStyle='#f1f6e8';ctx.font='34px Inter';ctx.fillText(active().name,45,53);
  ctx.fillStyle='#acc0b0';ctx.font='19px Inter';ctx.fillText(`Метеоархив заповедника / ${shared().first} — ${shared().last}`,45,87);
  let y=110;
  images.forEach((canvas,i)=>{ctx.drawImage(canvas,45,y,1350,heights[i]);y+=heights[i]+24;});
  output.toBlob(blob=>{if(blob)saveBlob(blob,'метеографики.png');});
}

function updatePeriod(first,last,fullRender=true) {
  if(!first||!last||first>last)return;
  active().filter.first=first;active().filter.last=last;
  if(fullRender)refresh();
  else { $('first').value=first;$('last').value=last;updateTimeline();persist();clearTimeout(timelineDebounce);timelineDebounce=setTimeout(renderCards,160); }
}

document.addEventListener('click',event=>{
  const node=event.target.closest('button');if(!node||!catalog)return;
  const {section:next,parameter,line,for:lineKey,layout,span,openDay,station,key,end,cardAction}=node.dataset;
  if(next)moveSection(next);
  if(openDay)showDetail(station,key,openDay,end);
  if(parameter){
    const f=shared();f.parameters=f.parameters.includes(parameter)?f.parameters.filter(p=>p!==parameter):[...f.parameters,parameter];refresh();
  }
  if(line!==undefined){
    const d=active(),n=Number(line),selected=d.lines[lineKey]||[0];
    d.lines[lineKey]=selected.includes(n)?selected.filter(i=>i!==n):[...selected,n];refresh();
  }
  if(layout){active().layout=layout;refresh();}
  if(span){const last=stamp(shared().last);updatePeriod(iso(last-(Number(span)-1)*dayMs),shared().last);}
  if(cardAction){
    const cards=active().cards,cardId=node.closest('[data-card]').dataset.card,index=cards.findIndex(c=>c.id===cardId),card=cards[index];
    if(cardAction==='edit')editCard(card);
    if(cardAction==='export')configureExport([card]);
    if(cardAction==='retry')renderCards();
    if(cardAction==='copy'){cards.splice(index+1,0,{...structuredClone(card),id:id(),name:card.name+' (копия)'});refresh();}
    if(cardAction==='delete'){cards.splice(index,1);refresh();}
    if(cardAction==='up'||cardAction==='down'){const target=index+(cardAction==='up'?-1:1);[cards[index],cards[target]]=[cards[target],cards[index]];refresh();}
  }
});

$('dashboard').onchange=()=>{current=$('dashboard').value;refresh();};
$('new-dashboard').onclick=()=>{
  const name=prompt('Название дашборда','Моя выборка');if(!name?.trim())return;
  const d=makeDashboard({name:name.trim().slice(0,100),...shared(),types:['series']});workspaces.push(d);current=d.id;refresh();
};
$('rename-dashboard').onclick=()=>{const name=prompt('Название дашборда',active().name);if(name?.trim()){active().name=name.trim().slice(0,100);refresh();}};
$('copy-dashboard').onclick=()=>{
  const d=structuredClone(active());d.id=id();d.name+=' (копия)';d.cards.forEach(card=>{card.id=id();});workspaces.push(d);current=d.id;refresh();
};
$('remove-dashboard').onclick=()=>{
  if(workspaces.length===1){announce('Оставьте хотя бы один дашборд.',true);return;}
  if(confirm(`Удалить дашборд «${active().name}»?`)){workspaces=workspaces.filter(d=>d.id!==current);current=workspaces[0].id;refresh();}
};
$('add-chart').onclick=()=>{
  showDialog('Добавить график',`<form id="new-chart-form"><label>Тип <select id="new-chart-type">${Object.entries(chartTypes).map(([key,label])=>option(key,label)).join('')}</select></label> <button class="primary">Добавить</button></form>`);
  $('new-chart-form').onsubmit=event=>{event.preventDefault();active().cards.push(makeCard($('new-chart-type').value));$('dialog').close();refresh();};
};
$('station').onchange=()=>{
  const f=shared();f.station=$('station').value;f.parameters=f.parameters.filter(key=>allowed(f.station).includes(key));
  if(!f.parameters.length)f.parameters=['t_air'];
  const info=catalog.bounds[f.station];
  if(info){f.last=info.last;f.first=iso(Math.max(stamp(info.first),stamp(info.last)-89*dayMs));}
  refresh();
};
$('first').onchange=$('last').onchange=()=>updatePeriod($('first').value,$('last').value);
$('step').onchange=()=>{shared().step=$('step').value;refresh();};
$('latest').onchange=()=>{active().latest=$('latest').checked;const latest=catalog.bounds[shared().station]?.last;if(active().latest&&latest&&latest>=shared().first)shared().last=latest;refresh();};
$('all').onclick=()=>{const b=catalog.bounds[shared().station];if(b)updatePeriod(b.first,b.last);};
$('reset').onclick=()=>{const definition=definitions.find(item=>item.station===shared().station)||definitions[1];const {name,types,...filter}=definition;active().filter={...filter,station:shared().station};active().latest=false;active().lines=defaultLines();refresh();};
$('range-first').oninput=()=>updatePeriod(iso(Math.min(stamp(shared().last),brush.start+$('range-first').value*dayMs)),shared().last,false);
$('range-last').oninput=()=>updatePeriod(shared().first,iso(Math.max(stamp(shared().first),brush.start+$('range-last').value*dayMs)),false);
$('window').onpointerdown=event=>{event.target.setPointerCapture(event.pointerId);drag={x:event.clientX,first:stamp(shared().first),last:stamp(shared().last)};};
$('window').onpointermove=event=>{
  if(!drag)return;
  const shift=Math.round((event.clientX-drag.x)/Math.max(1,$('brush').clientWidth-14)*(brush.end-brush.start)/dayMs)*dayMs;
  const first=Math.max(brush.start,Math.min(brush.end-(drag.last-drag.first),drag.first+shift));
  updatePeriod(iso(first),iso(first+drag.last-drag.first),false);
};
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('window').addEventListener(event,()=>{drag=null;});
$('quality-station').onchange=()=>{$('quality-parameter').innerHTML=htmlParameters($('quality-station').value,'t_air');showQuality();};
$('quality-run').onclick=showQuality;
$('quality-parameter').onchange=showQuality;
$('export-all').onclick=()=>configureExport(active().cards);
$('export-png').onclick=exportImage;
$('download-settings').onclick=()=>saveBlob(new Blob([JSON.stringify({version:1,current,workspaces},null,2)],{type:'application/json'}),'настройки-метеоархива.json');
$('read-settings').onclick=()=>$('settings-file').click();
function validImportedFilter(filter) {
  if(!filter || !Object.hasOwn(catalog.stations,filter.station) || !['term','day','decade','month'].includes(filter.step) || !Array.isArray(filter.parameters))return null;
  const dates=[filter.first,filter.last];
  if(dates.some(value=>typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(stamp(value)))||filter.first>filter.last)return null;
  return {station:filter.station,first:filter.first,last:filter.last,step:filter.step,
    parameters:filter.parameters.filter(key=>allowed(filter.station).includes(key)),latest:filter.latest===true};
}
$('settings-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    if(parsed.version!==1||!Array.isArray(parsed.workspaces)||!parsed.workspaces.length)throw new Error();
    const converted=parsed.workspaces.slice(0,30).map(d=>{
      const filter=validImportedFilter(d.filter);
      if(!filter||!Array.isArray(d.cards))throw new Error();
      const cards=d.cards.slice(0,12).filter(c=>Object.hasOwn(chartTypes,c.type)).map(c=>({...c,id:id(),override:validImportedFilter(c.override),hidden:Array.isArray(c.hidden)?c.hidden:[]}));
      const lines=Object.fromEntries(Object.entries(d.lines||{}).filter(([key,value])=>Object.hasOwn(catalog.parameters,key)&&Array.isArray(value)).map(([key,value])=>[key,value.filter(i=>Number.isInteger(i)&&i>=0&&i<=3)]));
      return {id:id(),name:String(d.name||'Выборка').slice(0,100),cards,lines,filter,latest:d.latest===true,layout:d.layout==='split'?'split':'overlay'};
    });
    workspaces=converted;current=workspaces[0].id;refresh();announce('Настройки загружены.');
  }catch{announce('Файл настроек не распознан.',true);}
  event.target.value='';
};
$('import-form').onsubmit=async event=>{
  event.preventDefault();knownDraft=null;$('confirm-import').hidden=true;$('preview-import').disabled=true;
  $('import-preview').textContent='Проверяем файлы…';
  try{
    const response=await request('import/preview',{method:'POST',body:new FormData(event.target),headers:{'X-Import-Key':$('import-key').value}});
    const preview=await response.json();knownDraft=preview.draft;
    $('import-preview').innerHTML=preview.sources.map(s=>`<div class="import-card"><strong>${escape(s.name)}</strong><p>${s.reference?'Справочное покрытие':`${escape(catalog.stations[s.station]?.[0]||'Выберите точку для файла')} / ${escape(s.first||'—')} — ${escape(s.last||'—')} / строк ${format.format(s.rows)} / ошибок ${s.errors} / повторов ${s.duplicates} / пересечений ${s.overlaps} / конфликтов ${s.conflicts}${s.already_imported?' / уже загружен':''}`}</p>${s.reference?'':`<p class="muted">${escape(s.parameters.join(', '))}${s.unknown.length?` / неизвестные колонки ${escape(s.unknown.join(', '))}`:''}${s.missing.length?` / отсутствуют ${escape(s.missing.join(', '))}`:''}</p><p class="muted">${escape(s.examples.map(e=>`Строка ${e.line}: ${e.reason}`).join(' / '))}</p>`}</div>`).join('');
    $('confirm-import').hidden=!preview.sources.some(s=>s.station)||preview.sources.some(s=>!s.reference&&!s.station);
  }catch(error){$('import-preview').textContent=error.message;}
  finally{$('preview-import').disabled=false;}
};
$('confirm-import').onclick=async()=>{
  if(!knownDraft)return;$('confirm-import').disabled=true;announce('Пересчитываем затронутые периоды…');
  try{
    const result=await (await request('import/'+knownDraft,{method:'POST',headers:{'X-Import-Key':$('import-key').value}})).json();
    $('confirm-import').hidden=true;knownDraft=null;$('files').value='';
    $('import-preview').textContent=`Принято ${result.accepted}, повторено ${result.duplicates}, конфликтов ${result.conflicts}, ошибок ${result.invalid}. Версия ${result.version}.`;
    await loadCatalog();announce('Архив обновлён.');
  }catch(error){announce(error.message,true);}
  finally{$('confirm-import').disabled=false;}
};
window.addEventListener('resize',()=>{currentCharts.forEach(item=>item.paint());paintOverview($('overview'),overview);});
loadCatalog();
setInterval(()=>{if(catalog&&document.visibilityState==='visible')loadCatalog(true);},24000);
