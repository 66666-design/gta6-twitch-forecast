# gta6-twitch-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/66666-design/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/66666-design/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast how many people watch Grand Theft Auto VI live on Twitch in each hour of its release day (2026-11-19 UTC), after the first hour. `main.ts` (Node 22) reads one case at `/input` — the first hour's print plus the history and comparable past launches — and writes five quantiles (5/25/50/75/95%) for hours 2–24 to `/output`. It runs offline and deterministically, in under 8 seconds.

## Model

A practice-calibrated comparable-shape forecast: `q = p1 · m_h · exp(z · s_h)`, where `m_h` blends the median hourly ratio-to-hour-1 curve of the case's comparables with the median curve of four practice launches (Wolverine, RDR2, God of War Ragnarök, Spider-Man 2), and `s_h` is an hour-dependent log spread from the comparable dispersion plus the practice residuals. On the four practice launches (scored against SullyGnome hourly averages) it gets a mean pinball loss of **0.227**, against **0.387** for the house baseline. Any failure falls back to the baseline formula so the output is always valid.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0qgd7kkc&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
