import {Router} from 'express';
import {db} from './db.js';
import {isAdmin} from './routes/auth.js';
import {additionalGuides} from './organic-guides.js';
import {LEAGUES,LEAGUE_KEYS,getScoreboard,fetchHistoricalScoreboard} from './providers/espn.js';

export const growthRouter=Router(), growthApiRouter=Router();
const ROOT='https://thesportsgenius.com';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=x=>String(x||'').slice(0,10).replaceAll('-','');
const validDay=x=>{if(!/^\d{8}$/.test(x))return false;try{return new Date(x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6)+'T12:00:00Z').toISOString().slice(0,10).replaceAll('-','')===x}catch{return false}};
export const matchupUrl=g=>'/matchup/'+encodeURIComponent(g.league)+'/'+encodeURIComponent(g.id)+'/'+day(g.date);
const niceDate=x=>new Date(x).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'full',timeStyle:'short'});
const label=k=>LEAGUES[k]?.label||k.toUpperCase();
const link=(label,url)=>'<a class="btn-ghost" href="'+esc(url)+'" style="display:inline-block;margin:8px 8px 8px 0">'+esc(label)+' →</a>';
const boundedFetch=(url,opts)=>fetch(url,{...opts,signal:AbortSignal.timeout(8000)});
const staticLinks=['/','/scores','/history','/teams','/offers','/alerts','/splits','/photo-credits','/matchups','/guides','/guides/matchup-research','/guides/understanding-odds','/tools/odds-calculator',...Object.keys(additionalGuides).map(slug=>'/guides/'+slug),'/privacy'];
function shell(title,desc,url,body,structured=null,robots='index, follow'){
 const json=structured?'<script type="application/ld+json">'+JSON.stringify(structured).replace(/</g,'\\u003c')+'</script>':'';
 const section=url.split("/")[2];
 const imgLeague=["nfl","ncaaf"].includes(section)?"nfl":["nba","ncaab"].includes(section)?"nba":["mlb","nhl"].includes(section)?section:"nfl";
 const socialImage=ROOT+"/bg/bg-"+imgLeague+".jpg";
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<title>'+esc(title)+'</title><meta name="description" content="'+esc(desc)+'"><meta name="robots" content="'+robots+'">'+
 '<link rel="canonical" href="'+ROOT+url+'"><meta property="og:type" content="website"><meta property="og:site_name" content="The Sports Genius">'+
 '<meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(desc)+'"><meta property="og:url" content="'+ROOT+url+'">'+
 '<meta property="og:image" content="'+socialImage+'"><meta name="twitter:image" content="'+socialImage+'"><meta name="twitter:card" content="summary_large_image"><link rel="alternate" type="application/rss+xml" title="Sports Genius Matchups" href="/feed.xml"><link rel="stylesheet" href="/css/style.css">'+json+'</head><body>'+
 '<div class="bg-stage" aria-hidden="true"></div><div class="bg-veil" aria-hidden="true"></div>'+
 '<header class="nav"><a class="brand" href="/">🧠 <b>THE SPORTS GENIUS</b></a><span class="age-badge">21+</span>'+
 '<nav><a class="link" href="/">Picks</a><a class="link" href="/scores">Scores</a><a class="link" href="/matchups">Matchups</a><a class="link" href="/guides">Guides</a><a class="link" href="/tools/odds-calculator">Odds calculator</a><a class="link" href="/teams">My Teams</a></nav>'+
 '<div id="nav-auth" style="display:flex;gap:10px;align-items:center"></div></header>'+
 '<div class="ticker"><span class="ticker-inner">Loading scores…</span></div><main class="wrap">'+body+'</main>'+
 '<footer>Schedules and scores supplied by ESPN. Broadcasts may change. Information only, not gambling advice. 21+. Help: 1-800-GAMBLER. <a href="/share-kit">Share</a> · <a href="/privacy">Privacy & analytics</a></footer>'+
 '<script type="module" src="/js/app.js"></script><script defer src="/js/growth-client.js"></script></body></html>';
}
let listing={at:0,games:[]};
export async function listGames(){
 if(Date.now()-listing.at<300000)return listing.games;
 const results=await Promise.allSettled(LEAGUE_KEYS.map(k=>getScoreboard(k,{fetchFn:boundedFetch})));
 const found=[];
 results.forEach((r,i)=>{
  if(r.status!=='fulfilled')return;
  for(const g of (r.value.events||[])){
   if(!g.id||!g.date||!g.home?.name||!g.away?.name)continue;
   const delta=(Date.parse(g.date)-Date.now())/86400000;
   if(delta>=-7&&delta<=14)found.push({...g,league:LEAGUE_KEYS[i]});
  }
 });
 found.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 if(found.length||!listing.games.length)listing={at:Date.now(),games:found.slice(0,120)};
 else listing.at=Date.now();
 return listing.games;
}
function card(g){
 const url=matchupUrl(g);
 const score=g.status.state==='in'||g.status.state==='post'?' · '+esc(g.away.abbr+' '+(g.away.score??'?')+' – '+g.home.abbr+' '+(g.home.score??'?')):'';
 return '<article class="card" style="margin:10px 0"><div class="league-tag">'+esc(label(g.league))+'</div>'+
 '<h2>'+esc(g.away.name+' at '+g.home.name)+'</h2><p class="sec-sub">'+esc(niceDate(g.date))+score+'</p>'+link('Game research',url)+'</article>';
}
growthRouter.get('/matchups',async(req,res)=>{
 const games=await listGames();
 const sections=LEAGUE_KEYS.map(k=>{
  const filtered=games.filter(g=>g.league===k).slice(0,18);
  return filtered.length?'<section style="margin:25px 0"><h2 class="sec-title">'+esc(label(k))+'</h2><div class="grid">'+filtered.map(card).join('')+'</div></section>':'';
 }).join('');
 const body='<section class="hero"><div class="league-tag">GAME-DAY RESEARCH</div><h1 class="display">SPORTS MATCHUPS</h1>'+
 '<p class="sub">Live and recent game information from ESPN: team records, game times, venues, scores and reported broadcasters. This is not a promise or forecast.</p></section>'+
 '<section class="card"><h2>Follow the games with context</h2><p>Use the game pages below to research each matchup, share an individual game or save it for later.</p>'+
 link('Free sports research guides','/guides')+link('Follow teams and get reminders','/teams')+link('Saved games','/saved-games')+'</section>'+
 (sections||'<section class="card" style="margin-top:20px">No recent or upcoming games are available from the source right now. '+link('Check scores','/scores')+'</section>');
 res.set('Cache-Control','public, max-age=120').send(shell('Current NFL, NBA, MLB, NHL and NCAA Matchups | Sports Genius',
 'Find real game schedules, team records, recent scores and TV listings from the NFL, NBA, NHL, MLB and NCAA.', '/matchups',body));
});
export function renderMatch(g,updatedAt=new Date().toISOString()){
 const title=g.away.name+' vs '+g.home.name+' | '+label(g.league)+' Matchup | Sports Genius';
 const desc='Game time, records, score and broadcast information for '+g.away.name+' at '+g.home.name+'. Data supplied by ESPN.';
 const canonical=ROOT+matchupUrl(g);
 const team=t=>'<div class="card" style="flex:1;min-width:200px"><h2>'+esc(t.name)+'</h2>'+
 (t.logo?'<img src="'+esc(t.logo)+'" width="60" height="60" loading="lazy" alt="">':'')+
 '<p>Record: '+esc(t.record||'Not supplied')+'</p><p>Score: '+esc(t.score??'Not started')+'</p></div>';
 const broadcasters=(g.broadcasts||[]).length?g.broadcasts.map(esc).join(', '):'No broadcast currently listed by the source.';
 const status=g.status?.detail||g.status?.state||'Scheduled';
 const body='<section class="hero"><div class="league-tag">'+esc(label(g.league))+' / MATCHUP RESEARCH</div>'+
 '<h1 class="display" style="font-size:clamp(30px,5vw,56px)">'+esc(g.away.name)+' vs '+esc(g.home.name)+'</h1>'+
 '<p class="sub">'+esc(niceDate(g.date))+' · '+esc(status)+'</p></section>'+
 '<section class="card"><h2>Matchup snapshot</h2><div style="display:flex;gap:12px;flex-wrap:wrap">'+team(g.away)+team(g.home)+'</div>'+
 '<p class="reason">Status: '+esc(status)+'. Venue: '+esc(g.venue||'Not listed')+'. Source checked: '+esc(updatedAt)+'.</p></section>'+
 '<section class="card" style="margin-top:18px"><h2>Where to watch</h2><p>'+broadcasters+'</p><p class="reason">Listings may vary by region. Always verify with the official broadcaster; a free stream is not guaranteed.</p></section>'+
 '<section class="card" style="margin-top:18px"><h2>What the data means</h2>'+
 '<p>These are provider-sourced game details, not a betting prediction. Team records can omit opponent strength and late injury or lineup changes. Check published timestamps and independent results before relying on a forecast.</p>'+
 link('How to research a matchup','/guides/matchup-research')+
 link('Open Game Center','/game?league='+encodeURIComponent(g.league)+'&id='+encodeURIComponent(g.id)+'&date='+day(g.date))+'</section>'+
 '<section class="card" style="margin-top:18px"><h2>Share, save and return</h2>'+
 '<button type="button" class="btn-gold" data-share-game="'+esc(canonical)+'">Share game</button> '+
 '<button type="button" class="btn-ghost" data-save-game="'+esc(canonical)+'" data-game-name="'+esc(g.away.name+' at '+g.home.name)+'">Save this game</button> '+
 '<button type="button" class="btn-ghost" data-calendar-game="'+esc(g.date)+'" data-game-name="'+esc(g.away.name+' at '+g.home.name)+'">Add to calendar</button>'+
 '<p class="reason">Saved games stay on this device. No signup required.</p>'+link('My saved games','/saved-games')+link('Follow my teams','/teams')+'</section>';
 const event={"@context":"https://schema.org","@type":"SportsEvent",name:g.away.name+' at '+g.home.name,startDate:g.date,url:canonical,
  homeTeam:{"@type":"SportsTeam",name:g.home.name},awayTeam:{"@type":"SportsTeam",name:g.away.name},
  eventStatus:g.status?.state==='post'?'https://schema.org/EventCompleted':g.status?.state==='in'?'https://schema.org/EventInProgress':'https://schema.org/EventScheduled'};
 if(g.venue)event.location={"@type":"Place",name:g.venue,address:[g.venueCity,g.venueState].filter(Boolean).join(', ')};
 return shell(title,desc,matchupUrl(g),body,event);
}
growthRouter.get('/matchup/:league/:id/:day',async(req,res)=>{
 const {league,id,day:date}=req.params;
 if(!LEAGUES[league]||!/^\d{1,20}$/.test(id)||!validDay(date))return res.sendStatus(404);
 const days=(Date.now()-Date.parse(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T12:00:00Z'))/86400000;
 if(days>90||days< -21)return res.sendStatus(404);
 try{
  const {events,fetchedAt}=await getScoreboard(league,{fetchFn:boundedFetch});
  let g=events.find(g=>g.id===id&&day(g.date)===date);
  if(!g&&days>=0){g=(await fetchHistoricalScoreboard(league,date,{fetchFn:boundedFetch})).find(g=>g.id===id&&day(g.date)===date)}
  if(!g)return res.sendStatus(404);
  res.set('Cache-Control','public, max-age=120').send(renderMatch(g,fetchedAt));
 }catch{res.set('Retry-After','120').status(503).send('Matchup data temporarily unavailable.');}
});
growthRouter.get('/sitemap.xml',async(req,res)=>{
 const games=await listGames(),paths=[...new Set([...staticLinks,...games.map(matchupUrl)])];
 res.type('application/xml').set('Cache-Control','public, max-age=300').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
 paths.map(u=>'  <url><loc>'+ROOT+esc(u)+'</loc></url>').join('\n')+'\n</urlset>\n');
});
growthRouter.get('/feed.xml',async(req,res)=>{
 const games=await listGames();
 res.type('application/rss+xml').set('Cache-Control','public, max-age=300').send('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'+
 '<title>Sports Genius Game Research</title><link>'+ROOT+'/matchups</link><description>Current sports matchup research and schedules, sourced from ESPN.</description>'+
 games.slice(0,35).map(g=>'<item><title>'+esc(g.away.name+' at '+g.home.name)+'</title><link>'+ROOT+matchupUrl(g)+'</link><guid>'+ROOT+matchupUrl(g)+'</guid><pubDate>'+new Date(g.date).toUTCString()+'</pubDate></item>').join('')+
 '</channel></rss>');
});
const guides={
 'matchup-research':{
 title:'How to Research a Sports Matchup Without Overtrusting Predictions',
 desc:'A practical guide to team form, opponent strength, home advantage, timestamps and the limits of predictive models.',
 parts:[
 ['Start with verified context','Confirm the league, time, teams and venue. Team records and scores are observations, not a guarantee of future results. Outdated schedules can be misleading.'],
 ['Put recent form in context','A winning streak may reflect weaker opponents or different lineups. Compare who each team played, whether matches were home or away, travel and rest when reliable sources supply them.'],
 ['Understand uncertainty','Model confidence is not certainty. A statistical model can miss roster news, injuries, weather and coaching changes. Do not treat a predicted percentage as a promise.'],
 ['Separate predictions from final scores','A completed game is not evidence a model predicted the outcome beforehand. Look for original timestamps and an auditable history of both wins and losses.'],
 ['Follow official sources','Broadcast availability varies by region. Verify current details with leagues and official providers. Sports Genius separates provider-sourced facts from forecasts.']
 ]},
 'understanding-odds':{
 title:'Moneyline, Point Spreads and Implied Probability Explained',
 desc:'A beginner-friendly guide to reading changing sports odds and understanding bookmaker margins and uncertainty.',
 parts:[
 ['Moneyline','Positive American odds describe the potential winnings on a 100-unit stake; negative odds typically describe the stake needed to win 100 units, excluding the original stake.'],
 ['Point spreads','A -3.5 favorite usually needs to win by at least four to cover that selection. A +3.5 underdog can still cover when losing by three or fewer. Settlement rules vary by market.'],
 ['Implied probability','Bookmaker margin means probabilities calculated from both sides of a market can add to more than 100%. Those probabilities are not guarantees or necessarily calibrated model probabilities.'],
 ['Line changes','Availability, injuries, information and market demand can change prices. A screenshot may become stale; confirm current odds and terms with the provider.'],
 ['Research responsibly','No pick is guaranteed, and gambling can cause harm. This guide is educational rather than betting advice. U.S. support: 1-800-GAMBLER.']
 ]}
};
Object.assign(guides,additionalGuides);

// Free educational calculator: pure client-side math, no odds feed, account or wager.
growthRouter.get('/tools/odds-calculator',(req,res)=>{
 const body='<section class="hero"><div class="league-tag">FREE TWO-WAY ODDS TOOL</div><h1 class="display">AMERICAN ODDS CALCULATOR</h1>'+
 '<p class="sub">Convert two American moneyline prices into implied probabilities and see how the combined prices include a bookmaker margin. Educational only, no sportsbook account needed.</p></section>'+
 '<section class="card" style="margin:16px 0"><h2>Convert two-way moneyline odds</h2>'+
 '<form id="odds-calc-form"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">' +
 '<div class="field"><label for="side-a">Side A (American odds)</label><input id="side-a" name="a" type="text" inputmode="numeric" value="+150" placeholder="+150" required></div>'+
 '<div class="field"><label for="side-b">Side B (American odds)</label><input id="side-b" name="b" type="text" inputmode="numeric" value="-170" placeholder="-170" required></div></div>'+
 '<button type="submit" class="btn-gold">Calculate probabilities</button></form>'+
 '<p id="odds-calc-output" class="reason" style="margin-top:18px" role="status" aria-live="polite">Loading calculator…</p>'+
 '<p class="sec-sub">For two-outcome markets only. A three-way soccer market, a draw price or a special prop requires a different calculation. These are not win predictions or promised fair prices.</p></section>'+
 '<section class="card" style="margin:16px 0"><h2>How does American odds probability work?</h2>'+
 '<p>For positive American odds +A, the implied probability is 100 ÷ (A + 100). For negative odds -A, it is A ÷ (A + 100), using the absolute value A. For example, +150 converts to 40% while -150 converts to 60%. These percentages describe the quoted prices, not the actual outcomes of a game.</p>'+
 '<h2>Why do two moneylines add to more than 100%?</h2><p>Sportsbooks commonly quote both sides with a built-in margin, also called overround or vig. Two prices of -110 and -110 imply about 52.38% each. Added together, that is roughly 104.76%; the excess 4.76 percentage points is the overround, not a guaranteed profit or a probability that either team wins.</p>'+
 '<h2>What does no-vig normalization mean?</h2><p>A common approximation divides each quoted implied probability by their combined total so they add to 100%. It proportionally removes the overround but does not make the result a calibrated forecast. This calculator cannot determine a team’s true probability or whether a price is favorable.</p>'+
 '<h2>Should I use these results for a bet?</h2><p>Use the output only to understand quoted prices. Current odds, lineup availability, settlement terms and responsible-play limits all matter. No number guarantees a result. For help with gambling in the U.S., call or text 1-800-GAMBLER.</p></section>' +
 link('Read the complete odds guide','/guides/understanding-odds')+link('How to research an NFL game','/guides/nfl-matchup-research-checklist')+
 '<script type="module" src="/js/odds-calculator.js"></script>';
 res.set('Cache-Control','public, max-age=300').send(shell('American Odds Calculator — Implied Probability & No-Vig | Sports Genius',
 'Free two-way American moneyline odds calculator: convert to implied probability, decimal odds, sportsbook overround and normalized no-vig percentages.',
 '/tools/odds-calculator',body,{"@context":"https://schema.org","@type":"WebApplication",name:"Sports Genius American Odds Calculator",applicationCategory:"UtilitiesApplication",operatingSystem:"Any",url:ROOT+'/tools/odds-calculator',description:"Free educational moneyline and implied probability converter."}));
});

growthRouter.get('/guides',(req,res)=>{
 const body='<section class="hero"><h1 class="display">SPORTS RESEARCH GUIDES</h1><p class="sub">Original educational explainers without win guarantees or made-up data.</p></section>'+
 Object.entries(guides).map(([slug,g])=>'<article class="card" style="margin:15px 0"><h2>'+esc(g.title)+'</h2><p>'+esc(g.desc)+'</p>'+link('Read the guide','/guides/'+slug)+'</article>').join('')+link('Current matchups','/matchups')+link('Free odds calculator','/tools/odds-calculator');
 res.send(shell('Sports Research Guides | Sports Genius','Read helpful sports matchup analysis and sports odds educational guides.','/guides',body));
});
growthRouter.get('/guides/:slug',(req,res)=>{
 const g=guides[req.params.slug];if(!g)return res.sendStatus(404);
 const body='<article><section class="hero"><div class="league-tag">THE SPORTS GENIUS GUIDE</div><h1 class="display" style="font-size:clamp(30px,5vw,55px)">'+esc(g.title)+'</h1><p class="sub">'+esc(g.desc)+'</p></section>'+
 g.parts.map(([heading,content])=>'<section class="card" style="margin:15px 0"><h2>'+esc(heading)+'</h2><p>'+esc(content)+'</p></section>').join('')+
 link('Find current games','/matchups')+link('Free odds calculator','/tools/odds-calculator')+link('All guides','/guides')+'</article>';
 res.send(shell(g.title+' | Sports Genius',g.desc,'/guides/'+req.params.slug,body,{"@context":"https://schema.org","@type":"Article",headline:g.title,description:g.desc,mainEntityOfPage:ROOT+'/guides/'+req.params.slug,author:{"@type":"Organization",name:"The Sports Genius"},publisher:{"@type":"Organization",name:"The Sports Genius"}}));
});
growthRouter.get('/saved-games',(req,res)=>{
 const body='<section class="hero"><h1 class="display">MY SAVED GAMES</h1><p class="sub">Your bookmarks stay in this browser. See updated details when you return.</p></section>'+
 '<section class="card" id="saved-games-list"><p class="reason">Loading bookmarks…</p></section>'+link('Find matchups','/matchups')+link('Follow teams','/teams');
 res.send(shell('Saved Matchups | Sports Genius','Revisit sports matchups saved in this browser.','/saved-games',body,null,'noindex, follow'));
});
growthRouter.get('/share-kit',(req,res)=>{
 const examples=[
 ['Game day','Before kickoff, check current matchups, team records and game times on Sports Genius. No guarantees, just useful research.','/matchups'],
 ['Live research','Scores, where-to-watch listings and matchup context in one place. Explore today’s games:','/matchups'],
 ['Learn sports odds','Moneyline and spread terms can be confusing. Here is a free, no-hype explainer:','/guides/understanding-odds','facebook'],
 ['Free odds calculator','Want to understand what +150 or -170 actually means? Our free two-way odds calculator breaks down implied probability and sportsbook margin.','/tools/odds-calculator','youtube'],
 ['NFL game research','Before kickoff, here is a free NFL checklist for injury reports, matchups and game context. Research, not a guaranteed pick.','/guides/nfl-matchup-research-checklist','facebook'],
 ['MLB postseason checklist','How do probable pitchers, bullpen workload and confirmed lineups change a postseason matchup? Start with our free checklist.','/guides/mlb-postseason-pitching-bullpen-guide','tiktok'],
 ['Check prediction records','A winning screenshot is not the same as a timestamped prediction. Here is how to check the evidence.','/guides/how-to-verify-sports-prediction-records','youtube']
 ];
 const body='<section class="hero"><h1 class="display">SHARE SPORTS GENIUS</h1><p class="sub">Organic social captions with trackable links, no invented results or false guarantees.</p></section>'+
 examples.map(([title,caption,url,platform])=>{
 const text=caption+' '+ROOT+url+'?utm_source='+encodeURIComponent(platform||'social')+'&utm_medium=organic&utm_campaign=sports_research_launch';
 return '<section class="card" style="margin:14px 0"><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p><button class="btn-gold" type="button" data-copy-caption="'+esc(text)+'">Copy caption</button></section>';
 }).join('')+link('Browse games','/matchups');
 res.send(shell('Sports Genius Social Sharing Kit','Ready-to-share sports game research captions.','/share-kit',body,null,'noindex, follow'));
});
growthRouter.get('/privacy',(req,res)=>{
 const body='<section class="hero"><div class="league-tag">YOUR PRIVACY</div><h1 class="display">Privacy & Analytics</h1>'+
 '<p class="sub">How Sports Genius measures site usage and how to make your choice.</p></section>'+
 '<section class="card"><h2>Anonymous first-party counts</h2><p>Sports Genius collects daily aggregate counts of page views, sharing, bookmarks, copied captions and calendar actions, grouped by page and broad referral category. For the private traffic monitor, it also retains short-lived minute-level aggregate pageview counts for up to three days. These counters do not save your IP address, name, account ID, cookies or full referring URL. Do Not Track and Global Privacy Control signals disable these counters.</p>'+
 '<h2>Optional Google Analytics</h2><p>With your permission, Sports Genius may load Google Analytics 4. Google Analytics can use cookies and process browsing data according to Google privacy terms. It is off unless a Sports Genius-owned measurement ID is configured and you explicitly allow it. Declining does not prevent use of the site.</p>'+
 '<p><button type="button" class="btn-ghost" data-disable-analytics>Decline or withdraw optional analytics</button></p>'+
 '<h2>Device bookmarks</h2><p>Saved games are stored locally in your browser. Clearing browser storage will remove them. Signing in and favorite-team push reminders are optional and handled separately.</p>'+
 '<h2>Contact</h2><p>For privacy questions use the contact information published by the site owner. This page does not override the terms of third-party streaming, data or authentication providers.</p></section>';
 res.send(shell('Privacy & Analytics | Sports Genius','How Sports Genius measures website traffic and handles optional analytics consent.','/privacy',body));
});
const ga4Id=()=>/^G-[A-Z0-9]{4,16}$/.test(process.env.GA4_MEASUREMENT_ID||'')?process.env.GA4_MEASUREMENT_ID:null;
growthApiRouter.get('/growth/config',(req,res)=>res.set('Cache-Control','public, max-age=300').json({ga4MeasurementId:ga4Id(),consentRequired:true}));
// First-party analytics: daily counts only, never store IP, device, account, cookie or full referrer.
db.exec('CREATE TABLE IF NOT EXISTS growth_daily(day TEXT NOT NULL,event TEXT NOT NULL,path TEXT NOT NULL,source TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,event,path,source))');
 // Anonymous minute-level pageview totals for a rolling traffic pulse.
 // No cookies, visitor identities, IPs, user agents, or full referrers are stored.
db.exec('CREATE TABLE IF NOT EXISTS growth_minute(minute TEXT PRIMARY KEY,total INTEGER NOT NULL DEFAULT 0)');
let lastGrowthPruneAt = 0;
const events=new Set(['pageview','share','save','calendar','copy']);
const sources=new Set(['direct','google','bing','social','referral','internal','email','other']);
growthApiRouter.post('/growth/track',(req,res)=>{
 if(req.get('DNT')==='1'||req.get('Sec-GPC')==='1'||/bot|crawler|spider|headless|lighthouse/i.test(req.get('user-agent')||''))return res.sendStatus(204);
 const {event,path,source}=req.body||{};
 if(!events.has(event)||typeof path!=='string'||path.length>180||!/^\/[a-z0-9/-]*$/.test(path)||!sources.has(source))return res.sendStatus(400);
 const now = new Date();
 db.prepare('INSERT INTO growth_daily(day,event,path,source,total) VALUES(?,?,?,?,1) ON CONFLICT(day,event,path,source) DO UPDATE SET total=total+1').run(now.toISOString().slice(0,10),event,path,source);
 if (event === 'pageview') {
  db.prepare('INSERT INTO growth_minute(minute,total) VALUES(?,1) ON CONFLICT(minute) DO UPDATE SET total=total+1').run(now.toISOString().slice(0,16));
  if (now.getTime()-lastGrowthPruneAt > 3600000) {
   db.prepare('DELETE FROM growth_minute WHERE minute < ?').run(new Date(now.getTime()-3*86400000).toISOString().slice(0,16));
   lastGrowthPruneAt=now.getTime();
  }
 }
 res.sendStatus(204);
});
growthApiRouter.get('/growth/summary',(req,res)=>{
 if(!req.user||!isAdmin(req.user.email))return res.sendStatus(403);
 const days=Math.min(90,Math.max(1,parseInt(req.query.days,10)||30));
 const from=new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10);
 res.set('Cache-Control','no-store').json({
 byDay:db.prepare('SELECT day,event,SUM(total) total FROM growth_daily WHERE day>=? GROUP BY day,event ORDER BY day DESC').all(from),
 byPage:db.prepare('SELECT path,SUM(total) views FROM growth_daily WHERE day>=? AND event=? GROUP BY path ORDER BY views DESC LIMIT 20').all(from,'pageview'),
 bySource:db.prepare('SELECT source,SUM(total) views FROM growth_daily WHERE day>=? AND event=? GROUP BY source ORDER BY views DESC').all(from,'pageview'),
 recent15m: db.prepare('SELECT COALESCE(SUM(total),0) views FROM growth_minute WHERE minute >= ?').get(new Date(Date.now()-15*60000).toISOString().slice(0,16)).views,
 recent5m: db.prepare('SELECT COALESCE(SUM(total),0) views FROM growth_minute WHERE minute >= ?').get(new Date(Date.now()-5*60000).toISOString().slice(0,16)).views,
 recentMetricAvailable: true,
 windowDays: days,
 reportedAt: new Date().toISOString(),
 note:'Anonymous first-party pageviews and action counts, collected only on instrumented pages when visitor privacy settings permit. Not verified unique people, bots-free traffic, or GA4. Time buckets use UTC.'
 });
});
