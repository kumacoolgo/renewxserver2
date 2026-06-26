# renewxserver2

Telegram bot for monitoring and renewing XServer VPS accounts.

## Features

- Add/remove XServer accounts via Telegram
- Automatic expiry detection
- Renewal reminder when ≤1 day remaining
- Manual renewal flow with step-by-step guidance

## Setup

### Zeabur Deployment

1. Fork/clone this repository to GitHub
2. On Zeabur:
   - Create a new service
   - Connect to GitHub and select this repo
   - Add environment variables:
     ```
     TELEGRAM_BOT_TOKEN=your_bot_token
     ADMIN_TELEGRAM_ID=your_numeric_user_id
     ```
   - Mount `/data` volume for SQLite database
   - Deploy

### Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your values
npm start
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message |
| `/add` | Add new XServer account |
| `/list` | List saved accounts |
| `/delete <id>` | Delete an account |
| `/check` | Check all accounts now |
| `/renew <id>` | Get renewal link for account |
| `/help` | Show help |

## How It Works

1. Add your XServer account via `/add`
2. Bot checks expiry automatically (or use `/check`)
3. When ≤1 day remaining, use `/renew <id>` to get the renewal link
4. Complete manual verification on XServer website
5. Click "I updated, recheck" button in bot

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Your Telegram bot token from @BotFather |
| `ADMIN_TELEGRAM_ID` | Yes | Your Telegram user ID (get via @userinfobot) |
| `DB_PATH` | No | Path to SQLite database (default: /data/accounts.db) |
