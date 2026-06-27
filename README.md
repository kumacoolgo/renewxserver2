# renewxserver2

Telegram bot for XServer free VPS multi-account monitoring and automatic renewal.

This version uses [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) instead of stock Playwright. Each XServer account gets its own persistent browser profile under `/data/profiles`, so cookies and browser identity can be reused across checks.

## Features

- Telegram bot account management
- Multiple XServer accounts
- Automatic XServer login and free VPS expiry detection
- Automatic renewal when the remaining days are less than or equal to `RENEWAL_THRESHOLD_DAYS`
- Japan-time scheduler: starts at 02:00, then runs every 4 hours
- Telegram notification when automatic detection or renewal fails
- Docker image ready for Zeabur deployment

## Telegram Commands

| Command | Description |
| --- | --- |
| `/start` | Show menu |
| `/add` | Add or update an XServer account |
| `/list` | List saved accounts |
| `/check` | Check all accounts and renew when needed |
| `/checkonly` | Check all accounts without renewal |
| `/renew <id>` | Check and renew one account |
| `/delete <id>` | Delete an account |
| `/help` | Show help |

## Schedule

Automatic jobs run in Japan time at:

`02:00`, `06:00`, `10:00`, `14:00`, `18:00`, `22:00`

For every account, the job checks the free VPS expiry date. If renewal is needed, it renews first and then rechecks the expiry date. If renewal or detection fails, the Telegram admin receives a message.

## Zeabur Deployment

1. Push this repository to GitHub.
2. Create a Zeabur service from the GitHub repo.
3. Use Dockerfile deployment.
4. Add a persistent volume mounted at `/data`.
5. Add environment variables:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ADMIN_TELEGRAM_ID=your_numeric_telegram_user_id
DB_PATH=/data/accounts.db
DATA_DIR=/data
PROFILE_DIR=/data/profiles
CLOAKBROWSER_CACHE_DIR=/data/.cloakbrowser
BROWSER_HEADLESS=false
BROWSER_TIMEZONE=Asia/Tokyo
BROWSER_LOCALE=ja-JP
RENEWAL_THRESHOLD_DAYS=1
RUN_ON_START=false
```

Recommended for Zeabur or other datacenter hosting:

```env
CLOAKBROWSER_PROXY=http://user:pass@residential-proxy-host:port
BROWSER_GEOIP=true
```

`CLOAKBROWSER_PROXY` also accepts `socks5://user:pass@host:port`. Cloudflare may give datacenter IPs a stricter Turnstile challenge or no token at all. CloakBrowser improves the browser fingerprint and interaction environment, but it is not a CAPTCHA-solving service or an IP reputation replacement. The XServer image CAPTCHA is still handled separately with the TFJS model from the original userscript flow.

Optional CloakBrowser Pro:

```env
CLOAKBROWSER_LICENSE_KEY=cb_xxxxxxxx
```

The Docker image runs CloakBrowser in headed mode through Xvfb because Cloudflare Turnstile is much less reliable in pure headless mode. The first run downloads the CloakBrowser Chromium binary into `CLOAKBROWSER_CACHE_DIR`. Keeping `/data` mounted avoids downloading it again after every redeploy.

## Local Development

```bash
npm install
npm run check
npm start
```

On Windows with very new Node versions, `sqlite3` may require Visual Studio C++ Build Tools. Zeabur builds inside Linux with the Dockerfile, which installs the required build tools.

## Notes

- Credentials are stored in SQLite at `/data/accounts.db`; keep the Zeabur volume private.
- If XServer changes its UI selectors or adds a new challenge flow, the bot sends a Telegram failure notification with the reason.
- The CAPTCHA recognizer follows the original Tampermonkey flow and loads the model from `CAPTCHA_MODEL_URL`.
