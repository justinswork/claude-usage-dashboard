# usage-panel

A Claude Code pane with charts of your Claude Code usage and API-equivalent cost, built on [ccusage](https://github.com/ccusage/ccusage):

- the current 5-hour block: spend so far, projection, burn rate, reset time
- totals for today, the last 7 days, this month and all time
- monthly spend by model, with the current month's month-end pace
- daily spend by model with a 7-day average (30 days, 90 days or all)
- month to date compared with last month
- a weekday × hour heatmap of when you use it
- spend by model

The Desktop app's Code tab draws the charts; a terminal session gets a text version. Type `/usage-panel` to reopen the pane.

## Requirements

Node.js (for `npx`). ccusage is fetched by `npx` on first use and reads the session logs under `~/.claude/projects` on your own machine; nothing is sent anywhere. The dollar figures are what the same usage would cost at API prices, not what a subscription bills.

## Install

In a Claude Code terminal session:

```
/plugin install usage-panel --marketplace justinswork/claude-usage-dashboard
```

Answer `y` to add the marketplace, then pick the user scope. Restart the Desktop app to see the pane there.
