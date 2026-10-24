// Browser QA runs only against an ephemeral local server/database in CI.
// This never uses Railway/Stripe keys or creates production customer records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import app from '../src/app.js';

assert.equal(process.env.DB_PATH, ':memory:', 'browser smoke requires an in-memory DB');
const server = await new Promise(resolve => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const suffix = randomUUID().slice(0, 12);
  const email = 'sg-browser-' + suffix + '@example.test';
  const password = 'local-qa-' + suffix + '-safe!';
  console.log('Browser smoke: open homepage');
  const response = await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.locator('#nav-auth').getByText('Join free').waitFor({timeout:15000});
  await page.locator('#nav-auth').getByText('Join free').click();
  await page.locator('#auth-modal form[data-form="register"] input[name="email"]').fill(email);
  await page.locator('#auth-modal form[data-form="register"] input[name="password"]').fill(password);
  await page.locator('#auth-modal form[data-form="register"] button').click();
  await page.locator('#nav-auth').getByRole('button', {name:'Sign out'}).waitFor({timeout:15000});
  const me = await context.request.get(base + '/api/auth/me');
  assert.equal(me.status(), 200, 'new browser session must be signed in');
  assert.equal((await me.json()).user.email, email);
  const cookie = (await context.cookies()).find(c => c.name === 'sg_token');
  assert.ok(cookie?.httpOnly, 'session cookie is HttpOnly');
  assert.equal(cookie?.sameSite, 'Lax');
  console.log('Browser smoke: registration, cookie and user session passed');

  await page.locator('#nav-auth').getByRole('button', {name:'Sign out'}).click();
  await page.locator('#nav-auth').getByText('Join free').waitFor({timeout:15000});
  assert.equal((await context.request.get(base + '/api/auth/me')).status(), 401);
  console.log('Browser smoke: logout invalidation passed');

  await page.locator('#nav-auth').getByText('Sign in').click();
  await page.locator('#auth-modal form[data-form="login"] input[name="email"]').fill(email);
  await page.locator('#auth-modal form[data-form="login"] input[name="password"]').fill(password);
  await page.locator('#auth-modal form[data-form="login"] button').click();
  await page.locator('#nav-auth').getByRole('button', {name:'Sign out'}).waitFor({timeout:15000});
  assert.equal((await context.request.get(base + '/api/auth/me')).status(), 200);
  console.log('Browser smoke: login passed');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve,reject) => server.close(error=>error?reject(error):resolve()));
}
