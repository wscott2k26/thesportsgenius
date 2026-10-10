self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{}}catch{}
 const safeUrl=typeof data.url==='string'&&data.url.startsWith('/')&&!data.url.startsWith('//')?data.url:'/';
 event.waitUntil(self.registration.showNotification(data.title||'Sports Genius',{
  body:data.body||'Game update',tag:'sports-genius-'+safeUrl,icon:'/favicon.ico',data:{url:safeUrl}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(clients.openWindow(event.notification.data?.url||'/'));
});
