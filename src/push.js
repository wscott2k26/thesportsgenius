import {Router} from 'express';
import webpush from 'web-push';
import {db} from './db.js';
import {getScoreboard} from './providers/espn.js';
export const pushRouter=Router();
db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions(
 endpoint TEXT PRIMARY KEY,user_id INTEGER NOT NULL,serialized TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS push_deliveries(
 user_id INTEGER NOT NULL,event_id TEXT NOT NULL,notification_type TEXT NOT NULL,
 sent_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(user_id,event_id,notification_type)
)`);
const ready=()=>!!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);
if(ready())webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
pushRouter.get('/push/config',(req,res)=>res.json({available:ready(),publicKey:ready()?process.env.VAPID_PUBLIC_KEY:null}));
pushRouter.post('/push/subscribe',(req,res)=>{
 if(!req.user)return res.status(401).json({error:'Sign in to follow your teams'});
 if(!ready())return res.status(503).json({error:'Push not configured'});
 const sub=req.body||{};
 if(typeof sub.endpoint!=='string'||!sub.endpoint.startsWith('https://')||sub.endpoint.length>2000||
    typeof sub.keys?.p256dh!=='string'||typeof sub.keys?.auth!=='string')return res.status(400).json({error:'Invalid push subscription'});
 db.prepare('INSERT INTO push_subscriptions(endpoint,user_id,serialized) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,serialized=excluded.serialized').run(sub.endpoint,req.user.id,JSON.stringify(sub));
 res.json({ok:true});
});
pushRouter.post('/push/unsubscribe',(req,res)=>{
 if(!req.user)return res.sendStatus(401);
 const ep=String(req.body?.endpoint||'');
 db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(ep,req.user.id);
 res.json({ok:true});
});
export async function sendUpcomingGamePushes(){
 if(!ready())return {configured:false};
 const users=db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all();
 const now=Date.now();let sent=0;
 for(const {user_id} of users){
  const favs=db.prepare('SELECT league,abbr FROM favorites WHERE user_id=?').all(user_id);
  const byLeague=new Map();
  for(const f of favs){if(!byLeague.has(f.league))byLeague.set(f.league,new Set());byLeague.get(f.league).add(f.abbr);}
  for(const [league,teams] of byLeague){
   let events=[];try{({events}=await getScoreboard(league))}catch{continue}
   for(const game of events){
    const until=Date.parse(game.date)-now;
    if(game.status.state!=='pre'||until<0||until>15*60*1000)continue;
    if(!teams.has(game.home.abbr)&&!teams.has(game.away.abbr))continue;
    const delivered=db.prepare('SELECT 1 FROM push_deliveries WHERE user_id=? AND event_id=? AND notification_type=?').get(user_id,game.id,'starts_soon');
    if(delivered)continue;
    const subscribers=db.prepare('SELECT endpoint,serialized FROM push_subscriptions WHERE user_id=?').all(user_id);
    let ok=false;
    for(const row of subscribers){
     try{
      await webpush.sendNotification(JSON.parse(row.serialized),JSON.stringify({
       title:'Game starting soon',body:game.name+' starts in less than 15 minutes',
       url:'/game?league='+encodeURIComponent(league)+'&id='+encodeURIComponent(game.id)
      }),{TTL:900});
      ok=true;sent++;
     }catch(e){
      if([404,410].includes(e.statusCode))db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(row.endpoint);
     }
    }
    if(ok)db.prepare('INSERT OR IGNORE INTO push_deliveries(user_id,event_id,notification_type) VALUES (?,?,?)').run(user_id,game.id,'starts_soon');
   }
  }
 }
 return {configured:true,sent};
}
