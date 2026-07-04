# Volmarket — Demo Video Script (≤ 5:00)

**Track:** Prediction Markets & Settlement · **Format:** screen recording + voiceover
**Golden rule:** the video is the heaviest-weighted criterion. Show the product working and the settlement proven on-chain. Cut anything that doesn't serve those two.

*VO is written to be read at ~150 wpm. Total ≈ 720 words ≈ 4:50. Record VO first, cut screen to match.*

---

## Beat 1 — Hook (0:00–0:20)

**On screen:** The live match board. A few World Cup matches, each with a moving signal sparkline. Cursor hovers one.

**VO:**
"Every prediction market asks the same question — who wins. But watch any live match and the odds are *moving* the whole time. That movement is the real signal, and nobody lets you trade it. Volmarket does."

---

## Beat 2 — What it is (0:20–0:45)

**On screen:** Slow scroll of the board. Tap the "How signals work" link — the two-sentence primer appears — then dismiss it.

**VO:**
"Volmarket turns every live odd into a chart. The line is the odds as a probability; the money stacks into a floor and a ceiling. You predict whether the line *holds* the floor or *breaks* the ceiling — within a window you choose. It's non-custodial, on Solana, and it settles from TxLINE's on-chain proofs. No house."

---

## Beat 3 — Core loop, the heart of the demo (0:45–2:15)

**On screen:** Open Portugal v Netherlands. The detail header: left clock, scoreline. Scroll to the signal panel — the cyan tape moving live, the support/resistance profile on the right, the LIVE / SUPPORT / RESISTANCE pills updating.

**VO:**
"Here's Netherlands to win. This tape is the live implied probability. Down here is support — where the money's defending — and up here, resistance."

**On screen:** Tap the **Window** row → pick **1m**. The two predict buttons update to "Holds 40%+ / Breaks 47%". Time axis at the bottom reads "-1m · -30s · now".

**VO:**
"I pick a window — one minute. Now I'm predicting: does the line hold forty percent, or break forty-seven, in the next sixty seconds?"

**On screen:** Tap **Holds 40%+**. A green dashed line snaps onto the chart at 40% labelled "◆ your call". The button fills green. Combo slip icon badges to 1.

**VO:**
"I take *holds*. Watch — my level is now drawn right on the chart, and I can see the live line ride above it."

**On screen:** Open the slip, set a small stake, tap **Place prediction**. Share code appears. Close slip; the dashed line persists on the chart as the tape moves.

**VO:**
"Placed. My prediction stays on the chart for the whole window."

**On screen:** The 1-minute window elapses (fast-forward the recording here). The **result pop-up** fires: big green **WON**, the prediction, the stake, the payout credited to balance.

**VO:**
"Window closes — and it settles. Won. Payout's back in my balance. That whole loop just ran non-custodially."

---

## Beat 4 — Depth: combine, groups, naira (2:15–2:55)

**On screen:** Quickly stack two signal predictions across different odds → the combo multiplier updates → copy the share code. Then the **Groups** browser: public groups with Members / Predictions / PnL / Win-rate, "Request to join". Then the deposit sheet showing **USDC and Naira**.

**VO:**
"Predictions combine into one shareable code — send it to a friend, they take the same position. Groups let communities predict together, with public track records. And funding works in USDC *or* Naira — because the next wave of users doesn't hold stablecoins yet. That's our wedge."

---

## Beat 5 — How it actually settles (2:55–4:05)

**On screen:** Cut to a simple architecture diagram (from the tech doc). Then a terminal: the **keeper** running, printing a TxLINE odds update, fetching the Merkle proof, submitting `resolve_market`. Then a **Solana explorer** tab showing the resolve transaction and the `validate` CPI.

**VO:**
"Under the hood: the level you predict is snapped from TxLINE's StablePrice — demargined, consensus odds, anchored on Solana. Our escrow holds the USDC in a program vault. When the window closes, anyone — here, our keeper — fetches the single odds update that decides it, and submits one Merkle proof. Our program verifies it against the on-chain root and pays out. One proof, fully trustless. Here's the resolve transaction on devnet, and the proof check inside it."

**On screen:** Highlight the confirmed tx.

**VO:**
"No operator decides the result. The chain does."

---

## Beat 6 — Why it's sound + close (4:05–4:50)

**On screen:** Back to the board, calm. Optional one-line captions appear as spoken: *Line settles, not volume · Level from anchored odds · Non-custodial.*

**VO:**
"One thing we designed for from the start: the internal volume you see only *informs* the picture — it never settles anything. The line does. So no whale can fake a level and print money. The signal is real; winning it isn't free.

Volmarket — trade the signal on every live odd, settled on-chain from TxLINE. Built on Solana, for the world's biggest month of football. Thanks for watching."

**On screen:** End card: logo, one-liner, repo + devnet links.

---

## Shot checklist (record these clips)

- [ ] Board with live sparklines (Beat 1, 2, 6)
- [ ] "How signals work" primer open/close (Beat 2)
- [ ] Signal panel: moving tape + profile + pills (Beat 3)
- [ ] Window select → buttons + time axis update (Beat 3)
- [ ] Tap Holds → dashed level line appears (Beat 3)
- [ ] Place → share code (Beat 3)
- [ ] **Result pop-up: WON** (Beat 3) ← the money shot
- [ ] Combo multiplier + copy code (Beat 4)
- [ ] Groups browser (Beat 4)
- [ ] Deposit sheet USDC/Naira (Beat 4)
- [ ] Architecture diagram (Beat 5)
- [ ] Keeper terminal: proof fetch + resolve (Beat 5)
- [ ] **Solana explorer: resolve tx + validate CPI** (Beat 5) ← the trust shot
- [ ] End card with links (Beat 6)

## Recording notes

- **Two shots win the judging:** the WON pop-up (product works) and the explorer tx (settlement is real). Everything else is context — protect the time for these.
- Use a **1m or 2m** window on camera and fast-forward the wait in the edit. Do **not** demo a sub-60s window — the free TxLINE tier samples every 60 seconds and can't prove it; keep 5s/15s/25s out of the recording.
- For the devnet loop, run the **real TxLINE feed + mock validator** so the odds are real and only the cryptographic check is stubbed — then say exactly that in one line if asked. Honesty reads as competence.
- Keep VO under 5:00 hard. If long, cut Beat 4 first (it's the "depth" beat), never Beat 3 or 5.
