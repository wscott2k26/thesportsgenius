// Isolated verification test: no real emails, accounts, or Stripe calls.
import test from 'node:test';
import assert from 'node:assert/strict';

test('production-style signup verifies ownership before issuing a session', async () => {
  const originals = {
    EMAIL_VERIFICATION_REQUIRED: process.env.EMAIL_VERIFICATION_REQUIRED,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    STRIPE_LIVE: process.env.STRIPE_LIVE
  };
  process.env.EMAIL_VERIFICATION_REQUIRED = '1';
  process.env.RESEND_API_KEY = 're_ISOLATED_MOCK_ONLY';
  process.env.EMAIL_FROM = 'Sports Genius <verify@stormandmeofficial.com>';
  process.env.STRIPE_LIVE = 'false';
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = (url, opts = {}) => {
    if (String(url) === 'https://api.resend.com/emails') {
      sent.push(JSON.parse(opts.body));
      return Promise.resolve(new Response(JSON.stringify({id:'email_mock'}), {status:200, headers:{'content-type':'application/json'}}));
    }
    return originalFetch(url,opts);
  };
  const {default:app} = await import('../src/app.js');
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  const base='http://127.0.0.1:'+server.address().port;
  const email='verify-'+process.pid+'@example.invalid';
  const password='verified-auth-test-password!';
  async function request(path,{method='GET',body,token}={}) {
    const headers={};
    if (body) headers['content-type']='application/json';
    if (token) headers.authorization='Bearer '+token;
    const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
    return {response,data:await response.json().catch(()=>null)};
  }
  try {
    delete process.env.RESEND_API_KEY;
    const noProvider=await request('/api/auth/register',{method:'POST',body:{email,password}});
    assert.equal(noProvider.response.status,503,'fail closed without mail sender');
    process.env.RESEND_API_KEY='re_ISOLATED_MOCK_ONLY';
    const created=await request('/api/auth/register',{method:'POST',body:{email,password}});
    assert.equal(created.response.status,202);
    assert.equal(created.data.verification_required,true);
    assert.equal(created.data.token,undefined);
    assert.equal(created.response.headers.get('set-cookie'),null);
    assert.equal(sent.length,1);
    const link=sent[0].text.match(/https:\/\/\S+verify-email\?\S+/)?.[0];
    assert.ok(link && link.includes('token='),'verification link was delivered to mocked email provider');
    const before=await request('/api/auth/login',{method:'POST',body:{email,password}});
    assert.equal(before.response.status,403,'unverified login may not create session');
    assert.equal((await request('/api/auth/me')).response.status,401);
    const bogus=await fetch(base+'/api/auth/verify-email?uid=1&token=not-a-token');
    assert.equal(bogus.status,400);
    const u=new URL(link);
    const verified=await fetch(base+u.pathname+u.search);
    assert.equal(verified.status,200);
    assert.equal(verified.headers.get('referrer-policy'),'no-referrer');
    assert.equal((await fetch(base+u.pathname+u.search)).status,400,'verification token is single-use');
    const logged=await request('/api/auth/login',{method:'POST',body:{email,password}});
    assert.equal(logged.response.status,200);
    assert.match(logged.data.token,/^[0-9a-f]{64}$/);
    assert.equal((await request('/api/auth/me',{token:logged.data.token})).response.status,200);
    const checkout=await request('/api/billing/checkout',{method:'POST',token:logged.data.token});
    assert.equal(checkout.response.status,503,'live checkout remains disabled in isolated test');
  } finally {
    await new Promise(resolve=>server.close(resolve));
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(originals))
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
  }
});
