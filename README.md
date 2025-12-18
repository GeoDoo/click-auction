# 🎯 Click Auction - Programmatic Bidding Game

A real-time multiplayer auction game where audience members compete as DSPs (Demand-Side Platforms) to win the bid by clicking as fast as possible!

**Live Demo:** https://click-auction.onrender.com

## 🎮 How It Works

1. **Players join** as "DSPs" via their phones by scanning a QR code
2. **Host starts** an auction round with a configurable timer (5-60 seconds)
3. **Players tap** furiously to place bids (each tap = 1 bid)
4. **Winner's ad** is dynamically generated and displayed on the big screen!

Perfect for conferences, events, and any gathering where you want to gamify programmatic advertising concepts.

## 📋 Game Rules

- ⏱️ **Limited time** to bid when the auction starts (host sets duration)
- 👆 Each tap on the BID button = **1 bid**
- 🏆 **Most bids wins!** Winner's custom ad displays on screen
- 🎯 It's like a real-time **programmatic auction** - you're the DSP!

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start the server
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
- Live countdown timer
- Real-time leaderboard with click animations
- Podium for top 3 players
- Dynamic winner ad on a billboard with confetti! 🎊
- All-time champions section

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
3. **Bidding** - TAP! TAP! TAP!
4. **Winner** - Celebration with dynamically generated ad

## 🔊 Sound & Haptic Feedback

The game includes immersive audio and vibration feedback (works on mobile!):

| Event | Sound | Haptic |
|-------|-------|--------|
| **Countdown** | Tick beep | Short buzz |
| **GO!** | Rising tone | Double buzz |
| **Each tap** | Click sound | Quick buzz |
| **Winner** | Fanfare arpeggio | Celebration pattern |
| **Not winner** | Low tone | Single buzz |

- 🔊 **Mute button** available in player UI
- 📳 **Haptic feedback** on Android & iOS (if supported)
- Works with Web Audio API (no files to load)

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

## 🛡️ Security & Protections

The game includes enterprise-grade security:

| Protection | Description |
|------------|-------------|
| **Helmet.js** | Security headers (XSS, clickjacking, MIME sniffing) |
| **Input Validation** | Player names and ad content sanitized/truncated |
| **Rate Limiting** | Max 20 clicks/second per player |
| **Connection Limiting** | Max 10 connections per IP (DoS protection) |
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
- Suspicious players are flagged with 🤖 in the host panel

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

- **Backend:** Node.js + Express
- **Real-time:** Socket.io
- **Persistence:** Upstash Redis (optional) / Local JSON file
- **Frontend:** Vanilla HTML/CSS/JS
- **Audio:** Web Audio API (synthesized sounds, no files)
- **Hosting:** Render (or any Node.js host)

## 💡 Tips for Running Events

1. **Project `/`** on a big screen - shows QR code, rules, and live leaderboard
2. **Open `/host`** on your laptop/phone to control the auction
3. Test with a few people before the main event
4. Use fullscreen mode (F11) for the best experience

## 🎨 Branding

The game features **VIOOH's brand colors**:
- Primary: `#00C9A7` (Teal)
- Secondary: `#845EC2` (Purple)  
- Accent: `#F15BB5` (Pink)

Customize in any HTML file's `:root` CSS variables.

## 🏆 Prize Ideas

- DOOH swag
- Gift cards
- Bragging rights
- A real programmatic campaign credit!

## 📁 Project Structure

```
click-auction/
├── server.js           # Main server with Socket.io
├── package.json
├── render.yaml         # Render deployment config
├── public/
│   ├── display.html    # Main display (QR, rules, leaderboard, billboard)
│   ├── play.html       # Player bidding interface
│   ├── host.html       # Host control panel
│   ├── host-login.html # PIN login page for host
│   └── ad-generator.js # Dynamic ad image generator
└── scores.json         # Local persistence (auto-created)
```

## 🤝 Credits

Built for **VIOOH** - The world's leading premium digital out-of-home (DOOH) supply-side platform.

---

*May the fastest fingers win!* 👆💨
