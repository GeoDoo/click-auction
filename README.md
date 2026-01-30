# 🎯 Click Auction - Programmatic Bidding Game

A real-time multiplayer auction game where audience members compete as DSPs (Demand-Side Platforms) to win the bid by clicking as fast as possible!

**Live Demo:** https://click-auction.onrender.com

## 🎮 How It Works

1. **Players join** as "DSPs" via their phones by scanning a QR code
2. **Host starts** an auction round with a configurable timer (5-60 seconds)
3. **Click Auction** - Players tap furiously to place bids (each tap = 1 bid)
4. **Fastest Finger** - React quickly when the signal appears! Top 3 get score multipliers:
   - 🥇 1st: 2x multiplier
   - 🥈 2nd: 1.5x multiplier
   - 🥉 3rd: 1.25x multiplier
5. **Winner's ad** is dynamically generated and displayed on the big screen!

Perfect for conferences, events, and any gathering where you want to gamify programmatic advertising concepts.

## 📋 Game Rules

- ⏱️ **Limited time** to bid when the auction starts (host sets duration)
- 👆 Each tap on the BID button = **1 bid**
- 🏆 **Most bids wins!** Winner's custom ad displays on screen
- 🎯 It's like a real-time **programmatic auction** - you're the DSP!

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Build and start (same for dev and production)
npm run build
npm start
```

Open your browser:
- **Main Display (QR + Leaderboard):** http://localhost:3000
- **Player View:** http://localhost:3000/play
- **Host Control:** http://localhost:3000/host

### Cloud Deployment (Render)

1. Push to GitHub
2. Connect to [Render](https://render.com)
3. Deploy as Web Service
4. (Optional) Add Redis for persistent scores

## 📱 Pages

### `/` - Main Display (Big Screen)
Project this for everyone to see:
- Large QR code for easy scanning
- Game rules and instructions  
- All-Time Champions leaderboard
- Live Bids leaderboard with click animations
- Podium for top 3 players
- Dynamic winner ad on a CSS billboard with confetti! 🎊

### `/play` - Player Page
Share this URL with your audience. Players:
- Enter their DSP name
- Add a custom "winning ad" message
- Tap the BIG button during the auction!

### `/host` - Host Control Panel
For the event organizer:
- Set auction duration (5-60 seconds)
- Start/reset auctions
- Reset all-time stats

## 🎯 Game Flow

1. **Waiting** - Players join, host prepares
2. **Countdown** - 3, 2, 1... builds anticipation!
3. **Click Auction** - TAP! TAP! TAP! (10 seconds default)
4. **Fastest Finger Countdown** - Get ready...
5. **Fastest Finger** - React! First tap wins multipliers!
6. **Winner** - Celebration with confetti and dynamically generated ad

## 🔊 Sound Effects

The game includes immersive audio feedback (works on all devices!):

| Event | Sound |
|-------|-------|
| **Countdown** | Tick beep |
| **GO!** | Rising tone |
| **Each tap** | Click sound |
| **Winner** | Fanfare arpeggio |
| **Not winner** | Low tone |

- 🔊 **Mute button** available in player UI
- Works with Web Audio API (no files to load, synthesized sounds)

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Auto | Set by hosting platform |
| `HOST_PIN` | Optional | PIN to protect `/host` route (e.g., `mySecretPin123`) |
| `UPSTASH_REDIS_REST_URL` | Optional | Redis URL for persistent scores |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Redis token for authentication |

### Setting up Persistence (Optional)

1. Create free account at [Upstash](https://upstash.com)
2. Create a Redis database
3. Add environment variables to Render:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

Without Redis, scores persist locally but reset on redeploy.

## 📊 Capacity & Performance

Running on **Render free tier**? See the [Capacity Guide](CAPACITY.md) for:
- Player limits and real load test results
- Performance optimizations applied
- How to run your own load tests

**Quick reference:**
| Players | Reliability |
|---------|-------------|
| 1-150 | ✅ 100% success |
| 150-200 | ✅ 100% success |
| 200-250 | ✅ 100% success (tested) |
| 250+ | ⚠️ Approaching limits |

**Tested January 2026:** 250 concurrent players at 100% success rate on free tier after optimizations.

## 🛡️ Security & Protections

The game includes enterprise-grade security:

| Protection | Description |
|------------|-------------|
| **Helmet.js** | Security headers (XSS, clickjacking, MIME sniffing) |
| **Input Validation** | Player names and ad content sanitized/truncated |
| **Rate Limiting** | Max 20 clicks/second per player |
| **Connection Limiting** | Max connections per IP (default 260, configurable) |
| **Bot Detection** | Statistical analysis of click timing |
| **Compression** | Gzip for faster responses |
| **Trust Proxy** | Correct IP detection behind Render/proxies |
| **Global Error Handling** | Uncaught exceptions won't crash server |
| **Graceful Shutdown** | Saves data on SIGTERM/SIGINT |
| **Session Management** | 30-second reconnect grace period |

### 🤖 Bot Detection

The game analyzes click timing to detect automated/scripted clicking:
- Measures **Coefficient of Variation (CV)** of click intervals
- Human clicks: naturally vary in timing (high CV)
- Bot clicks: unnaturally consistent timing (low CV < 15%)
- Detection runs server-side for fair play enforcement

### ♻️ Reconnection Support

Players can seamlessly rejoin if their connection drops:
- **30-second grace period** to reconnect
- **Click progress preserved** during disconnection
- **Session tokens** stored in localStorage
- Automatic reconnection with Socket.io
- Visual feedback ("Reconnecting..." / "Reconnected!")

### 🔐 Host PIN Protection

Optionally protect the `/host` control panel:
- Set `HOST_PIN` environment variable to enable
- Users must enter PIN to access host controls
- Auth tokens valid for 24 hours (stored in cookie)
- If no PIN set, `/host` is open (backwards compatible)

## 🛠 Tech Stack

- **Language:** TypeScript (server + client)
- **Backend:** Node.js + Express
- **Real-time:** Socket.io
- **Build:** Vite (client bundling)
- **Persistence:** Upstash Redis (optional) / Local JSON file
- **Frontend:** Vanilla HTML/CSS/TypeScript
- **Audio:** Web Audio API (synthesized sounds, no files)
- **Testing:** Jest (171 tests)
- **Hosting:** Render (or any Node.js host)

## 🧪 Testing

The project includes a comprehensive test suite with **171 tests**:

```bash
# Run tests
npm test

