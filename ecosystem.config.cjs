// pm2: the of-accounts job.
//
//   cd /opt/openfrequency-accounts && npm ci --omit=dev && npm run init-private
//   pm2 start ecosystem.config.cjs && pm2 save
//
// Keys go in $OF_HOME/.env (./private/.env), mode 600. Nothing secret goes here.
//
// In release folders (deploy/deploy.sh, docs/deploy.md "Release folders, once") the job is started once with
// OF_APP_DIR=/opt/openfrequency-accounts/current and OF_HOME=/opt/openfrequency-accounts/private in the environment:
// its folder is then the `current` link, which each deploy points at a new release, and every release shares the one
// private folder. Without them it runs where this file is, as before.
//
// The same pm2 (pm2-root.service) runs other apps on the server: every command here names of-accounts, never pm2 as
// a whole (SERVER-FACTS.md).

const { existsSync } = require('node:fs');

// The server's Node 24 (/opt/node24/bin/node, SERVER-FACTS.md): /usr/bin/node there is v20, too old for node:sqlite.
const NODE24 = '/opt/node24/bin/node';

module.exports = {
  apps: [
    {
      name: 'of-accounts',
      script: 'scripts/web.js',
      cwd: process.env.OF_APP_DIR || __dirname,
      ...(existsSync(NODE24) ? { interpreter: NODE24 } : {}),
      // One process: sessions, tokens and the rate limits live in one place.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '200M',
      // A crash loop (a database it cannot open, a port taken) is retried with a growing wait, 1 second and up,
      // instead of pm2 giving up after its quick restarts (PRA-OPS-008).
      exp_backoff_restart_delay: 1000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        ...(process.env.OF_HOME ? { OF_HOME: process.env.OF_HOME } : {}),
      },
    },
  ],
};
