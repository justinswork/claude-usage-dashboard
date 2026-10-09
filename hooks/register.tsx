import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ActiveBlock, BlockSpan, DayUsage, UsageHistory, UsageRange } from '../types'
import { cumulativeChart, dailyChart, dateKey, fillDays, heatmapChart, hourlyGrid, modelShareChart, money, monthlyChart, monthlyTotals, parseDate, sparkline } from './charts'

const PANE = 'usage'
const ACTIVE_REFRESH_MS = 60_000
const HISTORY_REFRESH_MS = 10 * 60_000
const history = atom({ plugin: 'usage-panel', key: 'history' } as const, null)
const active = atom({ plugin: 'usage-panel', key: 'active' } as const, null)
const activeUpdatedAt = atom({ plugin: 'usage-panel', key: 'activeUpdatedAt' } as const, 0)
const range = atom({ plugin: 'usage-panel', key: 'range' } as const, '30')
const error = atom({ plugin: 'usage-panel', key: 'error' } as const, null)

type Run = (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>

type DailyJson = {
	daily: { period?: string; date?: string; totalCost: number; totalTokens: number; modelBreakdowns?: { modelName: string; cost: number }[] }[]
}

type BlocksJson = {
	blocks: {
		isActive: boolean
		isGap: boolean
		costUSD: number
		startTime: string
		endTime: string
		actualEndTime?: string | null
		burnRate?: { costPerHour: number } | null
		projection?: { totalCost: number; remainingMinutes: number } | null
	}[]
}

// npx is a .cmd shim on Windows, which cannot be started without a shell, so go through cmd.exe there and fall back to npx directly elsewhere.
async function ccusage(run: Run, args: string): Promise<unknown> {
	const command = `npx --yes ccusage@latest ${args} --json --offline`
	let result
	try {
		result = await run(['cmd.exe', '/d', '/s', '/c', command], { timeoutMs: 120_000 })
	} catch {
		result = await run(['npx', ...command.split(' ').slice(1)], { timeoutMs: 120_000 })
	}
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.trim() || `ccusage exited with ${result.exitCode}`)
	}
	return JSON.parse(result.stdout)
}

function toActive(json: BlocksJson): ActiveBlock | null {
	const block = json.blocks.find(b => b.isActive)
	return block
		? {
			cost: block.costUSD,
			startTime: block.startTime,
			endTime: block.endTime,
			costPerHour: block.burnRate?.costPerHour ?? 0,
			projectedCost: block.projection?.totalCost ?? block.costUSD,
			remainingMinutes: block.projection?.remainingMinutes ?? 0,
		}
		: null
}

async function collectHistory(run: Run, now: number): Promise<{ history: UsageHistory; active: ActiveBlock | null }> {
	const [daily, blocks] = (await Promise.all([ccusage(run, 'daily'), ccusage(run, 'blocks')])) as [DailyJson, BlocksJson]

	const days: DayUsage[] = daily.daily.map(d => ({
		date: d.period ?? d.date ?? '',
		cost: d.totalCost,
		tokens: d.totalTokens,
		byModel: Object.fromEntries((d.modelBreakdowns ?? []).map(b => [b.modelName, b.cost])),
	}))

	// Slots follow all-time spend rather than the selected range, so switching ranges never repaints a model.
	const totals = new Map<string, number>()
	for (const d of days) {
		for (const [m, cost] of Object.entries(d.byModel)) totals.set(m, (totals.get(m) ?? 0) + cost)
	}
	const models = [...totals.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))

	const spans: BlockSpan[] = blocks.blocks
		.filter(b => !b.isGap && b.costUSD > 0)
		.map(b => ({ start: b.startTime, end: b.actualEndTime ?? b.endTime, cost: b.costUSD }))

	return { history: { days, blocks: spans, models, updatedAt: now }, active: toActive(blocks) }
}

