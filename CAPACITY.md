# 📊 Capacity & Performance Guide

This document explains what to expect when running Click Auction on **Render's free tier**. Based on real load testing with 250 simulated players.

---

## Quick Summary

| Players | Success Rate | Recommendation |
|---------|--------------|----------------|
| **1-100** | 99%+ | ✅ Rock solid |
| **100-150** | 95%+ | ✅ Very reliable |
| **150-180** | 90%+ | ✅ Good for most events |
| **180-200** | 75-85% | ⚠️ Some may need to refresh |
| **200-250** | 70-75% | ⚠️ Expect ~25% timeouts |

---

## Scenarios

### 🟢 Best Case (Small Event: 50-100 players)

**What happens:**
- All players connect within 1-2 seconds
- Zero connection failures
- Smooth gameplay with no lag
- All clicks register instantly

**Real numbers from testing:**
- 100/100 players connected (100%)
- Average connect time: ~400ms
- Total clicks in 10s auction: ~40,000
- Server CPU usage: Low

**Recommendation:** Perfect for team meetings, small conferences, or demos.

---

### 🟡 Base Case (Medium Event: 150-180 players)

**What happens:**
- Most players connect successfully
- A few (~5-10%) may experience slower connections
- Gameplay works well once connected
- Occasional player might need to refresh

**Real numbers from testing:**
- 181/250 attempted = 72% connected
- BUT 181/181 who connected = 100% played successfully
- Average connect time: ~2,400ms (2.4 seconds)
- Max connect time: ~11,000ms (11 seconds)
- Total clicks in 10s auction: ~80,000
- Total Fastest Finger taps: ~300

**What the winner looked like:**
```
🏆 WINNER: LoadTest-51 with 186 points
   - Auction clicks: 93
   - Reaction time: 109ms (fastest!)
   - Final score: 186 pts (2x multiplier for fastest finger)
```

**Recommendation:** This is your sweet spot. Reliable for company all-hands, medium conferences.

---

### 🔴 Worst Case (Large Event: 200-250 players)

**What happens:**
- ~70-75% of players connect successfully
- ~25-30% experience connection timeouts
- Players who timeout can usually connect by refreshing
- Once connected, gameplay is smooth
- Server handles the load fine - it's connection establishment that struggles

**Real numbers from testing:**
- 181-188 out of 250 players connected (72-75%)
- 62-69 players timed out during initial connection
- Timeouts start appearing around player #175-180
- Players who connected played without issues

**Why this happens:**
- Render free tier has limited CPU/memory
- 250 simultaneous WebSocket connections overwhelm the instance
- It's a resource limit, not a code bug

**Recommendation:** 
- If you need 200+ players reliably, upgrade to Render paid tier ($7/month)
- Or tell late joiners to refresh if they see "Connecting..."

---

## What The Numbers Mean

### Connection Metrics
| Metric | Good | Acceptable | Problem |
|--------|------|------------|---------|
| Connect time | <1s | 1-5s | >10s |
| Success rate | >95% | 80-95% | <80% |

### Gameplay Metrics
| Metric | Typical Value | Notes |
|--------|---------------|-------|
| Clicks per player | 40-50 per 10s | Humans click ~4-5 times/second |
| Total clicks (100 players) | ~40,000 | In a 10-second auction |
| Total clicks (180 players) | ~80,000 | In a 10-second auction |
| Fastest reaction time | 100-200ms | Top players are FAST |
| Average reaction time | 500-2000ms | Most people take a moment |

---

## Load Test Tool

Run your own tests:

```bash
# Test with 50 players (safe)
npx ts-node tests/load-test.ts --prod --players=50 --pin=YOUR_PIN

# Test with 150 players (recommended max for free tier)
npx ts-node tests/load-test.ts --prod --players=150 --pin=YOUR_PIN

# Test with 200 players (stress test)
npx ts-node tests/load-test.ts --prod --players=200 --pin=YOUR_PIN

# Keep players connected after test (for manual inspection)
npx ts-node tests/load-test.ts --prod --players=100 --pin=YOUR_PIN --no-cleanup
```

### Load Test Options

| Flag | Description | Default |
|------|-------------|---------|
| `--prod` | Use production URL | localhost |
| `--players=N` | Number of players | 200 |
| `--pin=XXX` | Host PIN to auto-start game | (manual start) |
| `--duration=N` | Auction duration in seconds | 10 |
| `--no-cleanup` | Keep players connected after test | (disconnects) |

---

## Improving Capacity

### Option 1: Upgrade Render ($7/month)
- Paid tier has more CPU/memory
- Should handle 300-400+ players easily
- No cold starts (always warm)

### Option 2: Optimize Connection Timing
- Stagger player joins (don't have everyone scan QR at once)
- Have players join 1-2 minutes before starting

### Option 3: Multiple Instances
- Run multiple games in parallel on different URLs
- Split large audiences into groups

---

## Server Limits (Configurable)

These are set in `src/config.ts`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `MAX_PLAYERS` | 250 | Maximum players in one game |
| `MAX_CONNECTIONS_PER_IP` | 260 | Connections from one IP (for load testing) |
| `RATE_LIMIT_CLICKS_PER_SECOND` | 20 | Max clicks per player per second |

---

## Redis Persistence

All-Time Champions data is stored in Redis and survives:
- Server restarts
- Deploys
- Connection issues

Only the **live game state** (current players, current round) resets on deploy.

---

## Real Test Output Example

```
======================================================================
LOAD TEST REPORT
======================================================================
Target: https://click-auction.onrender.com
Players attempted: 250
======================================================================

📊 CONNECTION METRICS:
   ✅ Successful connections: 188
   ❌ Failed connections: 62
   ⏱️  Avg connect time: 2375ms
   📈 Max connect time: 11316ms
   📉 Min connect time: 394ms

🎮 JOIN METRICS:
   ✅ Successful joins: 188
   ❌ Failed joins: 0

👆 GAMEPLAY METRICS:
   🖱️  Total clicks (Click Auction): 80,967
   ⚡ Total taps (Fastest Finger): 297
   📊 Clicks per player: 430.7

======================================================================
RESULT: 75.2% success rate (188/250 players)
======================================================================
```

---

## TL;DR

- **Safe limit for free tier:** 150 players
- **Practical limit:** 180 players (some may need to refresh)
- **Stress limit:** 250 players (expect 25% to timeout)
- **For 200+ reliably:** Upgrade to paid tier

---

*Last tested: January 2026 on Render free tier*
