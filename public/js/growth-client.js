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
 document.addEventListener('DOMContentLoaded',()=>{track('pageview');drawSaved()});
})();
