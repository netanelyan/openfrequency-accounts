// pm2: the of-accounts job.
//
//   cd /opt/openfrequency-accounts && npm ci --omit=dev && npm run init-private
//   pm2 start ecosystem.config.cjs && pm2 save
//
// Keys go in $OF_HOME/.env (./private/.env), mode 600. Nothing secret goes here.

module.exports = {
  apps: [
    {
      name: 'of-accounts',
      script: 'scripts/web.js',
      cwd: __dirname,
      // One process: sessions, tokens and the rate limits live in one place.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '200M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
