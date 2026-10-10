import {esc} from './app.js';
const date=document.getElementById('hist-date'),league=document.getElementById('hist-league'),status=document.getElementById('hist-status'),grid=document.getElementById('hist-results');
const iso=x=>[x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-');
const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
const oldest=new Date(now);oldest.setDate(now.getDate()-90);
date.max=iso(yesterday);date.min=iso(oldest);date.value=iso(yesterday);
async function load(){
 status.textContent='Loading verified results...';grid.innerHTML='';
 const d=date.value.replaceAll('-','');
 try{
  const response=await fetch('/api/history?league='+encodeURIComponent(league.value)+'&date='+d);
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not fetch results');
  status.textContent=data.count+' completed games on '+date.value+' (not predictions)';
  if(!data.games.length){grid.innerHTML='<div class="card">No completed games found for this league and date.</div>';return}
  grid.innerHTML=data.games.map(g=>'<article class="card"><div class="league-tag">'+esc(data.league.toUpperCase())+' - FINAL</div><h2 class="matchup">'+esc(g.away.name)+' '+esc(g.away.score)+' - '+esc(g.home.score)+' '+esc(g.home.name)+'</h2><p class="reason">'+esc(g.venue||'Venue unavailable')+'</p></article>').join('');
 }catch(err){status.textContent='Could not load results: '+err.message}
}
document.getElementById('hist-load').addEventListener('click',load);load();
