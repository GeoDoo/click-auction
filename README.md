# 🎯 Click Auction - Programmatic Bidding Game

A real-time multiplayer auction game where audience members compete as DSPs (Demand-Side Platforms) to win the bid by clicking as fast as possible!

## 🎮 How It Works

1. **Players join** as "DSPs" via their phones/devices
2. **Host starts** an auction round with a timer
3. **Players click** furiously to place bids (each click = 1 bid)
4. **Winner's ad** is displayed on the big screen when time runs out!

Perfect for conferences, events, and any gathering where you want to gamify programmatic advertising concepts.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Then open your browser:
- **Landing Page:** http://localhost:3000
- **Player View:** http://localhost:3000/play
- **Host Control:** http://localhost:3000/host
- **Big Screen Display:** http://localhost:3000/display

## 📱 Pages

### `/play` - Player Page
Share this URL with your audience. Players:
- Enter their DSP name
- Optionally add a custom "winning ad" message
- Smash the BIG button during the auction!

### `/host` - Host Control Panel
For the event organizer:
- Set auction duration (5-60 seconds)
- Start/reset auctions
- View all connected players
- Kick troublemakers 😈

### `/display` - Big Screen
Project this on a screen for everyone to see:
- Live countdown timer
- Real-time leaderboard with click counts
- Epic winner announcement with confetti! 🎊

## 🎯 Game Flow

1. **Waiting** - Players join, host prepares
2. **Countdown** - 3, 2, 1... builds anticipation!
3. **Bidding** - CLICK! CLICK! CLICK!
4. **Winner** - Celebration screen with the winning DSP's ad

## 🏆 Prize Ideas

- DOOH swag
- Gift cards
- Bragging rights
- A real programmatic campaign credit! 

## 🛠 Tech Stack

- **Backend:** Node.js + Express
- **Real-time:** Socket.io
- **Frontend:** Vanilla HTML/CSS/JS (no framework needed!)

## 💡 Tips for Running

1. Use a **local network** - all devices should be on the same WiFi
2. Share the `/play` URL via QR code for easy joining
3. Test with a few people before the main event
4. Have the `/display` page on fullscreen (F11)

## 🎨 Customization

The game uses CSS variables for easy theming. Edit the `:root` section in any HTML file to change colors:

```css
:root {
  --primary: #00f5d4;   /* Cyan accent */
  --secondary: #7b2cbf; /* Purple */
  --accent: #f15bb5;    /* Pink */
  --success: #00ff88;   /* Green for clicks */
  --warning: #ffbe0b;   /* Yellow for alerts */
  --danger: #ff006e;    /* Red for urgency */
}
```

## 🤝 Credits

Built for **VIOOH** - The world's leading premium digital out-of-home (DOOH) supply-side platform.

---

*May the fastest fingers win!* 👆💨

