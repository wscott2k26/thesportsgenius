// Local, isolated authentication smoke test. Runs with DB_PATH=:memory: in CI.
// It never creates production accounts or makes billing requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

test('complete auth lifecycle: register, cookie, bearer, isolation, login, logout', async () => {
  const server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const emailA = 'qa-auth-a-' + process.pid + '@example.test';
  const emailB = 'qa-auth-b-' + process.pid + '@example.test';

  async function request(path, { method = 'GET', token, cookie, body } = {}) {
    const headers = {};
    if (token) headers.authorization = 'Bearer ' + token;
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, headers: response.headers, data };
  }

  try {
    const unauthenticated = await request('/api/auth/me');
    assert.equal(unauthenticated.status, 401, 'guest must not receive an account');

    const weak = await request('/api/auth/register', {
      method: 'POST', body: { email: emailA, password: 'short' }
    });
    assert.equal(weak.status, 400);

    const created = await request('/api/auth/register', {
      method: 'POST', body: { email: emailA, password: 'qa-strong-password-1234' }
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.user.email, emailA);
    assert.equal(created.data.user.premium, false);
    assert.match(created.data.token, /^[0-9a-f]{64}$/);
    const setCookie = created.headers.get('set-cookie') || '';
    assert.match(setCookie, /sg_token=/);
    assert.match(setCookie, /httponly/i);
    assert.match(setCookie, /samesite=lax/i);
    const cookieA = setCookie.split(';')[0];

    const duplicate = await request('/api/auth/register', {
      method: 'POST', body: { email: emailA, password: 'qa-strong-password-1234' }
    });
    assert.equal(duplicate.status, 409);

    assert.equal((await request('/api/auth/me', { token: created.data.token })).status, 200);
    assert.equal((await request('/api/auth/me', { cookie: cookieA })).status, 200);
    assert.equal((await request('/api/favorites')).status, 401);

    const add = await request('/api/favorites', {
      method: 'POST', token: created.data.token,
      body: { team_key: 'nfl:kc', league: 'nfl', abbr: 'KC', name: 'Kansas City Chiefs' }
    });
    assert.equal(add.status, 200);

    const other = await request('/api/auth/register', {
      method: 'POST', body: { email: emailB, password: 'qa-second-password-1234' }
    });
    assert.equal(other.status, 200);
    const otherFavs = await request('/api/favorites', { token: other.data.token });
    assert.equal(otherFavs.status, 200);
    assert.deepEqual(otherFavs.data.favorites, [], 'other users cannot read saved teams');

    const badLogin = await request('/api/auth/login', {
      method: 'POST', body: { email: emailA, password: 'wrong-password' }
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await request('/api/auth/login', {
      method: 'POST', body: { email: emailA, password: 'qa-strong-password-1234' }
    });
    assert.equal(goodLogin.status, 200);
    assert.equal((await request('/api/auth/me', { token: goodLogin.data.token })).status, 200);

    const loggedOut = await request('/api/auth/logout', {
      method: 'POST', token: goodLogin.data.token
    });
    assert.equal(loggedOut.status, 200);
    assert.equal(loggedOut.data.ok, true);
    assert.equal((await request('/api/auth/me', { token: goodLogin.data.token })).status, 401,
      'logout invalidates that session token');
    assert.equal((await request('/api/auth/me', { token: other.data.token })).status, 200,
      'another user remains authenticated');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
