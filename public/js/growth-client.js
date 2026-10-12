// Anonymous, cookieless conversion counters and visitor-friendly game tools.
(()=>{
 const key='sg_saved_matchups_v1';
 const valid=u=>{try{const x=new URL(u,location.origin);return x.origin===location.origin&&/^\/matchup\/(nfl|nba|mlb|nhl|ncaab|ncaaf)\/\d{1,20}\/\d{8}$/.test(x.pathname)?x.pathname:null}catch{return null}};
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const saved=()=>{try{const a=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(a)?a.filter(x=>valid(x.url)).slice(0,50):[]}catch{return []}};
 const trackingAllowed=()=>navigator.doNotTrack!=='1'&&navigator.globalPrivacyControl!==true;
 const source=()=>{
   const q=new URLSearchParams(location.search);
   const campaign=(q.get('utm_source')||'').toLowerCase();
   if(/instagram|tiktok|facebook|youtube|reddit|social|x|twitter/.test(campaign))return 'social';
   if(/newsletter|email/.test(campaign))return 'email';
   if(/google/.test(campaign))return 'google';
   if(/bing/.test(campaign))return 'bing';
   if(!document.referrer)return 'direct';
   try{const host=new URL(document.referrer).hostname.toLowerCase();if(host===location.hostname)return 'internal';if(/(^|\.)google\./.test(host))return 'google';if(/(^|\.)bing\.com$/.test(host))return 'bing';if(/(tiktok|instagram|facebook|reddit|youtube|twitter|x\.com)/.test(host))return 'social';return 'referral'}catch{return 'other'}
 };
 const track=event=>{
  if(!trackingAllowed())return;
  const payload=JSON.stringify({event,path:location.pathname,source:source()});
  try{const blob=new Blob([payload],{type:'application/json'});if(navigator.sendBeacon&&navigator.sendBeacon('/api/growth/track',blob))return}catch{}
  fetch('/api/growth/track',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true,credentials:'omit'}).catch(()=>{});
 };
 const msg=text=>{
  let t=document.getElementById('growth-toast');
  if(!t){t=document.createElement('div');t.id='growth-toast';t.className='toast';document.body.appendChild(t)}
  t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);
 };
 async function copy(text){
  try{await navigator.clipboard.writeText(text);msg('Copied to clipboard')}catch{msg('Copy this link: '+text)}
 }
 async function share(url){
  if(navigator.share){try{await navigator.share({title:'Sports Genius matchup',url});track('share');return}catch{}}
  await copy(url);track('share');
 }
 function ics(name,start){
  const startMs=Date.parse(start);if(!Number.isFinite(startMs))return;
  const date=ms=>new Date(ms).toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
  const tidy=s=>String(s).replace(/[\r\n]/g,' ').replace(/[,;\\]/g,' ');
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//The Sports Genius//Matchup Reminders//EN','BEGIN:VEVENT',
   'UID:sg-'+date(startMs)+'@thesportsgenius.com','DTSTAMP:'+date(Date.now()),
   'DTSTART:'+date(startMs),'DTEND:'+date(startMs+2*3600000),'SUMMARY:'+tidy(name),
   'DESCRIPTION:Game time is subject to change. Confirm with the official league or broadcaster.',
   'END:VEVENT','END:VCALENDAR',''].join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='sports-genius-game.ics';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);track('calendar');
 }
 function drawSaved(){
  const el=document.getElementById('saved-games-list');if(!el)return;
  const records=saved();
  el.innerHTML=records.length?records.map(x=>'<div class="sg-game" style="margin:10px 0"><strong>'+esc(x.name)+'</strong> '+
    '<a href="'+esc(valid(x.url))+'" class="btn-ghost">View latest</a> '+
    '<button class="btn-ghost" type="button" data-remove-game="'+esc(valid(x.url))+'">Remove</button></div>').join('')+
    '<p class="reason">Saved only in this browser; clearing site data removes these bookmarks.</p>'
   :'<p class="reason">Nothing saved yet. Open any game from the matchup directory and select “Save this game.”</p>';
 }
 document.addEventListener('click',e=>{
  const shareBtn=e.target.closest('[data-share-game]');
  if(shareBtn){share(shareBtn.dataset.shareGame);return}
  const saveBtn=e.target.closest('[data-save-game]');
  if(saveBtn){
   const url=valid(saveBtn.dataset.saveGame);if(!url)return;
   const items=saved().filter(x=>valid(x.url)!==url);
   items.unshift({url,name:String(saveBtn.dataset.gameName||'Game').slice(0,150)});
   try{localStorage.setItem(key,JSON.stringify(items.slice(0,50)));msg('Game saved for later');track('save')}catch{msg('Your browser could not save this game')}
   return;
  }
  const remove=e.target.closest('[data-remove-game]');
  if(remove){try{localStorage.setItem(key,JSON.stringify(saved().filter(x=>valid(x.url)!==remove.dataset.removeGame)));drawSaved()}catch{}return}
  const calendar=e.target.closest('[data-calendar-game]');
  if(calendar){ics(calendar.dataset.gameName,calendar.dataset.calendarGame);return}
  const caption=e.target.closest('[data-copy-caption]');
  if(caption){copy(caption.dataset.copyCaption);track('copy')}
 });
 const consentKey='sg_ga4_consent_v1';
 async function optionalAnalytics(){
  if(!trackingAllowed())return;
  let cfg;try{const r=await fetch('/api/growth/config');if(!r.ok)return;cfg=await r.json()}catch{return}
  const id=cfg?.ga4MeasurementId;
  if(!/^G-[A-Z0-9]{4,16}$/.test(id||''))return;
  const status=()=>{try{return localStorage.getItem(consentKey)}catch{return null}};
  const load=()=>{
   if(window.__sgGaLoaded)return;
   window.__sgGaLoaded=true;
   window.dataLayer=window.dataLayer||[];
   window.gtag=function(){window.dataLayer.push(arguments)};
   window.gtag('js',new Date());
   window.gtag('config',id,{anonymize_ip:true});
   const tag=document.createElement('script');tag.async=true;
   tag.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);
   document.head.appendChild(tag);
  };
  if(status()==='yes'){load();return}
  if(status()==='no')return;
  const banner=document.createElement('div');
  banner.setAttribute('role','region');
  banner.setAttribute('aria-label','Optional analytics choice');
  banner.style.cssText='position:fixed;bottom:14px;left:14px;right:14px;z-index:9998;max-width:650px;margin:auto;background:#121b29;color:#fff;border:1px solid #b89547;border-radius:12px;padding:16px;box-shadow:0 6px 28px #000a;font:14px/1.5 system-ui,sans-serif';
  const message=document.createElement('p');message.textContent='Help us improve Sports Genius? Optional Google Analytics can collect usage data and use cookies. You can decline and still use the site.';
  message.style.margin='0 0 12px';
  const choices=document.createElement('div');
  const button=(label,choice)=>{const b=document.createElement('button');b.type='button';b.className='btn-ghost';b.textContent=label;b.style.marginRight='8px';b.onclick=()=>{try{localStorage.setItem(consentKey,choice)}catch{}banner.remove();if(choice==='yes')load()};return b};
  choices.append(button('Allow analytics','yes'),button('No thanks','no'));
  const details=document.createElement('a');details.href='/privacy';details.textContent='Privacy details';details.style.color='#f5d18a';details.style.marginLeft='6px';choices.append(details);
  banner.append(message,choices);document.body.appendChild(banner);
 }
 document.addEventListener('click',e=>{
  if(!e.target.closest('[data-disable-analytics]'))return;
  try{localStorage.setItem(consentKey,'no')}catch{}
  if(typeof window.gtag==='function')window.gtag('consent','update',{analytics_storage:'denied'});
  for(const part of document.cookie.split(';')){
   const cookieName=part.split('=')[0].trim();
   if(cookieName==='_ga'||cookieName.startsWith('_ga_'))document.cookie=cookieName+'=;Max-Age=0;path=/;SameSite=Lax';
  }
  msg('Optional analytics disabled on this browser');
 });
 document.addEventListener('DOMContentLoaded',()=>{track('pageview');drawSaved();optionalAnalytics()});
})();