# Run linter
npm run lint
```

### Deployment Pipeline

Tests run automatically during Render's build step. **If tests fail, deployment is blocked.**

### Test Coverage

| Area | Tests |
|------|-------|
| Connection & Players | Join, disconnect, reconnect flows |
| Auction Flow | Start, countdown, bidding, end |
| Leaderboards | Live rankings, all-time stats |
| Session Management | Tokens, reconnection, expiry |
| Input Validation | Sanitization, duration limits |
| Rate Limiting | Click throttling per player |
| Bot Detection | CV calculation, flagging |
| Security | Helmet headers, connection limits |
| HTTP Endpoints | /health, /api/config, /api/stats |
| Middleware | Cache control, request logging, error handling |
| Logger | Log levels, formatting, specialized methods |

## 💡 Tips for Running Events

1. **Project `/`** on a big screen - shows QR code, rules, and live leaderboard
2. **Open `/host`** on your laptop/phone to control the auction
3. Test with a few people before the main event
4. Use fullscreen mode (F11) for the best experience

## 🎨 Customization

The game uses CSS variables for easy theming:
- Primary: `#00C9A7` (Teal)
- Secondary: `#845EC2` (Purple)  
- Accent: `#F15BB5` (Pink)

Customize colors in any HTML file's `:root` CSS variables.

## 🏆 Prize Ideas

- DOOH swag
- Gift cards
- Bragging rights
- A real programmatic campaign credit!

## 📁 Project Structure

```
click-auction/
├── src/                    # Server-side TypeScript
│   ├── server.ts           # Entry point
│   ├── app.ts              # Express setup & middleware
│   ├── routes.ts           # HTTP routes
│   ├── socket.ts           # Socket.io handlers
│   ├── game.ts             # Game state & logic
│   ├── types.ts            # TypeScript interfaces
│   ├── config.ts           # Configuration constants
│   ├── validation.ts       # Input validation & rate limiting
│   ├── session.ts          # Session management (reconnection)
│   ├── auth.ts             # Host PIN authentication
│   ├── botDetection.ts     # Bot detection (CV analysis)
│   ├── persistence.ts      # Redis/file score persistence
│   ├── middleware.ts       # Express middleware
│   └── logger.ts           # Server-side logging
├── client/                 # Client-side TypeScript
│   ├── display.ts          # Main display page logic
│   ├── play.ts             # Player page logic
│   ├── host.ts             # Host control logic
│   ├── host-login.ts       # Login page logic
│   ├── sound.ts            # Web Audio sound effects
│   ├── logger.ts           # Client-side logging
│   └── utils.ts            # Shared utilities
├── public/                 # Static files
│   ├── display.html        # Main display (QR, rules, leaderboards)
│   ├── play.html           # Player bidding interface
│   ├── host.html           # Host control panel
│   ├── host-login.html     # PIN login page
│   ├── css/                # Extracted stylesheets
│   └── js/                 # Vite-compiled client bundles
├── tests/                  # Test suites
│   ├── server.test.ts      # Server tests (125 tests)
│   ├── middleware.test.ts  # Middleware tests (17 tests)
│   └── logger.test.ts      # Logger tests (17 tests)
├── dist/                   # Compiled server (gitignored)
├── package.json
├── tsconfig.json           # Server TypeScript config
├── vite.config.ts          # Client build config
├── jest.config.js          # Test configuration
├── eslint.config.js        # Linter configuration
├── render.yaml             # Render deployment config
└── scores.json             # Local persistence (auto-created)
```

## 📜 NPM Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Run production server (requires build first) |
| `npm run build` | Build client (Vite) + server (tsc) |
| `npm test` | Run all tests |
| `npm run lint` | Run ESLint |

---

*May the fastest fingers win!* 👆💨
