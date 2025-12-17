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
- **Landing Page (QR Code):** http://localhost:3000
- **Player View:** http://localhost:3000/play
- **Host Control:** http://localhost:3000/host
- **Big Screen Display:** http://localhost:3000/display

### Cloud Deployment (Render)

1. Push to GitHub
2. Connect to [Render](https://render.com)
3. Deploy as Web Service
4. (Optional) Add Redis for persistent scores

## 📱 Pages

### `/` - Landing Page
Display on a screen for players to join:
- Large QR code for easy scanning
- Game rules and instructions
- Clean, branded interface

### `/play` - Player Page
Share this URL with your audience. Players:
- Enter their DSP name
- Add a custom "winning ad" message
- Tap the BIG button during the auction!

### `/host` - Host Control Panel
For the event organizer:
- Set auction duration (5-60 seconds)
- Start/reset auctions
- View connected players with live click counts
- Kick troublemakers 😈
- QR code for easy sharing
- All-time stats leaderboard

### `/display` - Big Screen
Project this for everyone to see:
- Live countdown timer
- Real-time leaderboard with click animations
- Podium for top 3 players
- Dynamic winner ad generation with confetti! 🎊
- All-time champions section

## 🎯 Game Flow

1. **Waiting** - Players join, host prepares
2. **Countdown** - 3, 2, 1... builds anticipation!
3. **Bidding** - TAP! TAP! TAP!
4. **Winner** - Celebration with dynamically generated ad

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Auto | Set by hosting platform |
| `UPSTASH_REDIS_REST_URL` | Optional | Redis URL for persistent scores |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Redis token for authentication |

### Setting up Persistence (Optional)

1. Create free account at [Upstash](https://upstash.com)
2. Create a Redis database
3. Add environment variables to Render:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

Without Redis, scores persist locally but reset on redeploy.

## 🛠 Tech Stack

- **Backend:** Node.js + Express
- **Real-time:** Socket.io
- **Persistence:** Upstash Redis (optional) / Local JSON file
- **Frontend:** Vanilla HTML/CSS/JS
- **Hosting:** Render (or any Node.js host)

## 💡 Tips for Running Events

1. **Display the landing page** on a big screen for QR code scanning
2. **Open `/host`** on your laptop to control the game
3. **Project `/display`** on another screen for the leaderboard
4. Test with a few people before the main event
5. Use fullscreen mode (F11) for `/display`

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
│   ├── index.html      # Landing page with QR
│   ├── player.html     # Player bidding interface
│   ├── host.html       # Host control panel
│   ├── display.html    # Big screen display
│   └── ad-generator.js # Dynamic ad image generator
└── scores.json         # Local persistence (auto-created)
```

## 🤝 Credits

Built for **VIOOH** - The world's leading premium digital out-of-home (DOOH) supply-side platform.

---

*May the fastest fingers win!* 👆💨