const clockTime = (ms: number) => {
	const d = new Date(ms)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function rangeStart(r: UsageRange, days: DayUsage[], today: Date): Date {
	if (r === 'all') return days.length ? parseDate(days[0].date) : today
	const from = new Date(today)
	from.setDate(from.getDate() - (Number(r) - 1))
	return from
}

export const register: Register = on => {
	let isRefreshing = false

	on('session.start', async ($, e, next) => {
		const started = await next(e)
		await $.command.register({
			name: 'usage-panel',
			description: 'Show live ccusage usage and cost charts in a pane',
		})
		void $.ui.open({ id: PANE, title: 'Usage' })

		const run: Run = (argv, init) => $.process.run(argv, init)
		const refresh = async (isFull: boolean) => {
			if (isRefreshing) return
			isRefreshing = true
			try {
				const now = await $.clock.now()
				if (isFull || (await read($, history)) === null) {
					const fresh = await collectHistory(run, now)
					await update($, history, () => fresh.history)
					await update($, active, () => fresh.active)
				} else {
					const blocks = (await ccusage(run, 'blocks --active')) as BlocksJson
					await update($, active, () => toActive(blocks))
				}
				await update($, activeUpdatedAt, () => now)
				await update($, error, () => null)
			} catch (err) {
				await update($, error, () => (err instanceof Error ? err.message : String(err)).slice(0, 300))
			} finally {
				isRefreshing = false
			}
		}
		void refresh(true)
		$.clock.every(ACTIVE_REFRESH_MS, () => void refresh(false))
		$.clock.every(HISTORY_REFRESH_MS, () => void refresh(true))

		return started
	})

	on('command.run', { command: 'usage-panel' }, async $ => {
		await $.ui.open({ id: PANE, title: 'Usage' })

		return { text: 'Usage pane opened.' }
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text, Button } = $.ui.resolve(e)
		const hist = await read($, history)
		const block = await read($, active)
		const updatedAt = await read($, activeUpdatedAt)
		const selected = await read($, range)
		const problem = await read($, error)

		if (!hist) {
			return (
				<Box flexDirection="column">
					<Text dimColor>{problem ? `ccusage failed: ${problem}` : 'Loading usage from ccusage…'}</Text>
				</Box>
			)
		}

		const now = new Date(updatedAt || hist.updatedAt)
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
		const todayKey = dateKey(today)
		const sumSince = (from: Date) => hist.days.filter(d => d.date >= dateKey(from)).reduce((s, d) => s + d.cost, 0)
		const weekAgo = new Date(today)
		weekAgo.setDate(weekAgo.getDate() - 6)
		const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
		const todayCost = hist.days.find(d => d.date === todayKey)?.cost ?? 0
		const allTime = hist.days.reduce((s, d) => s + d.cost, 0)
		const activeDayAvg = hist.days.length ? allTime / hist.days.length : 0

		const from = rangeStart(selected, hist.days, today)
		const shown = fillDays(hist.days, from, today)
		const rangeCost = shown.reduce((s, d) => s + d.cost, 0)
		const rangeLabel = selected === 'all' ? 'all time' : `last ${selected} days`

		const elapsedMinutes = block ? Math.max(0, (now.getTime() - Date.parse(block.startTime)) / 60_000) : 0
		const blockLine = block
			? `${money(block.cost)} so far → ${money(block.projectedCost)} projected · ${money(block.costPerHour)}/h · resets ${clockTime(Date.parse(block.endTime))} (${Math.floor(block.remainingMinutes / 60)}h ${block.remainingMinutes % 60}m left, ${Math.round((100 * elapsedMinutes) / 300)}% elapsed)`
			: 'No active 5-hour block.'

		const rangeButtons = (
			<Box flexDirection="row" gap={1}>
				{(['30', '90', 'all'] as const).map(r => (
					<Button
						key={`range-${r}`}
						label={`${r === selected ? '● ' : ''}${r === 'all' ? 'All' : `${r}d`}`}
						onPress={() => update($, range, () => r)}
					/>
				))}
			</Box>
		)

		const footer = (
			<Text dimColor>
				API-equivalent prices · block updated {clockTime(updatedAt)} · history {clockTime(hist.updatedAt)}
				{problem ? ' · last refresh failed' : ''}
			</Text>
		)

		const months = monthlyTotals(hist.days)
		const kpis = `Today ${money(todayCost)} · 7 days ${money(sumSince(weekAgo))} · ${now.toLocaleDateString('en-US', { month: 'long' })} ${money(sumSince(monthStart))} · All time ${money(allTime)} · ${money(activeDayAvg)}/active day`

		if (e.surface !== 'desktop' && e.surface !== 'vscode' && e.surface !== 'mobile') {
			const last30 = fillDays(hist.days, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29), today)
			return (
				<Box flexDirection="column">
					<Text bold>5-hour block</Text>
					<Text>{blockLine}</Text>
					<Text> </Text>
					<Text>{kpis}</Text>
					<Text> </Text>
					<Text bold>Last 30 days</Text>
					<Text color="blue">{sparkline(last30.map(d => d.cost))}</Text>
					<Text dimColor>
						{last30[0].date.slice(5)} … {todayKey.slice(5)} · peak {money(Math.max(...last30.map(d => d.cost)))}
					</Text>
					<Text> </Text>
					<Text bold>Monthly</Text>
					{months.map(m => (
						<Text>
							{m.month} {'█'.repeat(Math.max(1, Math.round((m.cost / Math.max(...months.map(x => x.cost))) * 24))).padEnd(24, ' ')} {money(m.cost)}
						</Text>
					))}
					<Text> </Text>
					{footer}
				</Box>
			)
		}

		const { Svg } = $.ui.resolve(e)
		const width = Math.max(320, Math.min(960, (e.viewport?.columns ?? 100) * 8))
		const grid = hourlyGrid(hist.blocks, from)

		return (
			<Box flexDirection="column" gap={1}>
				<Box flexDirection="column">
					<Text bold>Current 5-hour block</Text>
					<Text>{blockLine}</Text>
				</Box>
				<Text>{kpis}</Text>
				<Box flexDirection="column">
					<Text bold>Monthly spend by model · all time</Text>
					<Svg
						source={monthlyChart(months, hist.models, now, width)}
						alt={`Monthly spend by model: ${months.map(m => `${m.month} ${money(m.cost)}`).join(', ')}`}
						width={width}
						isInteractive
					/>
				</Box>
				{rangeButtons}
				<Box flexDirection="column">
					<Text bold>
						Daily spend by model · {rangeLabel} · {money(rangeCost)}
					</Text>
					<Svg
						source={dailyChart(shown, hist.models, width)}
						alt={`Daily spend by model, ${rangeLabel}, ${money(rangeCost)} total`}
						width={width}
						isInteractive
					/>
				</Box>
				<Box flexDirection="column">
					<Text bold>Month to date vs last month</Text>
					<Svg
						source={cumulativeChart(hist.days, today, width)}
						alt="Cumulative spend this month compared with last month"
						width={width}
						isInteractive
					/>
				</Box>
				<Box flexDirection="column">
					<Text bold>When you use it · {rangeLabel}</Text>
					<Svg source={heatmapChart(grid, width)} alt={`Spend by weekday and hour, ${rangeLabel}`} width={width} isInteractive />
				</Box>
				<Box flexDirection="column">
					<Text bold>Spend by model · {rangeLabel}</Text>
					<Svg source={modelShareChart(shown, hist.models, width)} alt={`Spend by model, ${rangeLabel}`} width={width} isInteractive />
				</Box>
				{footer}
			</Box>
		)
	})
}
