/* Owner-only dashboard. Uses existing first-party aggregate analytics; no individual tracking. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const status=$('summary-status');
const content=$('traffic-content');
let selectedDays=30;
const shareLinks=[
 ['TikTok · Josie reactions','https://thesportsgenius.com/josie?utm_source=tiktok&utm_medium=social&utm_campaign=josie_reacts'],
 ['YouTube · Live scores','https://thesportsgenius.com/scores?utm_source=youtube&utm_medium=social&utm_campaign=josie_scores'],
 ['Facebook · Game-day matchups','https://thesportsgenius.com/matchups?utm_source=facebook&utm_medium=social&utm_campaign=game_day'],
 ['Instagram · Josie reactions','https://thesportsgenius.com/josie?utm_source=instagram&utm_medium=social&utm_campaign=josie_reacts'],
 ['TikTok · Daily picks','https://thesportsgenius.com/?utm_source=tiktok&utm_medium=social&utm_campaign=josie_picks']
];
const safe=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=v=>Number(v||0).toLocaleString('en-US');
const rows=v=>Array.isArray(v)?v:[];
const sum=(data,event)=>rows(data).filter(x=>x.event===event).reduce((n,x)=>n+(Number(x.total)||0),0);
const byDay=(data,event='pageview')=>new Map(rows(data).filter(x=>x.event===event).map(x=>[String(x.day),Number(x.total)||0]));
const dayKey=(iso,minus=0)=>{const d=new Date(iso);d.setUTCDate(d.getUTCDate()-minus);return d.toISOString().slice(0,10)};
const periodTotal=(data,fromAgo,toAgo=0,event='pageview')=>{const map=byDay(data,event);let total=0;for(let i=toAgo;i<=fromAgo;i++)total+=map.get(dayKey(data[0]?.__time||new Date().toISOString(),i))||0;return total};
const changeBadge=(week,previous)=>{
 if(previous===0)return week>0?'New traffic versus prior week':'No prior-week traffic';
 const delta=(week-previous)/previous*100;
 return (delta>0?'+':'')+Math.round(delta)+'% vs previous 7 days';
};
const kpi=(label,value,hint,featured=false)=>'<div class="traffic-kpi'+(featured?' traffic-highlight':'')+'"><div class="traffic-label">'+safe(label)+'</div><strong>'+amount(value)+'</strong><div class="traffic-hint">'+safe(hint)+'</div></div>';
const meter=(label,value,max)=>'<div class="traffic-metric"><div class="traffic-metric-top"><span class="traffic-metric-name">'+safe(label)+'</span><span class="traffic-metric-num">'+amount(value)+'</span></div><div class="traffic-meter" aria-hidden="true"><span style="width:'+Math.max(0,Math.min(100,max?100*value/max:0))+'%"></span></div></div>';
function renderList(id,items,label,value,empty){
 const list=rows(items).slice(0,9), max=Math.max(1,...list.map(r=>Number(r[value])||0));
 $(id).innerHTML=list.length?list.map(r=>meter(r[label],Number(r[value])||0,max)).join(''):'<p class="traffic-empty">'+safe(empty)+'</p>';
}
function renderChart(data,reportedAt){
 const period=selectedDays, dayMap=byDay(data.byDay);
 let days=[],max=1;
 for(let offset=period-1;offset>=0;offset--){const d=dayKey(reportedAt,offset);const n=dayMap.get(d)||0;max=Math.max(max,n);days.push([d,n])}
 const sampled=days.map(([d,n],i)=>{
  const date=new Date(d+'T00:00:00Z');
  const show=period===7||i%5===0||i===days.length-1;
  const tiny=date.toLocaleDateString('en-US',{month:'numeric',day:'numeric',timeZone:'UTC'});
  return '<div class="traffic-day" title="'+safe(d+': '+n+' pageviews')+'"><div class="traffic-bar-wrap"><div class="traffic-bar" style="height:'+Math.max(4,Math.round(n/max*100))+'%" aria-hidden="true"></div></div><span class="traffic-date">'+(show?safe(tiny):'')+'</span></div>';
 }).join('');
 $('traffic-chart').innerHTML=sampled;
 $('traffic-chart').setAttribute('aria-label','Daily tracked pageviews, '+period+' days ending '+dayKey(reportedAt));
 $('traffic-trend-subtitle').textContent='Tracked pageviews per day (UTC) · last '+period+' days';
}
function renderReport(d){
 const date=d.reportedAt||new Date().toISOString();
 const dayMap=byDay(d.byDay), daily=offset=>dayMap.get(dayKey(date,offset))||0;
 const today=daily(0),last7=Array.from({length:7},(_,i)=>daily(i)).reduce((a,b)=>a+b,0);
 const previous7=Array.from({length:7},(_,i)=>daily(i+7)).reduce((a,b)=>a+b,0);
 const periodViews=sum(d.byDay,'pageview');
 const actions=['share','save','calendar','copy'].map(e=>[e,sum(d.byDay,e)]);
 const actionsTotal=actions.reduce((n,x)=>n+x[1],0);
 const kpis=[
  kpi('Pageviews · '+selectedDays+' days',periodViews,'Counted page loads, not unique visitors',true),
  kpi('Today · UTC',today,'Pageviews so far today'),
  kpi('Last 7 days',last7,changeBadge(last7,previous7)),
  kpi('Last 5 minutes',d.recent5m,'Tracked pageviews in the last 5 minutes'),
  kpi('Last 15 minutes',d.recent15m,'Tracked pageviews in the last 15 minutes'),
  kpi('Meaningful actions',actionsTotal,'Shares, saves, calendars and copies')
 ];
 $('traffic-kpis').innerHTML=kpis.join('');
 renderChart(d,date);
 $('traffic-trend-badge').textContent=changeBadge(last7,previous7);
 $('traffic-trend-badge').classList.toggle('negative',last7<previous7);
 $('traffic-actions').innerHTML=actions.map(([event,n])=>'<div class="traffic-action"><strong>'+amount(n)+'</strong><span>'+safe(({share:'Shares',save:'Saved games',calendar:'Calendar reminders',copy:'Copied captions'})[event])+'</span></div>').join('');
 renderList('traffic-pages',d.byPage,'path','views','No tracked pageviews for this period.');
 renderList('traffic-sources',d.bySource,'source','views','No attribution recorded for this period.');
 const campaigns=rows(d.byCampaign);
 $('traffic-campaigns').innerHTML=campaigns.length?'<div class="traffic-campaign-grid">'+campaigns.map(r=>'<div class="traffic-campaign"><span class="traffic-label">'+safe(r.source)+'</span><strong>'+safe(r.campaign.replaceAll('_',' '))+'</strong><div class="traffic-value">'+amount(r.views)+'</div><span class="traffic-label">landing-page views</span></div>').join('')+'</div>':'<p class="traffic-empty">No campaign-tagged visits yet. Use one of the trackable links below, then refresh after someone opens it. We do not count clicks until the page actually loads and first-party tracking runs.</p>';
 $('traffic-disclaimer').textContent='Tracked pageviews are not verified people. Counts honor Do Not Track / Global Privacy Control, can include repeat visits or some automated traffic, and store no visitor identifiers. Campaign statistics only count visits with approved tags. Server time: '+new Date(date).toLocaleString()+'.';
}
function renderLinks(){
 $('traffic-share-links').innerHTML=shareLinks.map(([label,url],i)=>'<div class="traffic-link-item"><strong>'+safe(label)+'</strong><code>'+safe(url)+'</code><button type="button" data-copy-link="'+i+'">Copy link</button></div>').join('');
}
async function load(){
 status.classList.remove('error'); status.textContent='Refreshing private analytics…';
 $('traffic-refresh').disabled=true;
 try{
  const headers={};
  let token='';try{token=localStorage.getItem('sg_token')||''}catch{}
  if(token)headers.Authorization='Bearer '+token;
  const r=await fetch('/api/growth/summary?days='+selectedDays,{headers,cache:'no-store'});
  if(r.status===401||r.status===403){content.hidden=true;status.classList.add('error');status.textContent='Administrator sign-in required. Sign in on the Sports Genius homepage with an authorized admin account, then return here.';return}
  if(!r.ok)throw Error('The traffic report is temporarily unavailable (HTTP '+r.status+').');
  const d=await r.json();
  renderReport(d);
  content.hidden=false;status.textContent='Updated '+new Date(d.reportedAt||Date.now()).toLocaleString()+' · '+selectedDays+'-day window · UTC reporting';
 }catch(e){status.classList.add('error');status.textContent=e.message||'Could not load the report';}finally{$('traffic-refresh').disabled=false;}
}
document.querySelectorAll('[data-range]').forEach(button=>button.addEventListener('click',()=>{
 const days=Number(button.dataset.range);if(days!==7&&days!==30)return;
 selectedDays=days;
 document.querySelectorAll('[data-range]').forEach(b=>{const yes=Number(b.dataset.range)===days;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes))});
 load();
}));
$('traffic-refresh').addEventListener('click',load);
$('traffic-share-links').addEventListener('click',async e=>{
 const b=e.target.closest('button[data-copy-link]');if(!b)return;
 const entry=shareLinks[Number(b.dataset.copyLink)];if(!entry)return;
 try{await navigator.clipboard.writeText(entry[1]);b.textContent='Copied ✓';setTimeout(()=>b.textContent='Copy link',1600)}
 catch{b.textContent='Select and copy link above';}
});
renderLinks();load();
})();