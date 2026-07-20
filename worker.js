// CoachPilot Worker — BeroFit Platform
// Handles magic link auth, client management, scheduling

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Trainer-Token',
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function html(content, status=200) {
  return new Response(content, {
    status,
    headers: { ...CORS, 'Content-Type': 'text/html;charset=utf-8' }
  });
}

// Generate a random token
function genToken(len=32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i=0; i<len; i++) result += chars[Math.floor(Math.random()*chars.length)];
  return result;
}

async function verifyTrainer(request, db) {
  const token = request.headers.get('X-Trainer-Token');
  if (!token) return null;
  const row = await db.prepare(
    'SELECT * FROM trainers WHERE session_token=? AND token_expires > ?'
  ).bind(token, Date.now()).first();
  return row || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const db = env.DB;

    if (method === 'OPTIONS') return new Response('', { headers: CORS });

    // ── AUTH ROUTES ─────────────────────────────────────────────────────────

    // POST /auth/request — send magic link
    if (path === '/auth/request' && method === 'POST') {
      const { email } = await request.json();
      if (!email) return json({ error: 'Email required' }, 400);

      const emailLower = email.toLowerCase().trim();
      const magicToken = genToken(48);
      const expires = Date.now() + (15 * 60 * 1000); // 15 min

      // Check if trainer exists
      let trainer = await db.prepare('SELECT * FROM trainers WHERE email=?').bind(emailLower).first();

      if (!trainer) {
        // New trainer — create trial account
        const trialEnd = Date.now() + (14 * 24 * 60 * 60 * 1000); // 14 days
        await db.prepare(`
          INSERT INTO trainers (email, magic_token, magic_expires, trial_end, created_at, status,
            brand_name, brand_color, brand_secondary)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(emailLower, magicToken, expires, trialEnd, Date.now(), 'trial',
          'My Coaching Brand', '#2563eb', '#1e40af').run();
      } else {
        // Existing trainer — update magic token
        await db.prepare('UPDATE trainers SET magic_token=?, magic_expires=? WHERE email=?')
          .bind(magicToken, expires, emailLower).run();
      }

      // Send magic link email via Cloudflare Email or just return for now
      const magicLink = `${url.origin}/auth/verify?token=${magicToken}`;

      // In production this sends via email — for now return link in response for testing
      return json({ success: true, magic_link: magicLink, message: 'Magic link sent' });
    }

    // GET /auth/verify — verify magic link
    if (path === '/auth/verify' && method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) return json({ error: 'Token required' }, 400);

      const trainer = await db.prepare(
        'SELECT * FROM trainers WHERE magic_token=? AND magic_expires > ?'
      ).bind(token, Date.now()).first();

      if (!trainer) return json({ error: 'Invalid or expired link' }, 401);

      const sessionToken = genToken(64);
      const sessionExpires = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

      await db.prepare(`
        UPDATE trainers SET session_token=?, token_expires=?, magic_token=NULL, magic_expires=NULL
        WHERE id=?
      `).bind(sessionToken, sessionExpires, trainer.id).run();

      // Redirect to app with session token
      return Response.redirect(`${url.origin}/app?session=${sessionToken}`, 302);
    }

    // POST /auth/logout
    if (path === '/auth/logout' && method === 'POST') {
      const trainer = await verifyTrainer(request, db);
      if (trainer) {
        await db.prepare('UPDATE trainers SET session_token=NULL, token_expires=NULL WHERE id=?')
          .bind(trainer.id).run();
      }
      return json({ success: true });
    }

    // GET /auth/me — get current trainer
    if (path === '/auth/me' && method === 'GET') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const { session_token, magic_token, ...safe } = trainer;
      return json(safe);
    }

    // ── TRAINER BRAND SETTINGS ───────────────────────────────────────────────

    // PUT /trainer/brand — update brand settings
    if (path === '/trainer/brand' && method === 'PUT') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json();
      const { brand_name, brand_tagline, brand_color, brand_secondary, brand_logo_url, brand_font } = body;
      await db.prepare(`
        UPDATE trainers SET
          brand_name=COALESCE(?,brand_name),
          brand_tagline=COALESCE(?,brand_tagline),
          brand_color=COALESCE(?,brand_color),
          brand_secondary=COALESCE(?,brand_secondary),
          brand_logo_url=COALESCE(?,brand_logo_url),
          brand_font=COALESCE(?,brand_font)
        WHERE id=?
      `).bind(brand_name||null, brand_tagline||null, brand_color||null,
        brand_secondary||null, brand_logo_url||null, brand_font||null, trainer.id).run();
      return json({ success: true });
    }

    // ── CLIENT ROUTES ────────────────────────────────────────────────────────

    // GET /clients — list all clients
    if (path === '/clients' && method === 'GET') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const clients = await db.prepare(
        'SELECT * FROM clients WHERE trainer_id=? ORDER BY created_at DESC'
      ).bind(trainer.id).all();
      return json(clients.results || []);
    }

    // POST /clients — create client
    if (path === '/clients' && method === 'POST') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json();
      const {
        name, email, phone, goal, start_date, notes,
        dob, gender, height, weight, conditions, glp1, is_ghost
      } = body;
      if (!name) return json({ error: 'Name required' }, 400);
      const id = genToken(16);
      await db.prepare(`
        INSERT INTO clients (
          id, trainer_id, name, email, phone, goal, start_date, notes,
          dob, gender, height, weight, conditions, glp1, is_ghost,
          status, created_at, check_in_streak
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id, trainer.id, name, email||null, phone||null, goal||null,
        start_date||null, notes||null, dob||null, gender||null,
        height||null, weight||null, conditions||null,
        glp1?1:0, is_ghost?1:0, 'active', Date.now(), 0
      ).run();
      const client = await db.prepare('SELECT * FROM clients WHERE id=?').bind(id).first();
      return json(client, 201);
    }

    // GET /clients/:id — get single client
    if (path.match(/^\/clients\/[^/]+$/) && method === 'GET') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[2];
      const client = await db.prepare(
        'SELECT * FROM clients WHERE id=? AND trainer_id=?'
      ).bind(id, trainer.id).first();
      if (!client) return json({ error: 'Not found' }, 404);
      return json(client);
    }

    // PUT /clients/:id — update client
    if (path.match(/^\/clients\/[^/]+$/) && method === 'PUT') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[2];
      const client = await db.prepare(
        'SELECT * FROM clients WHERE id=? AND trainer_id=?'
      ).bind(id, trainer.id).first();
      if (!client) return json({ error: 'Not found' }, 404);
      const body = await request.json();
      const fields = ['name','email','phone','goal','start_date','notes',
        'dob','gender','height','weight','conditions','glp1','status',
        'emergency_contact','emergency_phone','medical_notes','photo_url'];
      const updates = [];
      const values = [];
      for (const f of fields) {
        if (body[f] !== undefined) { updates.push(`${f}=?`); values.push(body[f]); }
      }
      if (!updates.length) return json({ error: 'Nothing to update' }, 400);
      values.push(id, trainer.id);
      await db.prepare(
        `UPDATE clients SET ${updates.join(',')} WHERE id=? AND trainer_id=?`
      ).bind(...values).run();
      const updated = await db.prepare('SELECT * FROM clients WHERE id=?').bind(id).first();
      return json(updated);
    }

    // DELETE /clients/:id — delete client with confirmation
    if (path.match(/^\/clients\/[^/]+$/) && method === 'DELETE') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[2];
      const client = await db.prepare(
        'SELECT * FROM clients WHERE id=? AND trainer_id=?'
      ).bind(id, trainer.id).first();
      if (!client) return json({ error: 'Not found' }, 404);
      // Get counts for warning
      const sessions = await db.prepare(
        'SELECT COUNT(*) as n FROM sessions WHERE client_id=?'
      ).bind(id).first();
      const checkins = await db.prepare(
        'SELECT COUNT(*) as n FROM checkins WHERE client_id=?'
      ).bind(id).first();
      const confirm = url.searchParams.get('confirm');
      if (confirm !== 'DELETE') {
        return json({
          warning: true,
          message: `You are about to permanently delete ${client.name} and all their data.`,
          sessions: sessions?.n || 0,
          checkins: checkins?.n || 0,
          instructions: 'Add ?confirm=DELETE to the request to confirm deletion.'
        });
      }
      await db.prepare('DELETE FROM sessions WHERE client_id=?').bind(id).run();
      await db.prepare('DELETE FROM checkins WHERE client_id=?').bind(id).run();
      await db.prepare('DELETE FROM clients WHERE id=? AND trainer_id=?').bind(id, trainer.id).run();
      return json({ success: true, deleted: client.name });
    }

    // ── SESSION / SCHEDULING ROUTES ──────────────────────────────────────────

    // GET /sessions — list sessions (optionally filter by client_id or date range)
    if (path === '/sessions' && method === 'GET') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const clientId = url.searchParams.get('client_id');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = 'SELECT s.*, c.name as client_name FROM sessions s JOIN clients c ON s.client_id=c.id WHERE c.trainer_id=?';
      const params = [trainer.id];
      if (clientId) { query += ' AND s.client_id=?'; params.push(clientId); }
      if (from) { query += ' AND s.session_date >= ?'; params.push(from); }
      if (to) { query += ' AND s.session_date <= ?'; params.push(to); }
      query += ' ORDER BY s.session_date ASC, s.session_time ASC';
      const sessions = await db.prepare(query).bind(...params).all();
      return json(sessions.results || []);
    }

    // POST /sessions — create session
    if (path === '/sessions' && method === 'POST') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json();
      const { client_id, session_date, session_time, duration_min, type, notes, recurring, recurring_freq } = body;
      if (!client_id || !session_date) return json({ error: 'client_id and session_date required' }, 400);
      const client = await db.prepare(
        'SELECT * FROM clients WHERE id=? AND trainer_id=?'
      ).bind(client_id, trainer.id).first();
      if (!client) return json({ error: 'Client not found' }, 404);
      const id = genToken(16);
      await db.prepare(`
        INSERT INTO sessions (id, client_id, trainer_id, session_date, session_time,
          duration_min, type, notes, status, recurring, recurring_freq, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(id, client_id, trainer.id, session_date, session_time||'09:00',
        duration_min||60, type||'training', notes||null, 'scheduled',
        recurring?1:0, recurring_freq||null, Date.now()).run();
      return json({ success: true, id }, 201);
    }

    // PUT /sessions/:id — update session
    if (path.match(/^\/sessions\/[^/]+$/) && method === 'PUT') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[2];
      const body = await request.json();
      const fields = ['session_date','session_time','duration_min','type','notes','status'];
      const updates = [];
      const values = [];
      for (const f of fields) {
        if (body[f] !== undefined) { updates.push(`${f}=?`); values.push(body[f]); }
      }
      if (!updates.length) return json({ error: 'Nothing to update' }, 400);
      values.push(id, trainer.id);
      await db.prepare(
        `UPDATE sessions SET ${updates.join(',')} WHERE id=? AND trainer_id=?`
      ).bind(...values).run();
      return json({ success: true });
    }

    // DELETE /sessions/:id
    if (path.match(/^\/sessions\/[^/]+$/) && method === 'DELETE') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[2];
      const session = await db.prepare(
        'SELECT * FROM sessions WHERE id=? AND trainer_id=?'
      ).bind(id, trainer.id).first();
      if (!session) return json({ error: 'Not found' }, 404);
      await db.prepare('DELETE FROM sessions WHERE id=?').bind(id).run();
      return json({ success: true });
    }

    // ── CHECK-IN ROUTES ──────────────────────────────────────────────────────

    // GET /checkins — list check-ins
    if (path === '/checkins' && method === 'GET') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const clientId = url.searchParams.get('client_id');
      let query = 'SELECT ci.*, c.name as client_name FROM checkins ci JOIN clients c ON ci.client_id=c.id WHERE c.trainer_id=?';
      const params = [trainer.id];
      if (clientId) { query += ' AND ci.client_id=?'; params.push(clientId); }
      query += ' ORDER BY ci.created_at DESC LIMIT 50';
      const checkins = await db.prepare(query).bind(...params).all();
      return json(checkins.results || []);
    }

    // POST /checkins
    if (path === '/checkins' && method === 'POST') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json();
      const { client_id, weight, energy, sleep, nutrition_compliance, notes, mood } = body;
      if (!client_id) return json({ error: 'client_id required' }, 400);
      const id = genToken(16);
      await db.prepare(`
        INSERT INTO checkins (id, client_id, trainer_id, weight, energy, sleep,
          nutrition_compliance, mood, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).bind(id, client_id, trainer.id, weight||null, energy||null, sleep||null,
        nutrition_compliance||null, mood||null, notes||null, Date.now()).run();
      // Update streak
      await db.prepare(
        'UPDATE clients SET check_in_streak=check_in_streak+1, last_checkin=? WHERE id=?'
      ).bind(Date.now(), client_id).run();
      return json({ success: true, id }, 201);
    }

    // ── DASHBOARD STATS ──────────────────────────────────────────────────────

    if (path === '/dashboard' && method === 'GET') {
      const trainer = await verifyTrainer(request, db);
      if (!trainer) return json({ error: 'Unauthorized' }, 401);
      const total = await db.prepare(
        'SELECT COUNT(*) as n FROM clients WHERE trainer_id=? AND is_ghost=0'
      ).bind(trainer.id).first();
      const active = await db.prepare(
        'SELECT COUNT(*) as n FROM clients WHERE trainer_id=? AND status=? AND is_ghost=0'
      ).bind(trainer.id, 'active').first();
      const today = new Date().toISOString().split('T')[0];
      const todaySessions = await db.prepare(
        'SELECT COUNT(*) as n FROM sessions WHERE trainer_id=? AND session_date=?'
      ).bind(trainer.id, today).first();
      const upcoming = await db.prepare(`
        SELECT s.*, c.name as client_name, c.photo_url
        FROM sessions s JOIN clients c ON s.client_id=c.id
        WHERE c.trainer_id=? AND s.session_date >= ? AND s.status='scheduled'
        ORDER BY s.session_date ASC, s.session_time ASC LIMIT 5
      `).bind(trainer.id, today).all();
      const needsAttention = await db.prepare(`
        SELECT * FROM clients WHERE trainer_id=? AND status='active'
        AND is_ghost=0
        AND (last_checkin IS NULL OR last_checkin < ?)
        ORDER BY last_checkin ASC LIMIT 5
      `).bind(trainer.id, Date.now() - (7*24*60*60*1000)).all();
      return json({
        total_clients: total?.n || 0,
        active_clients: active?.n || 0,
        sessions_today: todaySessions?.n || 0,
        upcoming_sessions: upcoming.results || [],
        needs_attention: needsAttention.results || [],
        trial_end: trainer.trial_end,
        trial_days_left: Math.max(0, Math.ceil((trainer.trial_end - Date.now()) / (24*60*60*1000))),
      });
    }

    return json({ error: 'Not found' }, 404);
  }
};
