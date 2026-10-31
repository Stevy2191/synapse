// Maintenance commands, run inside the container by the `synapse` command on the server:
//   node src/cli.js reset-password <username or email>   prints a new temporary password
//   node src/cli.js make-admin <username or email>
//   node src/cli.js users                                lists accounts
import crypto from 'crypto';
import { db } from './db/index.js';
import { setPassword } from './users.js';

const [command, who] = process.argv.slice(2);

function findUser(name) {
  const user = name && db.prepare('SELECT id, username, email, role FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(name, name);
  if (!user) {
    console.error(name ? `No account called "${name}". Run "synapse users" to see them.` : 'Give a username or email.');
    process.exit(1);
  }
  return user;
}

function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  const s = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

switch (command) {
  case 'reset-password': {
    const user = findUser(who);
    const password = tempPassword();
    await setPassword(user.id, password);
    console.log(`New password for ${user.username}: ${password}`);
    console.log('They can change it in Settings → Account after signing in. Other sessions were signed out.');
    break;
  }
  case 'make-admin': {
    const user = findUser(who);
    db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
    console.log(`${user.username} is now an admin.`);
    break;
  }
  case 'users': {
    const users = db.prepare('SELECT username, email, role FROM users ORDER BY created_at').all();
    if (users.length === 0) console.log('No accounts yet. Open Synapse in a browser to create the admin account.');
    for (const u of users) console.log(`${u.role === 'admin' ? '★' : ' '} ${u.username.padEnd(20)} ${u.email}`);
    break;
  }
  default:
    console.error('Commands: reset-password <user>, make-admin <user>, users');
    process.exit(1);
}
