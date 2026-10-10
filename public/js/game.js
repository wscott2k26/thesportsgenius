const q=new URLSearchParams(location.search);
const el=document.getElementById('game-center');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const league=q.get('league')||'nfl',id=q.get('id')||'';
(async()=>{
 try{
 const res=await fetch('/api/game?'+new URLSearchParams({league,id,date:q.get('date')||''}));
 const d=await res.json();if(!res.ok)throw Error(d.error||'Game unavailable');
 const g=d.game,teams=[g.away,g.home];
 const team=t=>'<div class="sg-center-team">'+(t.logo?'<img src="'+esc(t.logo)+'" alt="" loading="lazy">':'')+'<h2>'+esc(t.name)+'</h2><div>'+esc(t.record||'Record unavailable')+'</div><strong>'+esc(t.score??'')+'</strong></div>';
 const schedule=new Date(g.date).toLocaleString('en-US',{dateStyle:'full',timeStyle:'short',timeZone:'America/New_York'})+' ET';
 const yt='https://www.youtube.com/results?search_query='+encodeURIComponent(teams.map(t=>t.name).join(' vs ')+' '+league+' official live game');
 const google='https://www.google.com/search?'+new URLSearchParams({q:teams.map(t=>t.name).join(' vs ')+' where to watch official'});
 const picks=(d.picks||[]).map(p=>'<div class="sg-game"><strong>'+esc(p.pick_team)+'</strong> · '+esc(p.pick_type)+' · '+esc(p.confidence)+'% · '+esc(p.status)+'<small style="display:block">Issued: '+esc(p.issued_at||'Original timestamp unavailable')+'</small></div>').join('');
 el.innerHTML='<div class="card"><div class="league-tag">'+esc(league.toUpperCase())+' · '+esc(g.status.detail||g.status.state)+'</div><div class="sg-center-matchup">'+teams.map(team).join('<span class="sg-versus">VS</span>')+'</div><p class="sec-sub">'+esc(schedule)+' · '+esc(g.venue||'Venue not listed')+'</p></div>'+
 '<div class="sg-center-panels"><section class="card"><h3>GENIUS PREDICTIONS</h3>'+(picks||'<p class="reason">No recorded model pick for this matchup yet.</p>')+'</section>'+
 '<section class="card"><h3>WHERE TO WATCH</h3><p class="reason">'+(g.broadcasts.length?g.broadcasts.map(esc).join(' · '):'No broadcaster listed by provider')+'</p><p><a class="btn-ghost" target="_blank" rel="noopener" href="'+esc(google)+'">Find official broadcast ↗</a></p><p><a target="_blank" rel="noopener" href="'+esc(yt)+'">Search YouTube for official coverage ↗</a></p><small>Search links are not verified free streams.</small></section></div>';
 const research=d.research||{};
 const summaryBlock=document.createElement('section');summaryBlock.className='card';summaryBlock.style.marginTop='18px';
 const leaders=(research.leaders||[]).flatMap(t=>(t.categories||[]).filter(c=>c.athlete).map(c=>'<div class="sg-game">'+esc(t.team)+': <strong>'+esc(c.athlete)+'</strong> · '+esc(c.name)+' '+esc(c.value)+'</div>')).slice(0,8).join('');
 const last=(research.lastFiveGames||[]).flatMap(t=>(t.events||[]).map(e=>'<div class="sg-game">'+esc(t.team)+' · '+esc(e.name)+' · '+esc(e.result)+' '+esc(e.score)+'</div>')).slice(0,10).join('');
 summaryBlock.innerHTML='<h3 style="color:var(--gold)">MATCHUP RESEARCH</h3>'+(leaders?'<h4>Player leaders</h4>'+leaders:'<p class="reason">Player leaders not supplied for this matchup.</p>')+(last?'<h4>Recent games</h4>'+last:'<p class="reason">Recent form not supplied for this matchup.</p>')+'<p class="sec-sub">Source: ESPN game summary. Injury and lineup information not verified.</p>';
 el.appendChild(summaryBlock);
 document.title=teams.map(t=>t.abbr).join(' vs ')+' | Sports Genius Game Center';
 }catch(e){el.innerHTML='<div class="card">'+esc(e.message)+' · <a href="/scores">Back to Scores</a></div>'}
})();
