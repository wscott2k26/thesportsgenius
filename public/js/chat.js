/* Chat page: Ask the Genius */
import { api, esc, toast } from './app.js';

let booted = false;

function bubble(cls, text) {
  const m = document.getElementById('msgs');
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  m.appendChild(div);
  m.scrollTop = m.scrollHeight;
}

async function updateQuota() {
  const q = document.getElementById('quota');
  if (!q) return;
  const { data } = await api('/api/chat/quota');
  q.textContent = data.premium
    ? 'Premium: unlimited Genius chat'
    : `Free: ${Math.max(0, 5 - data.used)} of 5 chats left today`;
}

async function send() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  bubble('q', text);
  bubble('a', 'The Genius is thinking…');
  const thinking = document.querySelector('#msgs .msg.a:last-child');
  try {
    const { res, data } = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
    thinking.remove();
    if (!res.ok && data.error === 'limit') {
      bubble('a', data.reply);
      toast('Daily free chat limit reached');
    } else if (!res.ok) {
      bubble('a', 'Something went wrong. Try again in a moment.');
    } else {
      bubble('a', data.reply + (data.mode === 'fallback' ? '' : '\n\nFor entertainment. Not gambling advice.'));
    }
  } catch {
    thinking.remove();
    bubble('a', 'Network error. Check your connection and try again.');
  }
  updateQuota();
}

document.addEventListener('DOMContentLoaded', () => {
  if (booted || !document.getElementById('msgs')) return;
  booted = true;
  document.getElementById('send').onclick = send;
  document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  bubble('a', 'Ask me anything — "Who wins tonight, Chiefs or Bills?", "How are the Lakers doing?", "Best bet today?" I pull live scores, standings, and today\'s Genius picks to answer.');
  updateQuota();
});
